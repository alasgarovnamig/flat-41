// Package realtime is the plain WebSocket endpoint `/ws?token=<accessToken>` (see REALTIME in packages/shared/src/api.ts).
//
//   - Frames: UTF-8 JSON `{"event": "<name>", "data": <payload>}` in both directions.
//   - Auth: missing/invalid token → the upgrade succeeds and the server closes with 4401 "UNAUTHORIZED"
//     (browsers cannot read the HTTP status of a failed upgrade, a close code they can).
//   - Heartbeat: server sends `{"event":"ping"}` every 25 s; any client frame (normally `{"event":"pong"}`) counts as
//     activity; no client frame for 60 s → closed with 4408 "IDLE_TIMEOUT".
//   - Server → client: notification:new, message:new (recipient + all of the sender's connections), conversation:read,
//     payment:updated, typing. Client → server: typing {conversationId}, pong.
//   - Graceful shutdown closes every connection with 1001 "SERVER_SHUTDOWN".
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/db"
)

const Path = "/ws"

// Options tune the protocol timings (tests shorten them).
type Options struct {
	PingInterval   time.Duration // server ping period (25 s)
	IdleTimeout    time.Duration // close after no client frame for this long (60 s)
	TypingInterval time.Duration // min interval between relayed typing events per connection + conversation (1 s)
	WriteTimeout   time.Duration // per-frame write deadline (10 s)
	SendBuffer     int           // queued frames per connection before it is dropped as a slow consumer (64)
	ReadLimit      int64         // max client frame size in bytes (4 KiB)
}

func DefaultOptions() Options {
	return Options{PingInterval: 25 * time.Second, IdleTimeout: 60 * time.Second, TypingInterval: time.Second,
		WriteTimeout: 10 * time.Second, SendBuffer: 64, ReadLimit: 4096}
}

const (
	participantsTTL = 5 * time.Minute
	participantsMax = 10_000
)

type Module struct {
	d        *app.Deps
	opts     Options
	hub      *Hub
	allowAll bool
	origins  map[string]bool

	pmu          sync.Mutex
	participants map[string]participantsEntry
}

type participantsEntry struct {
	ids [2]string
	at  time.Time
}

func New(d *app.Deps) *Module { return NewWithOptions(d, DefaultOptions()) }

func NewWithOptions(d *app.Deps, o Options) *Module {
	def := DefaultOptions()
	if o.PingInterval <= 0 {
		o.PingInterval = def.PingInterval
	}
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = def.IdleTimeout
	}
	if o.TypingInterval <= 0 {
		o.TypingInterval = def.TypingInterval
	}
	if o.WriteTimeout <= 0 {
		o.WriteTimeout = def.WriteTimeout
	}
	if o.SendBuffer <= 0 {
		o.SendBuffer = def.SendBuffer
	}
	if o.ReadLimit <= 0 {
		o.ReadLimit = def.ReadLimit
	}
	m := &Module{d: d, opts: o, hub: newHub(), origins: map[string]bool{}, participants: map[string]participantsEntry{}}
	for _, origin := range d.Cfg.CORSOrigins {
		if origin == "*" {
			m.allowAll = true
		}
		m.origins[normOrigin(origin)] = true
	}
	m.subscribe()
	d.OnShutdown(m.hub.Shutdown)
	return m
}

// Hub exposes the connection registry (tests, metrics).
func (m *Module) Hub() *Hub { return m.hub }

func (m *Module) Routes(chi.Router) {}

// RootRoutes mounts /ws outside /api/v1.
func (m *Module) RootRoutes(r chi.Router) { r.Get(Path, m.ServeHTTP) }

// ───────── domain events → clients ─────────

func (m *Module) subscribe() {
	m.d.Bus.Subscribe(events.NotificationCreated, func(p any) {
		if e, ok := p.(events.NotificationCreatedEvent); ok {
			m.hub.SendToUser(e.UserID, "notification:new", e.Notification)
		}
	})
	m.d.Bus.Subscribe(events.MessageCreated, func(p any) {
		e, ok := p.(events.MessageCreatedEvent)
		if !ok {
			return
		}
		// recipient + the sender's connections (other devices / tabs stay in sync; clients dedupe by message id)
		m.hub.SendToUsers([]string{e.RecipientID, senderOf(e.Message)}, "message:new", e.Message)
	})
	m.d.Bus.Subscribe(events.ConversationRead, func(p any) {
		if e, ok := p.(events.ConversationReadEvent); ok {
			m.hub.SendToUser(e.RecipientID, "conversation:read", map[string]string{
				"conversationId": e.ConversationID, "readerId": e.ReaderID, "readAt": e.ReadAt,
			})
		}
	})
	m.d.Bus.Subscribe(events.PaymentUpdated, func(p any) {
		if e, ok := p.(events.PaymentUpdatedEvent); ok {
			m.hub.SendToUser(e.UserID, "payment:updated", e.Payment)
		}
	})
}

// senderOf extracts senderId from the message DTO without depending on the messaging package.
func senderOf(msg any) string {
	if s, ok := msg.(interface{ GetSenderID() string }); ok {
		return s.GetSenderID()
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return ""
	}
	var v struct {
		SenderID string `json:"senderId"`
	}
	_ = json.Unmarshal(b, &v)
	return v.SenderID
}

// ───────── connection handling ─────────

func normOrigin(o string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(o), "/"))
}

// originAllowed: CORS_ORIGINS (or `*`), same host, or no Origin header at all (native iOS / Android clients).
func (m *Module) originAllowed(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if m.allowAll || o == "" {
		return true
	}
	if m.origins[normOrigin(o)] {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

func (m *Module) token(r *http.Request) string {
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

func (m *Module) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !m.originAllowed(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin checked above
	if err != nil {
		return // Accept already wrote the HTTP error
	}
	tok := m.token(r)
	user, verr := m.d.Signer.Verify(tok)
	if tok == "" || verr != nil {
		_ = ws.Close(CloseUnauthorized, "UNAUTHORIZED")
		return
	}
	ws.SetReadLimit(m.opts.ReadLimit)
	c := newClient(user.ID, ws, m.opts.SendBuffer)
	if !m.hub.add(c) {
		_ = ws.Close(websocket.StatusGoingAway, "SERVER_SHUTDOWN")
		return
	}
	defer m.hub.remove(c)
	go c.writer(m.opts.WriteTimeout)
	go c.heartbeat(m.opts.PingInterval, m.opts.IdleTimeout)
	m.readLoop(c)
	c.close(websocket.StatusNormalClosure, "")
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (m *Module) readLoop(c *client) {
	// The read context is never cancelled: coder/websocket tears the connection down on cancellation, while we
	// want close handshakes (idle / shutdown) to end the loop through Read's error instead.
	ctx := context.Background()
	pong, _ := encode("pong", nil)
	for {
		typ, data, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		c.touch()
		if typ != websocket.MessageText {
			continue
		}
		var f Frame
		if json.Unmarshal(data, &f) != nil {
			continue
		}
		switch f.Event {
		case "pong":
		case "ping": // client-initiated keepalive
			c.enqueue(pong)
		case "typing":
			m.onTyping(c, f.Data)
		}
	}
}

// onTyping relays {conversationId, userId} to the other participant (validated, throttled per connection + conversation).
func (m *Module) onTyping(c *client, raw json.RawMessage) {
	var body struct {
		ConversationID string `json:"conversationId"`
	}
	if json.Unmarshal(raw, &body) != nil || !uuidRe.MatchString(body.ConversationID) {
		return
	}
	convID := strings.ToLower(body.ConversationID)
	now := time.Now()
	if now.Sub(c.typingAt[convID]) < m.opts.TypingInterval {
		return
	}
	if len(c.typingAt) > 1000 {
		clear(c.typingAt)
	}
	c.typingAt[convID] = now
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ids, ok := m.getParticipants(ctx, convID)
	if !ok {
		return
	}
	var other string
	switch c.userID {
	case ids[0]:
		other = ids[1]
	case ids[1]:
		other = ids[0]
	default:
		return // not a participant
	}
	m.hub.SendToUser(other, "typing", map[string]string{"conversationId": convID, "userId": c.userID})
}

func (m *Module) getParticipants(ctx context.Context, convID string) ([2]string, bool) {
	m.pmu.Lock()
	if e, ok := m.participants[convID]; ok && time.Since(e.at) < participantsTTL {
		m.pmu.Unlock()
		return e.ids, true
	}
	m.pmu.Unlock()
	var ids [2]string
	err := m.d.Pool.QueryRow(ctx, `select buyer_id::text, seller_id::text from conversations where id = $1`, convID).Scan(&ids[0], &ids[1])
	if err != nil {
		if !db.IsNoRows(err) {
			slog.Warn("realtime: participants lookup", "err", err)
		}
		return ids, false
	}
	m.pmu.Lock()
	if len(m.participants) >= participantsMax {
		clear(m.participants)
	}
	m.participants[convID] = participantsEntry{ids: ids, at: time.Now()}
	m.pmu.Unlock()
	return ids, true
}
