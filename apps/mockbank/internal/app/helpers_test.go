package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/config"
	"github.com/alasgarovnamig/evtap/mockbank/internal/sig"
)

const (
	merchantID     = "evtap"
	merchantSecret = "test-secret"
)

// baseDB is the database the tests run in; every test server works in its own schema.
func baseDB() string {
	for _, k := range []string{"TEST_DATABASE_URL", "DATABASE_URL"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return "postgres://evtap:evtap@localhost:5432/mockbank_go_test"
}

var schemaSeq atomic.Int64

func withSearchPath(dbURL, schema string) string {
	sep := "?"
	if strings.Contains(dbURL, "?") {
		sep = "&"
	}
	return dbURL + sep + "search_path=" + url.QueryEscape(schema)
}

// testServer is a full mock bank (HTTP + scheduler) on a random port, in its own schema.
type testServer struct {
	t      *testing.T
	App    *App
	URL    string
	DBURL  string
	Schema string
	srv    *httptest.Server
	closed bool
}

type serverOpts struct {
	schema   string // reuse an existing schema (keep data)
	scale    float64
	isProd   bool
	noSched  bool
	keepData bool
}

func startTestServer(t *testing.T, o serverOpts) *testServer {
	t.Helper()
	ctx := context.Background()
	schema := o.schema
	if schema == "" {
		schema = fmt.Sprintf("mockbank_test_%d_%d_%d", os.Getpid(), time.Now().UnixNano()%1_000_000, schemaSeq.Add(1))
		admin, err := pgxpool.New(ctx, baseDB())
		if err != nil {
			t.Fatalf("connect %s: %v", baseDB(), err)
		}
		if _, err := admin.Exec(ctx, fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE; CREATE SCHEMA %s", schema, schema)); err != nil {
			t.Fatalf("create schema: %v", err)
		}
		admin.Close()
		t.Cleanup(func() {
			admin, err := pgxpool.New(context.Background(), baseDB())
			if err == nil {
				_, _ = admin.Exec(context.Background(), fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema))
				admin.Close()
			}
		})
	}
	scale := o.scale
	if scale == 0 {
		scale = 0.001
	}
	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "silent"
	}
	dbURL := withSearchPath(baseDB(), schema)
	cfg := &config.Config{
		Env:    "test",
		IsProd: o.isProd,
		Merchants: []config.MerchantSeed{
			{ID: merchantID, Secret: merchantSecret, Name: "EvTap"},
			{ID: "other", Secret: "other-secret", Name: "Other Shop"},
		},
		DatabaseURL:        dbURL,
		AdminUser:          "admin",
		AdminPass:          "admin",
		OrderTTLMinutes:    30,
		WebhookRetryScale:  scale,
		WebhookTimeout:     2 * time.Second,
		SchedulerInterval:  40 * time.Millisecond,
		SignatureTolerance: 5 * time.Minute,
		LogLevel:           logLevel,
	}
	pool, err := NewPool(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	a := New(cfg, pool, nil)
	if err := a.Init(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	srv := httptest.NewServer(a.Handler())
	cfg.PublicURL = srv.URL
	if !o.noSched {
		a.Scheduler.Start()
	}
	ts := &testServer{t: t, App: a, URL: srv.URL, DBURL: dbURL, Schema: schema, srv: srv}
	t.Cleanup(ts.Close)
	return ts
}

// Close stops the server like a real shutdown (scheduler, HTTP, in-flight webhooks, pool).
func (s *testServer) Close() {
	if s.closed {
		return
	}
	s.closed = true
	s.App.Scheduler.Stop()
	s.srv.Close()
	s.App.Webhooks.Drain()
	s.App.DB.Close()
}

// ---------------------------------------------------------------- HTTP helpers

var httpClient = &http.Client{
	Transport:     &http.Transport{Proxy: nil},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	Timeout:       20 * time.Second,
}

type apiOpts struct {
	merchantID string
	secret     string
	timestamp  time.Time
	tamper     bool
}

type apiResult struct {
	Status int
	JSON   map[string]any
	Raw    string
}

func (r apiResult) str(key string) string {
	v, _ := r.JSON[key].(string)
	return v
}

func (r apiResult) num(key string) float64 {
	v, _ := r.JSON[key].(float64)
	return v
}

var firstDigit = regexp.MustCompile(`\d`)

// api performs a signed merchant API call.
func (s *testServer) api(method, path string, body any, opts ...apiOpts) apiResult {
	s.t.Helper()
	o := apiOpts{}
	if len(opts) > 0 {
		o = opts[0]
	}
	if o.merchantID == "" {
		o.merchantID = merchantID
	}
	if o.secret == "" {
		o.secret = merchantSecret
	}
	if o.timestamp.IsZero() {
		o.timestamp = time.Now()
	}
	raw := ""
	if body != nil {
		b, err := MarshalJSON(body)
		if err != nil {
			s.t.Fatal(err)
		}
		raw = string(b)
	}
	sent := raw
	if o.tamper {
		loc := firstDigit.FindStringIndex(raw)
		sent = raw[:loc[0]] + "9" + raw[loc[1]:]
	}
	var rd io.Reader
	if sent != "" {
		rd = strings.NewReader(sent)
	}
	req, _ := http.NewRequest(method, s.URL+"/api/v1"+path, rd)
	sig.SetHeaders(req.Header, o.merchantID, o.secret, raw, o.timestamp)
	if raw != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := httpClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	out := apiResult{Status: res.StatusCode, Raw: string(b)}
	if len(b) > 0 {
		_ = json.Unmarshal(b, &out.JSON)
	}
	return out
}

type page struct {
	Status   int
	Location string
	HTML     string
	Header   http.Header
}

func getPage(t *testing.T, u string, headers ...map[string]string) page {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	for _, h := range headers {
		for k, v := range h {
			req.Header.Set(k, v)
		}
	}
	return do(t, req)
}

func postForm(t *testing.T, u string, fields map[string]string, headers ...map[string]string) page {
	t.Helper()
	form := url.Values{}
	for k, v := range fields {
		form.Set(k, v)
	}
	req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, h := range headers {
		for k, v := range h {
			req.Header.Set(k, v)
		}
	}
	return do(t, req)
}

func do(t *testing.T, req *http.Request) page {
	t.Helper()
	res, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return page{Status: res.StatusCode, Location: res.Header.Get("Location"), HTML: string(b), Header: res.Header}
}

func adminAuth(user, password string) map[string]string {
	return map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+password))}
}

var nonceRe = regexp.MustCompile(`name="nonce" value="([^"]+)"`)

func extractNonce(t *testing.T, html string) string {
	t.Helper()
	m := nonceRe.FindStringSubmatch(html)
	if m == nil {
		t.Fatalf("nonce not found in page:\n%s", html)
	}
	return m[1]
}

func futureExpiry() string { return fmt.Sprintf("12/%02d", (time.Now().Year()+2)%100) }

func uuid() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func (s *testServer) orderBody(rcv *receiver, extra map[string]any) map[string]any {
	callback := "http://127.0.0.1:9/never"
	if rcv != nil {
		callback = rcv.URL
	}
	b := map[string]any{
		"amount":          1500,
		"currency":        "AZN",
		"merchantOrderId": uuid(),
		"description":     "VIP (7 gün)",
		"language":        "en",
		"returnUrl":       "https://evtap.test/api/v1/payments/return/mockbank?paymentId=p1",
		"callbackUrl":     callback,
	}
	for k, v := range extra {
		b[k] = v
	}
	return b
}

func (s *testServer) createOrder(rcv *receiver, extra map[string]any) string {
	s.t.Helper()
	res := s.api("POST", "/orders", s.orderBody(rcv, extra))
	if res.Status != 201 {
		s.t.Fatalf("create order failed: %d %s", res.Status, res.Raw)
	}
	return res.str("orderId")
}

// submitCard opens the hosted page and submits the card form.
func (s *testServer) submitCard(orderID, card string, extra map[string]string) page {
	s.t.Helper()
	p := getPage(s.t, s.URL+"/checkout/"+orderID)
	if p.Status != 200 {
		s.t.Fatalf("checkout page status %d", p.Status)
	}
	fields := map[string]string{
		"nonce":  extractNonce(s.t, p.HTML),
		"number": card,
		"expiry": futureExpiry(),
		"cvv":    "123",
		"holder": "Test Cardholder",
	}
	for k, v := range extra {
		fields[k] = v
	}
	return postForm(s.t, s.URL+"/checkout/"+orderID+"/pay", fields)
}

func (s *testServer) submitOTP(orderID, otp string) page {
	s.t.Helper()
	p := getPage(s.t, s.URL+"/checkout/"+orderID+"/3ds")
	if p.Status != 200 {
		s.t.Fatalf("3ds page status %d", p.Status)
	}
	return postForm(s.t, s.URL+"/checkout/"+orderID+"/3ds", map[string]string{"nonce": extractNonce(s.t, p.HTML), "otp": otp})
}

func (s *testServer) getOrder(orderID string) apiResult {
	s.t.Helper()
	return s.api("GET", "/orders/"+orderID, nil)
}

// ---------------------------------------------------------------- webhook receiver

type received struct {
	Path    string
	Headers http.Header
	Body    string
	JSON    map[string]any
}

func (r received) event() string { v, _ := r.JSON["event"].(string); return v }

func (r received) order() map[string]any { v, _ := r.JSON["order"].(map[string]any); return v }

// receiver stands in for the merchant's webhook endpoint.
type receiver struct {
	URL     string
	mu      sync.Mutex
	reqs    []received
	respond func(r received, index int) int
	srv     *httptest.Server
}

func startReceiver(t *testing.T) *receiver {
	rc := &receiver{respond: func(received, int) int { return 200 }}
	rc.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		b, _ := io.ReadAll(req.Body)
		e := received{Path: req.URL.Path, Headers: req.Header.Clone(), Body: string(b)}
		_ = json.Unmarshal(b, &e.JSON)
		rc.mu.Lock()
		rc.reqs = append(rc.reqs, e)
		idx := len(rc.reqs) - 1
		respond := rc.respond
		rc.mu.Unlock()
		status := respond(e, idx)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		fmt.Fprintf(w, `{"ok":%v}`, status < 300)
	}))
	rc.URL = rc.srv.URL + "/webhook"
	t.Cleanup(rc.srv.Close)
	return rc
}

func (rc *receiver) setRespond(fn func(r received, index int) int) {
	rc.mu.Lock()
	rc.respond = fn
	rc.mu.Unlock()
}

func (rc *receiver) all() []received {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return append([]received(nil), rc.reqs...)
}

func (rc *receiver) hooksFor(orderID string) []received {
	var out []received
	for _, r := range rc.all() {
		if r.order()["orderId"] == orderID {
			out = append(out, r)
		}
	}
	return out
}

// waitFor polls fn until it returns true.
func waitFor(t *testing.T, timeout time.Duration, label string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if fn() {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", label)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// ---------------------------------------------------------------- assertions

func eq[T comparable](t *testing.T, got, want T, msg ...any) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: got %#v, want %#v", fmt.Sprint(msg...), got, want)
	}
}

func match(t *testing.T, s, pattern string, msg ...any) {
	t.Helper()
	if !regexp.MustCompile(pattern).MatchString(s) {
		t.Fatalf("%s: %q does not match /%s/", fmt.Sprint(msg...), truncate(s), pattern)
	}
}

func noMatch(t *testing.T, s, pattern string, msg ...any) {
	t.Helper()
	if regexp.MustCompile(pattern).MatchString(s) {
		t.Fatalf("%s: %q unexpectedly matches /%s/", fmt.Sprint(msg...), truncate(s), pattern)
	}
}

func stringsReader(s string) io.Reader { return strings.NewReader(s) }

// signRaw signs a request for the default merchant over raw.
func signRaw(req *http.Request, raw string) {
	sig.SetHeaders(req.Header, merchantID, merchantSecret, raw, time.Now())
}

// setSigned signs a body-less request, optionally with an uppercase signature.
func setSigned(req *http.Request, ts time.Time, upper bool) {
	sig.SetHeaders(req.Header, merchantID, merchantSecret, "", ts)
	if upper {
		req.Header.Set(sig.HeaderSignature, strings.ToUpper(req.Header.Get(sig.HeaderSignature)))
	}
}

func truncate(s string) string {
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}
