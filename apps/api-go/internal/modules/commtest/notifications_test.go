package commtest_test

import (
	"context"
	"testing"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/modules/commtest"
	"github.com/alasgarovnamig/evtap/api/internal/modules/notifications"
	"github.com/alasgarovnamig/evtap/api/internal/modules/realtime"
)

func TestNotificationsInbox(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	ctx := context.Background()
	userID, user := e.User("İstifadəçi", commtest.UserOpts{})
	_, other := e.User("Digər", commtest.UserOpts{})
	e.PushToken(userID, "ios-device-token-"+userID[:8], "ios")
	e.PushToken(userID, "dead-android-token-"+userID[:8], "android")
	e.Push.Invalid["dead-android-token-"+userID[:8]] = true

	var ids []string
	for i, typ := range []string{"LISTING_APPROVED", "PAYMENT_SUCCEEDED", "SYSTEM"} {
		n, err := e.D.Notify.Notify(ctx, userID, typ, "Başlıq", "Mətn", map[string]any{"listingId": "L1", "i": i})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, n.ID)
	}

	// every notification is pushed to all devices with { ...data, type, notificationId }
	commtest.Eventually(t, 3*time.Second, func() bool { return len(e.Push.To("ios-device-token-"+userID[:8])) == 3 })
	for _, m := range e.Push.To("ios-device-token-" + userID[:8]) {
		if m.Platform != "ios" || m.Data["notificationId"] == nil || m.Data["type"] == nil || m.Data["listingId"] != "L1" {
			t.Fatalf("push message = %+v", m)
		}
	}
	// the provider reported the android token as unregistered → deleted
	commtest.Eventually(t, 3*time.Second, func() bool {
		var n int
		_ = e.D.Pool.QueryRow(ctx, `select count(*) from push_tokens where user_id = $1`, userID).Scan(&n)
		return n == 1
	})

	var list page[notify.AppNotification]
	e.JSON("GET", "/notifications?pageSize=2", user, nil, 200, &list)
	if list.Total != 3 || len(list.Items) != 2 || list.Items[0].ID != ids[2] || list.Items[0].ReadAt != nil || list.Items[0].Data["listingId"] != "L1" {
		t.Fatalf("page 1 = %+v", list)
	}
	e.JSON("GET", "/notifications?page=2&pageSize=2", user, nil, 200, &list)
	if len(list.Items) != 1 || list.Items[0].ID != ids[0] || list.Page != 2 {
		t.Fatalf("page 2 = %+v", list)
	}
	e.ErrCode("GET", "/notifications?pageSize=500", user, nil, 400, "VALIDATION_ERROR")
	e.ErrCode("GET", "/notifications", "", nil, 401, "UNAUTHORIZED")

	e.JSON("POST", "/notifications/"+ids[0]+"/read", user, nil, 200, nil)
	e.JSON("POST", "/notifications/"+ids[0]+"/read", user, nil, 200, nil) // idempotent
	e.ErrCode("POST", "/notifications/"+ids[1]+"/read", other, nil, 404, "NOT_FOUND")
	e.ErrCode("POST", "/notifications/00000000-0000-4000-8000-000000000000/read", user, nil, 404, "NOT_FOUND")
	e.ErrCode("POST", "/notifications/xyz/read", user, nil, 400, "VALIDATION_ERROR")

	e.JSON("GET", "/notifications", user, nil, 200, &list)
	var firstReadAt string
	for _, n := range list.Items {
		if (n.ID == ids[0]) != (n.ReadAt != nil) {
			t.Fatalf("readAt after single read: %+v", n)
		}
		if n.ID == ids[0] {
			firstReadAt = *n.ReadAt
		}
	}
	var ok struct{ Ok bool }
	e.JSON("POST", "/notifications/read-all", user, nil, 200, &ok)
	if !ok.Ok {
		t.Fatal("read-all ok=false")
	}
	e.JSON("GET", "/notifications", user, nil, 200, &list)
	for _, n := range list.Items {
		if n.ReadAt == nil {
			t.Fatalf("unread after read-all: %+v", n)
		}
		if n.ID == ids[0] && *n.ReadAt != firstReadAt {
			t.Fatal("read-all must not overwrite an existing readAt")
		}
	}
}

func TestSkipPushIsRespected(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	userID, _ := e.User("U", commtest.UserOpts{})
	tok := "ExponentPushToken[skip-" + userID[:8] + "]"
	e.PushToken(userID, tok, "android")
	n := &notify.AppNotification{ID: "n1", Type: "SYSTEM", Title: "t", Body: "b", Data: map[string]any{}}
	e.D.Bus.Publish(events.NotificationCreated, events.NotificationCreatedEvent{UserID: userID, Notification: n, SkipPush: true})
	e.D.Bus.Publish(events.NotificationCreated, events.NotificationCreatedEvent{UserID: userID, Notification: n})
	e.D.Bus.Wait()
	if got := e.Push.To(tok); len(got) != 1 {
		t.Fatalf("pushes = %d, want 1", len(got))
	}
}

func TestAdminBroadcast(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	ctx := context.Background()
	adminID, admin := e.User("Admin", commtest.UserOpts{Role: "ADMIN"})
	_, moderator := e.User("Mod", commtest.UserOpts{Role: "MODERATOR"})
	_, plain := e.User("Plain", commtest.UserOpts{})
	var business []string
	for i := 0; i < 5; i++ {
		id, _ := e.User("Biznes", commtest.UserOpts{AccountType: "BUSINESS"})
		e.PushToken(id, "biz-token-"+id, "android")
		business = append(business, id)
	}
	blockedBiz, _ := e.User("Blocked biz", commtest.UserOpts{AccountType: "BUSINESS", Status: "BLOCKED"})
	indivID, _ := e.User("Fərdi", commtest.UserOpts{})
	e.PushToken(indivID, "indiv-token-"+indivID, "ios")
	wsBizID, wsBizTok := e.User("Online biz", commtest.UserOpts{AccountType: "BUSINESS"})
	ws := e.Dial(wsBizTok, wsBizID)

	body := map[string]any{"title": "Yeni funksiya", "body": "EvTap-da yeniliklər", "audience": "BUSINESS"}
	e.ErrCode("POST", "/admin/notifications/broadcast", plain, body, 403, "FORBIDDEN")
	e.ErrCode("POST", "/admin/notifications/broadcast", moderator, body, 403, "FORBIDDEN")
	e.ErrCode("POST", "/admin/notifications/broadcast", "", body, 401, "UNAUTHORIZED")
	e.ErrCode("POST", "/admin/notifications/broadcast", admin, map[string]any{"title": "", "body": "x", "audience": "ALL"}, 400, "VALIDATION_ERROR")
	e.ErrCode("POST", "/admin/notifications/broadcast", admin, map[string]any{"title": "x", "body": "x", "audience": "VIP"}, 400, "VALIDATION_ERROR")

	prev := notifications.BroadcastBatch
	notifications.BroadcastBatch = 2 // exercise keyset batching
	defer func() { notifications.BroadcastBatch = prev }()

	var expected int
	if err := e.D.Pool.QueryRow(ctx, `select count(*) from users where status = 'ACTIVE' and account_type = 'BUSINESS'`).Scan(&expected); err != nil {
		t.Fatal(err)
	}
	var res struct{ Sent int }
	e.JSON("POST", "/admin/notifications/broadcast", admin, body, 200, &res)
	if res.Sent != expected || res.Sent < 6 {
		t.Fatalf("sent = %d, want %d", res.Sent, expected)
	}

	has := func(userID string) bool {
		var n int
		_ = e.D.Pool.QueryRow(ctx, `select count(*) from notifications where user_id = $1 and type = 'SYSTEM' and title = 'Yeni funksiya'
			and (data->>'broadcast')::boolean`, userID).Scan(&n)
		return n == 1
	}
	for _, id := range append(business, wsBizID) {
		if !has(id) {
			t.Fatalf("business user %s missing broadcast", id)
		}
	}
	if has(indivID) || has(blockedBiz) || has(adminID) {
		t.Fatal("broadcast reached a user outside the audience")
	}

	// realtime per user, push in bulk (exactly once per device; SkipPush prevents per-user pushes)
	var n notify.AppNotification
	ws.Expect("notification:new", 3*time.Second, &n)
	if n.Type != "SYSTEM" || n.Title != "Yeni funksiya" || n.Data["broadcast"] != true {
		t.Fatalf("notification:new = %+v", n)
	}
	e.D.Bus.Wait()
	for _, id := range business {
		pm := e.Push.To("biz-token-" + id)
		if len(pm) != 1 || pm[0].Data["type"] != "SYSTEM" || pm[0].Data["broadcast"] != true || pm[0].Data["notificationId"] == nil {
			t.Fatalf("push for %s = %+v", id, pm)
		}
	}
	if len(e.Push.To("indiv-token-"+indivID)) != 0 {
		t.Fatal("individual user was pushed")
	}

	// audit log
	var action string
	var data map[string]any
	if err := e.D.Pool.QueryRow(ctx, `select action, data from audit_logs where actor_id = $1 order by created_at desc limit 1`, adminID).Scan(&action, &data); err != nil {
		t.Fatal(err)
	}
	if action != "notification.broadcast" || data["audience"] != "BUSINESS" || data["title"] != "Yeni funksiya" || data["sent"] != float64(res.Sent) {
		t.Fatalf("audit = %s %v", action, data)
	}
}

func TestOTPLoginThenUseAPIAndWebSocket(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	phone := commtest.RandomPhone()
	e.TrackPhone(phone)
	var otp struct {
		Sent    bool
		DevCode string
	}
	e.JSON("POST", "/auth/otp/request", "", map[string]any{"phone": phone}, 200, &otp)
	if !otp.Sent || otp.DevCode != "111111" {
		t.Fatalf("otp = %+v", otp)
	}
	var auth struct {
		AccessToken string `json:"accessToken"`
		User        struct{ ID string }
	}
	e.JSON("POST", "/auth/otp/verify", "", map[string]any{"phone": phone, "code": "111111", "name": "OTP İstifadəçi"}, 200, &auth)
	if auth.AccessToken == "" || auth.User.ID == "" {
		t.Fatalf("auth = %+v", auth)
	}
	var list page[conversation]
	e.JSON("GET", "/conversations", auth.AccessToken, nil, 200, &list)
	if list.Total != 0 {
		t.Fatalf("new user has conversations: %+v", list)
	}
	ws := e.Dial(auth.AccessToken, auth.User.ID)
	if _, err := e.D.Notify.Notify(context.Background(), auth.User.ID, "SYSTEM", "Xoş gəldiniz", "EvTap", nil); err != nil {
		t.Fatal(err)
	}
	var n notify.AppNotification
	ws.Expect("notification:new", 3*time.Second, &n)
	if n.Title != "Xoş gəldiniz" {
		t.Fatalf("notification = %+v", n)
	}
}
