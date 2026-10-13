package commtest_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/modules/commtest"
	"github.com/alasgarovnamig/evtap/api/internal/modules/realtime"
)

func dialRaw(t *testing.T, url string, hdr http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: hdr})
}

func expectClose(t *testing.T, c *websocket.Conn, want websocket.StatusCode) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx)
	if got := websocket.CloseStatus(err); got != want {
		t.Fatalf("close status = %d (%v), want %d", got, err, want)
	}
}

func TestWSUnauthorized(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	id, _ := e.User("U", commtest.UserOpts{})
	foreign, _ := auth.NewSigner("another-secret", 900).Sign(auth.User{ID: id, Role: "USER"})
	expired, _ := auth.NewSigner("test-access-secret", -10).Sign(auth.User{ID: id, Role: "USER"})
	for name, tok := range map[string]string{"missing": "", "garbage": "not-a-jwt", "foreign": foreign, "expired": expired} {
		t.Run(name, func(t *testing.T) {
			c, _, err := dialRaw(t, e.WSURL(tok), nil)
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			expectClose(t, c, realtime.CloseUnauthorized)
		})
	}
	if n := e.Realtime.Hub().Total(); n != 0 {
		t.Fatalf("registered connections = %d", n)
	}
}

func TestWSOriginCheck(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	id, tok := e.User("U", commtest.UserOpts{})
	if _, res, err := dialRaw(t, e.WSURL(tok), http.Header{"Origin": {"https://evil.example"}}); err == nil || res == nil || res.StatusCode != 403 {
		t.Fatalf("foreign origin: err=%v res=%v", err, res)
	}
	c, _, err := dialRaw(t, e.WSURL(tok), http.Header{"Origin": {"http://localhost:3000"}})
	if err != nil {
		t.Fatalf("allowed origin: %v", err)
	}
	defer c.CloseNow()
	commtest.Eventually(t, 2*time.Second, func() bool { return e.Realtime.Hub().Connections(id) == 1 })
	// Authorization header works too (native clients)
	c2, _, err := dialRaw(t, e.WSURL(""), http.Header{"Authorization": {"Bearer " + tok}})
	if err != nil {
		t.Fatal(err)
	}
	defer c2.CloseNow()
	commtest.Eventually(t, 2*time.Second, func() bool { return e.Realtime.Hub().Connections(id) == 2 })
}

type msgEvent struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	SenderID       string `json:"senderId"`
	Body           string `json:"body"`
}

func TestWSMessageNotificationAndReadEvents(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	sellerID, seller := e.User("Satıcı", commtest.UserOpts{})
	buyerID, buyer := e.User("Alıcı", commtest.UserOpts{})
	listingID := e.Listing(sellerID, "ACTIVE", "")

	s := e.Dial(seller, sellerID)
	b1 := e.Dial(buyer, buyerID)
	b2 := e.Dial(buyer, buyerID) // second device of the sender

	var conv conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "Salam!"}, 201, &conv)

	var m msgEvent
	s.Expect("message:new", 3*time.Second, &m)
	if m.ConversationID != conv.ID || m.SenderID != buyerID || m.Body != "Salam!" || m.ID != conv.LastMessage.ID {
		t.Fatalf("seller message:new = %+v", m)
	}
	var n notify.AppNotification
	s.Expect("notification:new", 3*time.Second, &n)
	if n.Type != "NEW_MESSAGE" || n.Title != "Alıcı" || n.Body != "Salam!" || n.Data["conversationId"] != conv.ID {
		t.Fatalf("notification:new = %+v", n)
	}
	// the sender's devices stay in sync
	b1.Expect("message:new", 3*time.Second, &m)
	b2.Expect("message:new", 3*time.Second, &m)
	if m.ConversationID != conv.ID {
		t.Fatalf("sender echo = %+v", m)
	}
	b1.ExpectNone("notification:new", 200*time.Millisecond)

	// reply → buyer devices
	e.JSON("POST", "/conversations/"+conv.ID+"/messages", seller, map[string]any{"body": "Buyurun"}, 201, nil)
	b1.Expect("message:new", 3*time.Second, &m)
	if m.SenderID != sellerID || m.Body != "Buyurun" {
		t.Fatalf("buyer message:new = %+v", m)
	}

	// read receipt → the other participant
	e.JSON("POST", "/conversations/"+conv.ID+"/read", seller, nil, 200, nil)
	var rd struct{ ConversationID, ReaderID, ReadAt string }
	b2.Expect("conversation:read", 3*time.Second, &rd)
	if rd.ConversationID != conv.ID || rd.ReaderID != sellerID || len(rd.ReadAt) != 24 {
		t.Fatalf("conversation:read = %+v", rd)
	}
	// nothing new to read → no event
	e.JSON("POST", "/conversations/"+conv.ID+"/read", seller, nil, 200, nil)
	b2.ExpectNone("conversation:read", 200*time.Millisecond)

	// payment:updated straight from the bus
	e.D.Bus.Publish(events.PaymentUpdated, events.PaymentUpdatedEvent{UserID: buyerID, Payment: map[string]any{"id": "p1", "status": "SUCCEEDED"}})
	var p struct{ ID, Status string }
	b1.Expect("payment:updated", 3*time.Second, &p)
	if p.ID != "p1" || p.Status != "SUCCEEDED" {
		t.Fatalf("payment:updated = %+v", p)
	}
	s.ExpectNone("payment:updated", 100*time.Millisecond)
}

func TestWSTypingRelay(t *testing.T) {
	e := commtest.New(t, realtime.Options{TypingInterval: 400 * time.Millisecond})
	sellerID, seller := e.User("Satıcı", commtest.UserOpts{})
	buyerID, buyer := e.User("Alıcı", commtest.UserOpts{})
	strangerID, stranger := e.User("Kənar", commtest.UserOpts{})
	listingID := e.Listing(sellerID, "ACTIVE", "")
	var conv conversation
	e.JSON("POST", "/conversations", buyer, map[string]any{"listingId": listingID, "message": "Salam"}, 201, &conv)

	s := e.Dial(seller, sellerID)
	b1 := e.Dial(buyer, buyerID)
	b2 := e.Dial(buyer, buyerID)
	x := e.Dial(stranger, strangerID)

	b1.Send("typing", map[string]any{"conversationId": conv.ID})
	var ty struct{ ConversationID, UserID string }
	s.Expect("typing", 3*time.Second, &ty)
	if ty.ConversationID != conv.ID || ty.UserID != buyerID {
		t.Fatalf("typing = %+v", ty)
	}
	b2.ExpectNone("typing", 100*time.Millisecond) // never echoed to the typist

	// throttled per connection + conversation
	b1.Send("typing", map[string]any{"conversationId": conv.ID})
	b1.Send("typing", map[string]any{"conversationId": conv.ID})
	s.ExpectNone("typing", 250*time.Millisecond)
	time.Sleep(200 * time.Millisecond)
	b1.Send("typing", map[string]any{"conversationId": conv.ID})
	s.Expect("typing", 2*time.Second, &ty)

	// seller → buyer (all devices)
	s.Send("typing", map[string]any{"conversationId": conv.ID})
	b1.Expect("typing", 2*time.Second, &ty)
	b2.Expect("typing", 2*time.Second, &ty)
	if ty.UserID != sellerID {
		t.Fatalf("typing to buyer = %+v", ty)
	}

	// non-participants, unknown conversations and malformed frames are ignored (connection stays open)
	x.Send("typing", map[string]any{"conversationId": conv.ID})
	x.Send("typing", map[string]any{"conversationId": "00000000-0000-4000-8000-000000000000"})
	x.Send("typing", map[string]any{"conversationId": "nope"})
	x.Send("typing", "garbage")
	_ = x.C.Write(context.Background(), websocket.MessageText, []byte("{not json"))
	s.ExpectNone("typing", 300*time.Millisecond)
	b1.ExpectNone("typing", 10*time.Millisecond)
	if e.Realtime.Hub().Connections(strangerID) != 1 {
		t.Fatal("stranger connection was dropped")
	}
}

func TestWSHeartbeatAndIdleClose(t *testing.T) {
	e := commtest.New(t, realtime.Options{PingInterval: 50 * time.Millisecond, IdleTimeout: 300 * time.Millisecond})
	id, tok := e.User("U", commtest.UserOpts{})

	// a client that answers every ping stays connected well past the idle timeout
	alive := e.Dial(tok, id)
	end := time.Now().Add(900 * time.Millisecond)
	pings := 0
	for time.Now().Before(end) {
		alive.Expect("ping", time.Second, nil)
		alive.Send("pong", nil)
		pings++
	}
	if pings < 10 || e.Realtime.Hub().Connections(id) != 1 {
		t.Fatalf("pings=%d connections=%d", pings, e.Realtime.Hub().Connections(id))
	}
	alive.AutoPong()

	// a silent client is closed with 4408 after IdleTimeout; the responsive one survives
	silent := e.Dial(tok, id)
	start := time.Now()
	if code := silent.Closed(3 * time.Second); code != realtime.CloseIdleTimeout {
		t.Fatalf("idle close = %d (%v)", code, silent.Err)
	}
	if el := time.Since(start); el < 250*time.Millisecond {
		t.Fatalf("closed too early: %s", el)
	}
	commtest.Eventually(t, 2*time.Second, func() bool { return e.Realtime.Hub().Connections(id) == 1 })
	time.Sleep(500 * time.Millisecond)
	if e.Realtime.Hub().Connections(id) != 1 {
		t.Fatal("responsive client was dropped")
	}
}

func TestWSGracefulShutdown(t *testing.T) {
	e := commtest.New(t, realtime.Options{})
	id, tok := e.User("U", commtest.UserOpts{})
	ws := e.Dial(tok, id)
	ws2 := e.Dial(tok, id)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	e.D.Shutdown(ctx)
	for _, w := range []*commtest.WS{ws, ws2} {
		if code := w.Closed(3 * time.Second); code != websocket.StatusGoingAway {
			t.Fatalf("shutdown close = %d (%v)", code, w.Err)
		}
	}
	commtest.Eventually(t, 2*time.Second, func() bool { return e.Realtime.Hub().Total() == 0 })
	// new connections are refused while shutting down
	c, _, err := dialRaw(t, e.WSURL(tok), nil)
	if err != nil {
		t.Fatal(err)
	}
	expectClose(t, c, websocket.StatusGoingAway)
}
