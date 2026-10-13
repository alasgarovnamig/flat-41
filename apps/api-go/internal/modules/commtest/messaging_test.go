package commtest_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/alasgarovnamig/evtap/api/internal/modules/commtest"
	"github.com/alasgarovnamig/evtap/api/internal/modules/messaging"
	"github.com/alasgarovnamig/evtap/api/internal/modules/realtime"
)

type conversation = messaging.Conversation
type message = messaging.Message

type page[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

func TestConversationFlow(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	sellerID, seller := e.User("Satıcı Əli", commtest.UserOpts{AvatarURL: "https://cdn/a.jpg"})
	buyerID, buyer := e.User("Alıcı Aynur", commtest.UserOpts{})
	_, stranger := e.User("Kənar", commtest.UserOpts{})
	listingID := e.Listing(sellerID, "ACTIVE", "https://cdn/cover-thumb.jpg")

	// start: sanitised body (zero-width, bidi override, CRLF, blank-line runs, trailing spaces)
	var conv conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{
		"listingId": listingID,
		"message":   "  Sa\u200blam\u202e, mənzil \x07hələ satılır?   \r\n\r\n\r\n\r\nCavab gözləyirəm  ",
	}, 201, &conv)
	if conv.ID == "" || conv.Listing.ID != listingID || conv.Listing.Price != 185000 || conv.Listing.Currency != "AZN" ||
		conv.Listing.PricePeriod != "TOTAL" || conv.Listing.Status != "ACTIVE" {
		t.Fatalf("bad conversation: %+v", conv)
	}
	if conv.Listing.CoverURL == nil || *conv.Listing.CoverURL != "https://cdn/cover-thumb.jpg" {
		t.Fatalf("coverUrl = %v", conv.Listing.CoverURL)
	}
	if conv.OtherUser.ID != sellerID || conv.OtherUser.Name != "Satıcı Əli" || conv.OtherUser.AvatarURL == nil {
		t.Fatalf("otherUser = %+v", conv.OtherUser)
	}
	if conv.LastMessage == nil || conv.LastMessage.Body != "Salam, mənzil hələ satılır?\n\nCavab gözləyirəm" {
		t.Fatalf("lastMessage = %+v", conv.LastMessage)
	}
	if conv.UnreadCount != 0 || conv.UpdatedAt != conv.LastMessage.CreatedAt || conv.LastMessage.ReadAt != nil {
		t.Fatalf("unread/updatedAt: %+v", conv)
	}

	// re-uses the (listing, buyer) conversation
	var again conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "Ünvan dəqiq haradır?"}, 201, &again)
	if again.ID != conv.ID || again.LastMessage.Body != "Ünvan dəqiq haradır?" {
		t.Fatalf("expected the same conversation, got %+v", again)
	}

	// seller's view
	var list page[conversation]
	e.JSON("GET", "/conversations", seller, nil, 200, &list)
	if list.Total != 1 || len(list.Items) != 1 || list.Page != 1 || list.PageSize != 20 {
		t.Fatalf("list = %+v", list)
	}
	if it := list.Items[0]; it.ID != conv.ID || it.OtherUser.ID != buyerID || it.UnreadCount != 2 || it.OtherUser.AvatarURL != nil {
		t.Fatalf("seller item = %+v", it)
	}
	var cnt struct{ Count int }
	e.JSON("GET", "/conversations/unread-count", seller, nil, 200, &cnt)
	if cnt.Count != 2 {
		t.Fatalf("seller unread = %d", cnt.Count)
	}
	var one conversation
	e.JSON("GET", "/conversations/"+conv.ID, seller, nil, 200, &one)
	if one.ID != conv.ID || one.UnreadCount != 2 || one.OtherUser.ID != buyerID {
		t.Fatalf("GET /conversations/:id = %+v", one)
	}

	// participant checks
	e.ErrCode("GET", "/conversations/"+conv.ID, stranger, nil, 403, "FORBIDDEN")
	e.ErrCode("GET", "/conversations/"+conv.ID+"/messages", stranger, nil, 403, "FORBIDDEN")
	e.ErrCode("POST", "/conversations/"+conv.ID+"/messages", stranger, map[string]any{"body": "hi"}, 403, "FORBIDDEN")
	e.ErrCode("POST", "/conversations/"+conv.ID+"/read", stranger, nil, 403, "FORBIDDEN")
	e.ErrCode("GET", "/conversations/00000000-0000-4000-8000-000000000000", seller, nil, 404, "NOT_FOUND")
	e.ErrCode("GET", "/conversations/not-a-uuid", seller, nil, 400, "VALIDATION_ERROR")
	e.ErrCode("GET", "/conversations", "", nil, 401, "UNAUTHORIZED")
	e.ErrCode("GET", "/conversations", "garbage", nil, 401, "TOKEN_INVALID")

	// reply
	var reply message
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", seller, map[string]any{"body": " Bəli, satılır. "}, 201, &reply)
	if reply.SenderID != sellerID || reply.ConversationID != conv.ID || reply.Body != "Bəli, satılır." {
		t.Fatalf("reply = %+v", reply)
	}

	// cursor pagination, newest last
	for i := 1; i <= 5; i++ {
		e.JSON("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": fmt.Sprintf("m%d", i)}, 201, nil)
	}
	var msgs []message
	e.JSON("GET", "/conversations/"+conv.ID+"/messages", buyer, nil, 200, &msgs)
	if len(msgs) != 8 || msgs[7].Body != "m5" || msgs[0].Body != "Salam, mənzil hələ satılır?\n\nCavab gözləyirəm" {
		t.Fatalf("all messages: %d %+v", len(msgs), msgs)
	}
	var newest []message
	e.JSON("GET", "/conversations/"+conv.ID+"/messages?limit=3", buyer, nil, 200, &newest)
	if len(newest) != 3 || newest[0].Body != "m3" || newest[2].Body != "m5" {
		t.Fatalf("limit=3: %+v", newest)
	}
	var older []message
	e.JSON("GET", "/conversations/"+conv.ID+"/messages?limit=3&before="+newest[0].ID, buyer, nil, 200, &older)
	if len(older) != 3 || older[0].Body != "Bəli, satılır." || older[2].Body != "m2" {
		t.Fatalf("before page: %+v", older)
	}
	var oldest []message
	e.JSON("GET", "/conversations/"+conv.ID+"/messages?limit=3&before="+older[0].ID, buyer, nil, 200, &oldest)
	if len(oldest) != 2 || oldest[1].Body != "Ünvan dəqiq haradır?" {
		t.Fatalf("oldest page: %+v", oldest)
	}
	e.ErrCode("GET", "/conversations/"+conv.ID+"/messages?before=00000000-0000-4000-8000-000000000000", buyer, nil, 400, "INVALID_CURSOR")
	e.ErrCode("GET", "/conversations/"+conv.ID+"/messages?before=nope", buyer, nil, 400, "VALIDATION_ERROR")
	e.ErrCode("GET", "/conversations/"+conv.ID+"/messages?limit=101", buyer, nil, 400, "VALIDATION_ERROR")
	e.ErrCode("GET", "/conversations/"+conv.ID+"/messages?limit=0", buyer, nil, 400, "VALIDATION_ERROR")

	// a cursor from another conversation is rejected
	otherListing := e.Listing(sellerID, "ACTIVE", "")
	var conv2 conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": otherListing, "message": "Başqa elan"}, 201, &conv2)
	if conv2.ID == conv.ID || conv2.Listing.CoverURL != nil {
		t.Fatalf("conv2 = %+v", conv2)
	}
	e.ErrCode("GET", "/conversations/"+conv.ID+"/messages?before="+conv2.LastMessage.ID, buyer, nil, 400, "INVALID_CURSOR")

	// list ordering: most recent activity first
	e.JSON("GET", "/conversations?pageSize=1", seller, nil, 200, &list)
	if list.Total != 2 || len(list.Items) != 1 || list.Items[0].ID != conv2.ID {
		t.Fatalf("ordering: %+v", list)
	}
	e.ErrCode("GET", "/conversations?pageSize=101", seller, nil, 400, "VALIDATION_ERROR")

	// read receipts
	e.JSON("GET", "/conversations/unread-count", seller, nil, 200, &cnt)
	if cnt.Count != 8 { // 2 + 5 in conv, 1 in conv2
		t.Fatalf("seller unread before read = %d", cnt.Count)
	}
	var ok struct{ Ok bool }
	e.JSON("POST", "/conversations/"+conv.ID+"/read", seller, nil, 200, &ok)
	if !ok.Ok {
		t.Fatal("read: ok=false")
	}
	e.JSON("GET", "/conversations/unread-count", seller, nil, 200, &cnt)
	if cnt.Count != 1 {
		t.Fatalf("seller unread after read = %d", cnt.Count)
	}
	e.JSON("GET", "/conversations/"+conv.ID+"/messages", buyer, nil, 200, &msgs)
	for _, m := range msgs {
		if (m.SenderID == buyerID) != (m.ReadAt != nil) {
			t.Fatalf("readAt mismatch: %+v", m)
		}
	}
	e.JSON("GET", "/conversations/unread-count", buyer, nil, 200, &cnt)
	if cnt.Count != 1 {
		t.Fatalf("buyer unread = %d", cnt.Count)
	}
	e.JSON("POST", "/conversations/"+conv.ID+"/read", seller, nil, 200, &ok) // idempotent
}

func TestConversationErrors(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	sellerID, seller := e.User("Satıcı", commtest.UserOpts{})
	_, buyer := e.User("Alıcı", commtest.UserOpts{})
	listingID := e.Listing(sellerID, "ACTIVE", "")

	e.ErrCode("POST", "/conversations", seller, map[string]any{"listingId": listingID, "message": "salam"}, 400, "CANNOT_MESSAGE_SELF")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": "00000000-0000-4000-8000-000000000000", "message": "salam"}, 404, "NOT_FOUND")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": "x", "message": "salam"}, 400, "VALIDATION_ERROR")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "   "}, 400, "VALIDATION_ERROR")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": listingID}, 400, "VALIDATION_ERROR")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": strings.Repeat("a", 2001)}, 400, "VALIDATION_ERROR")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "\u200b\u200e\u202e\x00\x01"}, 400, "MESSAGE_EMPTY")
	e.ErrCode("POST", "/conversations", "", map[string]any{"listingId": listingID, "message": "salam"}, 401, "UNAUTHORIZED")

	var conv conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "salam"}, 201, &conv)
	e.ErrCode("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "\ufeff\u2060"}, 400, "MESSAGE_EMPTY")
	e.ErrCode("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": ""}, 400, "VALIDATION_ERROR")
	e.ErrCode("POST", "/conversations/00000000-0000-4000-8000-000000000000/messages", buyer, map[string]any{"body": "x"}, 404, "NOT_FOUND")

	ctx := context.Background()
	// blocked listing: both starting and replying are refused
	if _, err := e.D.Pool.Exec(ctx, `update listings set status = 'BLOCKED' where id = $1`, listingID); err != nil {
		t.Fatal(err)
	}
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "salam"}, 403, "LISTING_BLOCKED")
	e.ErrCode("POST", "/conversations/"+conv.ID+"/messages", seller, map[string]any{"body": "salam"}, 403, "LISTING_BLOCKED")
	if _, err := e.D.Pool.Exec(ctx, `update listings set status = 'ACTIVE' where id = $1`, listingID); err != nil {
		t.Fatal(err)
	}

	// deleted recipient
	if _, err := e.D.Pool.Exec(ctx, `update users set status = 'DELETED', avatar_url = 'https://cdn/x.jpg' where id = $1`, sellerID); err != nil {
		t.Fatal(err)
	}
	e.ErrCode("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "salam?"}, 410, "RECIPIENT_UNAVAILABLE")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "salam"}, 410, "RECIPIENT_UNAVAILABLE")
	var dto conversation
	e.JSON("GET", "/conversations/"+conv.ID, buyer, nil, 200, &dto)
	if dto.OtherUser.ID != sellerID || dto.OtherUser.AvatarURL != nil || dto.OtherUser.Name != "Satıcı" {
		t.Fatalf("deleted otherUser = %+v", dto.OtherUser)
	}
}

func TestMessageRateLimit(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	sellerID, _ := e.User("Satıcı", commtest.UserOpts{})
	_, buyer := e.User("Spamçı", commtest.UserOpts{})
	listingID := e.Listing(sellerID, "ACTIVE", "")
	var conv conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "1"}, 201, &conv)
	for i := 2; i <= messaging.MessagesPerMinute; i++ {
		e.JSON("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": fmt.Sprint(i)}, 201, nil)
	}
	e.ErrCode("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "31"}, 429, "RATE_LIMITED")
	// the limit is per sender across conversations (also applies to starting a new one)
	other := e.Listing(sellerID, "ACTIVE", "")
	e.ErrCode("POST", "/conversations", buyer, map[string]any{"listingId": other, "message": "salam"}, 429, "RATE_LIMITED")
	// sliding window: once the messages are older than a minute, sending works again
	if _, err := e.D.Pool.Exec(context.Background(), `update messages set created_at = created_at - interval '61 seconds' where conversation_id = $1`, conv.ID); err != nil {
		t.Fatal(err)
	}
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "again"}, 201, nil)
}

func TestNewMessageNotificationThrottle(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	sellerID, seller := e.User("Satıcı Rəşad", commtest.UserOpts{})
	buyerID, buyer := e.User("Alıcı Leyla", commtest.UserOpts{})
	e.PushToken(sellerID, "ExponentPushToken[seller-"+sellerID[:8]+"]", "android")
	listingID := e.Listing(sellerID, "ACTIVE", "")
	ctx := context.Background()

	count := func(userID, convID string) int {
		var n int
		if err := e.D.Pool.QueryRow(ctx, `select count(*) from notifications where user_id = $1 and type = 'NEW_MESSAGE' and data->>'conversationId' = $2`,
			userID, convID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	long := strings.Repeat("ə", 200)
	var conv conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": long}, 201, &conv)
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "ikinci"}, 201, nil)
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "üçüncü"}, 201, nil)
	if n := count(sellerID, conv.ID); n != 1 {
		t.Fatalf("seller NEW_MESSAGE notifications = %d, want 1 (throttled)", n)
	}

	var title, body string
	var data map[string]any
	if err := e.D.Pool.QueryRow(ctx, `select title, body, data from notifications where user_id = $1 and type = 'NEW_MESSAGE'`, sellerID).Scan(&title, &body, &data); err != nil {
		t.Fatal(err)
	}
	if title != "Alıcı Leyla" || utf8.RuneCountInString(body) != 140 || !strings.HasSuffix(body, "…") {
		t.Fatalf("title %q, body %q (%d runes)", title, body, utf8.RuneCountInString(body))
	}
	if data["conversationId"] != conv.ID || data["listingId"] != listingID || data["senderId"] != buyerID || data["messageId"] == nil {
		t.Fatalf("data = %v", data)
	}

	// exactly one push for the throttled burst, with deep-link data
	tok := "ExponentPushToken[seller-" + sellerID[:8] + "]"
	commtest.Eventually(t, 3*time.Second, func() bool { return len(e.Push.To(tok)) == 1 })
	time.Sleep(100 * time.Millisecond)
	pm := e.Push.To(tok)
	if len(pm) != 1 || pm[0].Title != "Alıcı Leyla" || pm[0].Platform != "android" || pm[0].Data["type"] != "NEW_MESSAGE" ||
		pm[0].Data["conversationId"] != conv.ID || pm[0].Data["notificationId"] == nil {
		t.Fatalf("push = %+v", pm)
	}

	// the other direction is throttled independently
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", seller, map[string]any{"body": "Salam!"}, 201, nil)
	if n := count(buyerID, conv.ID); n != 1 {
		t.Fatalf("buyer notifications = %d", n)
	}

	// after the 10-minute window a new notification is created
	if _, err := e.D.Pool.Exec(ctx, `update notifications set created_at = created_at - interval '11 minutes' where user_id = $1`, sellerID); err != nil {
		t.Fatal(err)
	}
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", buyer, map[string]any{"body": "dördüncü"}, 201, nil)
	if n := count(sellerID, conv.ID); n != 2 {
		t.Fatalf("after window = %d, want 2", n)
	}

	// concurrent burst in a fresh conversation still yields exactly one notification (advisory lock)
	other := e.Listing(sellerID, "ACTIVE", "")
	var conv2 conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": other, "message": "yeni"}, 201, &conv2)
	if _, err := e.D.Pool.Exec(ctx, `delete from notifications where user_id = $1 and data->>'conversationId' = $2`, sellerID, conv2.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	for i := 0; i < 5; i++ {
		go func(i int) {
			defer func() { done <- struct{}{} }()
			e.Do("POST", "/conversations/"+conv2.ID+"/messages", buyer, map[string]any{"body": fmt.Sprintf("burst %d", i)})
		}(i)
	}
	for i := 0; i < 5; i++ {
		<-done
	}
	if n := count(sellerID, conv2.ID); n != 1 {
		t.Fatalf("concurrent burst notifications = %d, want 1", n)
	}
}

func TestSanitizeTable(t *testing.T) {
	cases := map[string]string{
		"a\r\nb":                 "a\nb",
		"a\rb":                   "a\nb",
		"x\u200by\u200fz":        "xyz",
		"\u202aab\u202e":         "ab",
		"a\u2066b\u2069c":        "abc",
		"\ufeffhi":               "hi",
		"a\x00b\x1fc\x7fd\u0085": "abcd",
		"tab\tkept":              "tab\tkept",
		"a   \nb":                "a\nb",
		"a\n\n\n\n\nb":           "a\n\nb",
		"  \u00a0 hi \u3000 ":    "hi",
		"\u200b\u200c":           "",
	}
	for in, want := range cases {
		if got := messaging.Sanitize(in); got != want {
			t.Errorf("Sanitize(%q) = %q, want %q", in, got, want)
		}
	}
}
