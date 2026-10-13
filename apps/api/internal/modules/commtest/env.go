// Package commtest holds the integration-test harness for the communication modules (messaging, notifications,
// push, realtime): a real Postgres (TEST_DATABASE_URL, default postgres://evtap:evtap@localhost:5432/evtap_go_comm),
// the real router via httptest, a recording push provider and WebSocket helpers. Imported by tests only.
package commtest

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/modules/messaging"
	"github.com/alasgarovnamig/evtap/api/internal/modules/notifications"
	"github.com/alasgarovnamig/evtap/api/internal/modules/push"
	"github.com/alasgarovnamig/evtap/api/internal/modules/realtime"
	"github.com/alasgarovnamig/evtap/api/internal/server"
)

const defaultDB = "postgres://evtap:evtap@localhost:5432/evtap_go_comm"

var (
	poolOnce sync.Once
	pool     *pgxpool.Pool
	poolErr  error
)

func sharedPool() (*pgxpool.Pool, error) {
	poolOnce.Do(func() {
		url := os.Getenv("TEST_DATABASE_URL")
		if url == "" {
			url = defaultDB
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		pool, poolErr = db.Connect(ctx, url)
		if poolErr != nil {
			return
		}
		if poolErr = db.Migrate(pool); poolErr != nil {
			return
		}
		poolErr = settings.EnsureDefaults(ctx, pool)
	})
	return pool, poolErr
}

// FakePush records every message handed to the provider; Invalid tokens are reported back as unregistered.
type FakePush struct {
	mu      sync.Mutex
	Msgs    []push.Message
	Invalid map[string]bool
}

func (f *FakePush) Name() string { return "fake" }
func (f *FakePush) Send(_ context.Context, msgs []push.Message) push.Result {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Msgs = append(f.Msgs, msgs...)
	var res push.Result
	for _, m := range msgs {
		if f.Invalid[m.To] {
			res.InvalidTokens = append(res.InvalidTokens, m.To)
		}
	}
	return res
}

// To returns the recorded messages sent to a device token.
func (f *FakePush) To(token string) []push.Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []push.Message
	for _, m := range f.Msgs {
		if m.To == token {
			out = append(out, m)
		}
	}
	return out
}

type Env struct {
	T        *testing.T
	D        *app.Deps
	Srv      *httptest.Server
	Push     *FakePush
	Realtime *realtime.Module
	Msg      *messaging.Module
	Notif    *notifications.Module

	mu     sync.Mutex
	users  []string
	phones []string
}

// New builds an isolated server (own rate limiters, own hub) on the shared test database.
// Skips the test when the database is unreachable.
func New(t *testing.T, rt realtime.Options) *Env {
	t.Helper()
	p, err := sharedPool()
	if err != nil {
		t.Skipf("test database unavailable: %v", err)
	}
	cfg := config.Load()
	cfg.Env, cfg.IsProd = "test", false
	cfg.CORSOrigins = []string{"http://localhost:3000"}
	cfg.SMS.Provider, cfg.SMS.OTPDevCode = "console", "111111"
	cfg.JWT.AccessSecret, cfg.JWT.AccessTTL = "test-access-secret", 900
	cfg.Storage.Driver = "none"
	d := app.Build(cfg, p)
	fp := &FakePush{Invalid: map[string]bool{}}
	e := &Env{T: t, D: d, Push: fp}
	e.Msg = messaging.New(d)
	e.Notif = notifications.New(d)
	pm := push.NewWithProvider(d, fp)
	e.Realtime = realtime.NewWithOptions(d, rt)
	e.Srv = httptest.NewServer(server.New(d, []app.Module{e.Msg, e.Notif, pm, e.Realtime}))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		d.Shutdown(ctx)
		e.Srv.Close()
		d.Bus.Wait()
		e.cleanup(ctx)
	})
	return e
}

func (e *Env) cleanup(ctx context.Context) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.phones) > 0 {
		var ids []string
		rows, err := e.D.Pool.Query(ctx, `select id::text from users where phone = any($1)`, e.phones)
		if err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					ids = append(ids, id)
				}
			}
			rows.Close()
		}
		e.users = append(e.users, ids...)
	}
	if len(e.users) == 0 {
		return
	}
	_, _ = e.D.Pool.Exec(ctx, `delete from listings where owner_id = any($1::uuid[])`, e.users)
	_, _ = e.D.Pool.Exec(ctx, `delete from users where id = any($1::uuid[])`, e.users)
}

// RandomPhone returns a fresh +99450xxxxxxx number.
func RandomPhone() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(10_000_000))
	return fmt.Sprintf("+99450%07d", n.Int64())
}

type UserOpts struct {
	Role        string // USER (default) | ADMIN | MODERATOR
	AccountType string // INDIVIDUAL (default) | BUSINESS
	Status      string // ACTIVE (default)
	AvatarURL   string
}

// User inserts a user directly (users module is not part of this workstream) and returns (id, accessToken).
func (e *Env) User(name string, o UserOpts) (string, string) {
	e.T.Helper()
	if o.Role == "" {
		o.Role = "USER"
	}
	if o.AccountType == "" {
		o.AccountType = "INDIVIDUAL"
	}
	if o.Status == "" {
		o.Status = "ACTIVE"
	}
	var avatar *string
	if o.AvatarURL != "" {
		avatar = &o.AvatarURL
	}
	var id string
	err := e.D.Pool.QueryRow(context.Background(), `insert into users (name, phone, role, account_type, status, avatar_url, is_phone_verified)
		values ($1,$2,$3,$4,$5,$6,true) returning id::text`, name, RandomPhone(), o.Role, o.AccountType, o.Status, avatar).Scan(&id)
	if err != nil {
		e.T.Fatalf("insert user: %v", err)
	}
	e.mu.Lock()
	e.users = append(e.users, id)
	e.mu.Unlock()
	tok, err := e.D.Signer.Sign(auth.User{ID: id, Role: o.Role, AccountType: o.AccountType})
	if err != nil {
		e.T.Fatal(err)
	}
	return id, tok
}

// Listing inserts an ACTIVE (or given status) listing owned by ownerID, optionally with a cover image.
func (e *Env) Listing(ownerID, status string, cover string) string {
	e.T.Helper()
	if status == "" {
		status = "ACTIVE"
	}
	var id string
	err := e.D.Pool.QueryRow(context.Background(), `insert into listings (owner_id, deal_type, property_type, title, description, price,
		city_id, area, rooms, contact_name, contact_phone, status)
		values ($1,'SALE','APARTMENT','3 otaqlı mənzil, Nəsimi','Təsvir',185000,'baku',92,3,'Satıcı','+994501112233',$2) returning id::text`,
		ownerID, status).Scan(&id)
	if err != nil {
		e.T.Fatalf("insert listing: %v", err)
	}
	if cover != "" {
		if _, err := e.D.Pool.Exec(context.Background(), `insert into listing_images (listing_id, url, thumb_url, "order") values ($1,$2,$3,1), ($1,'x','other-thumb',2)`,
			id, cover+"-full", cover); err != nil {
			e.T.Fatal(err)
		}
	}
	return id
}

// PushToken registers a device token directly (the endpoint lives in the users module).
func (e *Env) PushToken(userID, token, platform string) {
	e.T.Helper()
	if _, err := e.D.Pool.Exec(context.Background(), `insert into push_tokens (token, user_id, platform) values ($1,$2,$3)`, token, userID, platform); err != nil {
		e.T.Fatal(err)
	}
}

// TrackPhone marks an OTP-created user for cleanup.
func (e *Env) TrackPhone(phone string) {
	e.mu.Lock()
	e.phones = append(e.phones, phone)
	e.mu.Unlock()
}

// Do performs an API request (path relative to /api/v1) and returns status + raw body.
func (e *Env) Do(method, path, token string, body any) (int, []byte) {
	e.T.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.Srv.URL+server.APIPrefix+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.T.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, raw
}

// JSON performs a request, asserts the status and decodes the body into out (if non-nil).
func (e *Env) JSON(method, path, token string, body any, wantStatus int, out any) {
	e.T.Helper()
	st, raw := e.Do(method, path, token, body)
	if st != wantStatus {
		e.T.Fatalf("%s %s: status %d, want %d: %s", method, path, st, wantStatus, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.T.Fatalf("%s %s: decode: %v (%s)", method, path, err, raw)
		}
	}
}

// ErrCode performs a request and asserts status + ApiError.code.
func (e *Env) ErrCode(method, path, token string, body any, wantStatus int, wantCode string) {
	e.T.Helper()
	st, raw := e.Do(method, path, token, body)
	var ae struct {
		StatusCode int    `json:"statusCode"`
		Code       string `json:"code"`
	}
	_ = json.Unmarshal(raw, &ae)
	if st != wantStatus || ae.Code != wantCode || ae.StatusCode != wantStatus {
		e.T.Fatalf("%s %s: got %d %q, want %d %q: %s", method, path, st, ae.Code, wantStatus, wantCode, raw)
	}
}

// WSURL is the WebSocket endpoint with ?token=.
func (e *Env) WSURL(token string) string {
	u := strings.Replace(e.Srv.URL, "http://", "ws://", 1) + realtime.Path
	if token != "" {
		u += "?token=" + token
	}
	return u
}

// Dial connects to /ws and waits until the server registered the connection.
func (e *Env) Dial(token, userID string) *WS {
	e.T.Helper()
	before := e.Realtime.Hub().Connections(userID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, e.WSURL(token), nil)
	if err != nil {
		e.T.Fatalf("dial: %v", err)
	}
	ws := &WS{t: e.T, C: c, frames: make(chan Frame, 256), done: make(chan struct{})}
	go ws.pump()
	e.T.Cleanup(func() { _ = c.Close(websocket.StatusNormalClosure, "") })
	Eventually(e.T, 3*time.Second, func() bool { return e.Realtime.Hub().Connections(userID) > before })
	return ws
}

// Frame is a decoded server frame.
type Frame struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

// WS is a test client that buffers incoming frames (ping frames included) in a channel.
type WS struct {
	t      *testing.T
	C      *websocket.Conn
	frames chan Frame
	done   chan struct{}
	Err    error // read error that ended the pump (close status via websocket.CloseStatus)
}

func (w *WS) pump() {
	defer close(w.done)
	for {
		_, data, err := w.C.Read(context.Background())
		if err != nil {
			w.Err = err
			return
		}
		var f Frame
		if json.Unmarshal(data, &f) == nil {
			w.frames <- f
		}
	}
}

// Send writes a client frame.
func (w *WS) Send(event string, data any) {
	w.t.Helper()
	m := map[string]any{"event": event}
	if data != nil {
		m["data"] = data
	}
	b, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := w.C.Write(ctx, websocket.MessageText, b); err != nil {
		w.t.Fatalf("ws write: %v", err)
	}
}

// AutoPong answers every ping with pong in the background (other frames are discarded) until the connection ends.
func (w *WS) AutoPong() {
	go func() {
		pong := []byte(`{"event":"pong"}`)
		for {
			select {
			case f := <-w.frames:
				if f.Event == "ping" {
					ctx, cancel := context.WithTimeout(context.Background(), time.Second)
					_ = w.C.Write(ctx, websocket.MessageText, pong)
					cancel()
				}
			case <-w.done:
				return
			}
		}
	}()
}

// Expect waits for the next frame with the given event (other events, e.g. ping, are skipped) and decodes data.
func (w *WS) Expect(event string, timeout time.Duration, out any) {
	w.t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case f := <-w.frames:
			if f.Event != event {
				continue
			}
			if out != nil {
				if err := json.Unmarshal(f.Data, out); err != nil {
					w.t.Fatalf("decode %s: %v (%s)", event, err, f.Data)
				}
			}
			return
		case <-w.done:
			w.t.Fatalf("connection closed while waiting for %q: %v", event, w.Err)
		case <-deadline:
			w.t.Fatalf("timeout waiting for %q", event)
		}
	}
}

// ExpectNone asserts that no frame with the given event arrives within d.
func (w *WS) ExpectNone(event string, d time.Duration) {
	w.t.Helper()
	deadline := time.After(d)
	for {
		select {
		case f := <-w.frames:
			if f.Event == event {
				w.t.Fatalf("unexpected %q frame: %s", event, f.Data)
			}
		case <-w.done:
			return
		case <-deadline:
			return
		}
	}
}

// Closed waits for the connection to end and returns the close status (-1 if not a close frame).
func (w *WS) Closed(timeout time.Duration) websocket.StatusCode {
	w.t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case <-w.frames: // drain
		case <-w.done:
			return websocket.CloseStatus(w.Err)
		case <-deadline:
			w.t.Fatalf("connection still open after %s", timeout)
		}
	}
}

// Eventually polls cond until true or fails after timeout.
func Eventually(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	end := time.Now().Add(timeout)
	for time.Now().Before(end) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition not met within %s", timeout)
}
