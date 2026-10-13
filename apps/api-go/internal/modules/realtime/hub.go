package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Close codes (in addition to RFC 6455 ones).
const (
	CloseUnauthorized websocket.StatusCode = 4401 // missing / invalid access token
	CloseIdleTimeout  websocket.StatusCode = 4408 // no client frame (pong) within IdleTimeout
)

// Frame is the wire format of every message in both directions: {"event": "...", "data": ...}.
type Frame struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

func encode(event string, data any) ([]byte, error) {
	if data == nil {
		return json.Marshal(struct {
			Event string `json:"event"`
		}{event})
	}
	return json.Marshal(struct {
		Event string `json:"event"`
		Data  any    `json:"data"`
	}{event, data})
}

// Hub is the per-user connection registry (a user may be connected from several devices / tabs).
type Hub struct {
	mu     sync.RWMutex
	users  map[string]map[*client]struct{}
	closed bool
}

func newHub() *Hub { return &Hub{users: map[string]map[*client]struct{}{}} }

func (h *Hub) add(c *client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false
	}
	set := h.users[c.userID]
	if set == nil {
		set = map[*client]struct{}{}
		h.users[c.userID] = set
	}
	set[c] = struct{}{}
	return true
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set := h.users[c.userID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.users, c.userID)
		}
	}
}

// Connections returns the number of open connections of a user (0 when offline).
func (h *Hub) Connections(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.users[userID])
}

// Total returns the number of open connections.
func (h *Hub) Total() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, s := range h.users {
		n += len(s)
	}
	return n
}

// SendToUser delivers an event to every connection of a user (no-op when offline).
func (h *Hub) SendToUser(userID, event string, data any) {
	h.SendToUsers([]string{userID}, event, data)
}

// SendToUsers encodes the frame once and enqueues it on every connection of the given users.
func (h *Hub) SendToUsers(userIDs []string, event string, data any) {
	var targets []*client
	h.mu.RLock()
	seen := map[string]bool{}
	for _, uid := range userIDs {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		for c := range h.users[uid] {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	if len(targets) == 0 {
		return
	}
	b, err := encode(event, data)
	if err != nil {
		slog.Error("realtime: encode frame", "event", event, "err", err)
		return
	}
	for _, c := range targets {
		c.enqueue(b)
	}
}

// Shutdown closes every connection with 1001 (going away) and refuses new ones.
func (h *Hub) Shutdown(ctx context.Context) {
	h.mu.Lock()
	h.closed = true
	var all []*client
	for _, set := range h.users {
		for c := range set {
			all = append(all, c)
		}
	}
	h.mu.Unlock()
	var wg sync.WaitGroup
	for _, c := range all {
		wg.Add(1)
		go func(c *client) {
			defer wg.Done()
			c.close(websocket.StatusGoingAway, "SERVER_SHUTDOWN")
		}(c)
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// client is one WebSocket connection.
type client struct {
	userID   string
	ws       *websocket.Conn
	send     chan []byte
	done     chan struct{}
	once     sync.Once
	lastSeen atomic.Int64 // unix nanos of the last client frame

	typingAt map[string]time.Time // conversationId → last relayed typing (reader goroutine only)
}

func newClient(userID string, ws *websocket.Conn, buffer int) *client {
	c := &client{userID: userID, ws: ws, send: make(chan []byte, buffer), done: make(chan struct{}), typingAt: map[string]time.Time{}}
	c.touch()
	return c
}

func (c *client) touch() { c.lastSeen.Store(time.Now().UnixNano()) }

func (c *client) idleFor() time.Duration { return time.Since(time.Unix(0, c.lastSeen.Load())) }

// enqueue never blocks: a client that cannot keep up is disconnected (it will reconnect and refetch).
func (c *client) enqueue(b []byte) {
	select {
	case <-c.done:
	case c.send <- b:
	default:
		go c.close(websocket.StatusPolicyViolation, "SLOW_CONSUMER")
	}
}

// close performs the close handshake once (waits for the peer's close frame up to the library timeout).
func (c *client) close(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		close(c.done)
		_ = c.ws.Close(code, reason)
	})
}

// writer drains the send queue; every write has its own deadline.
func (c *client) writer(writeTimeout time.Duration) {
	for {
		select {
		case <-c.done:
			return
		case b := <-c.send:
			ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
			err := c.ws.Write(ctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.close(websocket.StatusInternalError, "WRITE_FAILED")
				return
			}
		}
	}
}

// heartbeat sends {"event":"ping"} every pingEvery and closes the connection after idle without client frames.
func (c *client) heartbeat(pingEvery, idle time.Duration) {
	ping, _ := encode("ping", nil)
	pt := time.NewTicker(pingEvery)
	defer pt.Stop()
	check := idle / 6
	if check < 5*time.Millisecond {
		check = 5 * time.Millisecond
	}
	it := time.NewTicker(check)
	defer it.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-pt.C:
			c.enqueue(ping)
		case <-it.C:
			if c.idleFor() > idle {
				c.close(CloseIdleTimeout, "IDLE_TIMEOUT")
				return
			}
		}
	}
}
