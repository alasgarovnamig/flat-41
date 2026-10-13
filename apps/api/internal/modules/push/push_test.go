package push

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/alasgarovnamig/evtap/api/internal/config"
)

func msg(to, platform string) Message {
	return Message{To: to, Platform: platform, Title: "Yeni mesaj", Body: "Salam", Data: map[string]any{
		"type": "NEW_MESSAGE", "conversationId": "c1", "count": 3, "flag": true, "nested": map[string]any{"a": 1}, "nil": nil,
	}}
}

// ───────── payloads ─────────

func TestExpoPayload(t *testing.T) {
	got := ExpoPayload(msg("ExponentPushToken[abc]", "android"))
	want := map[string]any{"to": "ExponentPushToken[abc]", "title": "Yeni mesaj", "body": "Salam", "sound": "default", "priority": "high",
		"data": msg("", "").Data}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
	if d := ExpoPayload(Message{To: "x"})["data"]; d == nil {
		t.Fatal("data must default to {}")
	}
}

func TestFCMPayload(t *testing.T) {
	m := msg("fcm-token", "android")
	m.Data["from"] = "x"
	m.Data["google.c"] = "x"
	b, _ := json.Marshal(FCMPayload(m))
	var got map[string]any
	_ = json.Unmarshal(b, &got)
	want := map[string]any{"message": map[string]any{
		"token":        "fcm-token",
		"notification": map[string]any{"title": "Yeni mesaj", "body": "Salam"},
		"data":         map[string]any{"type": "NEW_MESSAGE", "conversationId": "c1", "count": "3", "flag": "true", "nested": `{"a":1}`},
		"android":      map[string]any{"priority": "HIGH", "notification": map[string]any{"sound": "default"}},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %s", b)
	}
}

func TestAPNsPayload(t *testing.T) {
	m := msg("ios-token", "ios")
	m.Data["aps"] = "must not override"
	b, _ := json.Marshal(APNsPayload(m))
	var got map[string]any
	_ = json.Unmarshal(b, &got)
	want := map[string]any{
		"aps":            map[string]any{"alert": map[string]any{"title": "Yeni mesaj", "body": "Salam"}, "sound": "default"},
		"type":           "NEW_MESSAGE",
		"conversationId": "c1",
		"count":          float64(3),
		"flag":           true,
		"nested":         map[string]any{"a": float64(1)},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %s", b)
	}
}

func TestIsExpoToken(t *testing.T) {
	for tok, want := range map[string]bool{"ExponentPushToken[xx]": true, "ExpoPushToken[yy]": true, "ExponentPushToken[]": false, "fcm:abc": false} {
		if IsExpoToken(tok) != want {
			t.Errorf("IsExpoToken(%q) != %v", tok, want)
		}
	}
}

// ───────── Expo ─────────

func TestExpoSendBatchesAndReceipts(t *testing.T) {
	var mu sync.Mutex
	var batches []int
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		auth = r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/send":
			var in []map[string]any
			_ = json.Unmarshal(body, &in)
			batches = append(batches, len(in))
			var out []map[string]any
			for _, m := range in {
				to := m["to"].(string)
				switch {
				case strings.Contains(to, "dead"):
					out = append(out, map[string]any{"status": "error", "message": "not registered", "details": map[string]any{"error": "DeviceNotRegistered"}})
				case strings.Contains(to, "flaky"):
					out = append(out, map[string]any{"status": "error", "details": map[string]any{"error": "MessageRateExceeded"}})
				default:
					out = append(out, map[string]any{"status": "ok", "id": "ticket-" + strings.TrimSuffix(strings.TrimPrefix(to, "ExponentPushToken["), "]")})
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": out})
		case "/receipts":
			var in struct{ IDs []string }
			_ = json.Unmarshal(body, &in)
			out := map[string]any{}
			for _, id := range in.IDs {
				if strings.HasSuffix(id, "-7") {
					out[id] = map[string]any{"status": "error", "details": map[string]any{"error": "DeviceNotRegistered"}}
				} else {
					out[id] = map[string]any{"status": "ok"}
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": out})
		}
	}))
	defer srv.Close()

	now := time.Now()
	p := NewExpo("expo-secret")
	p.SendURL, p.ReceiptsURL, p.Now = srv.URL+"/send", srv.URL+"/receipts", func() time.Time { return now }

	var msgs []Message
	for i := 0; i < 150; i++ {
		msgs = append(msgs, Message{To: fmt.Sprintf("ExponentPushToken[t-%d]", i), Title: "t", Body: "b"})
	}
	msgs = append(msgs, Message{To: "ExponentPushToken[dead-1]"}, Message{To: "ExponentPushToken[flaky-1]"}, Message{To: "not-an-expo-token"})
	res := p.Send(context.Background(), msgs)
	if !reflect.DeepEqual(batches, []int{100, 52}) {
		t.Fatalf("batches = %v", batches)
	}
	if auth != "Bearer expo-secret" {
		t.Fatalf("auth = %q", auth)
	}
	if !reflect.DeepEqual(res.InvalidTokens, []string{"ExponentPushToken[dead-1]"}) {
		t.Fatalf("invalid = %v", res.InvalidTokens)
	}
	if p.PendingReceipts() != 150 {
		t.Fatalf("pending = %d", p.PendingReceipts())
	}
	// not due yet
	if r := p.CollectReceipts(context.Background()); len(r.InvalidTokens) != 0 || p.PendingReceipts() != 150 {
		t.Fatal("receipts checked too early")
	}
	now = now.Add(16 * time.Minute)
	r := p.CollectReceipts(context.Background())
	sort.Strings(r.InvalidTokens)
	if !reflect.DeepEqual(r.InvalidTokens, []string{"ExponentPushToken[t-7]"}) || p.PendingReceipts() != 0 {
		t.Fatalf("receipts invalid = %v pending = %d", r.InvalidTokens, p.PendingReceipts())
	}
	// stale tickets (> 24 h) are dropped without a request
	p.Send(context.Background(), []Message{{To: "ExponentPushToken[late]"}})
	now = now.Add(25 * time.Hour)
	p.CollectReceipts(context.Background())
	if p.PendingReceipts() != 0 {
		t.Fatal("stale ticket kept")
	}
}

func TestExpoSendHTTPErrorIsBestEffort(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()
	p := NewExpo("")
	p.SendURL = srv.URL
	if r := p.Send(context.Background(), []Message{{To: "ExponentPushToken[a]"}}); len(r.InvalidTokens) != 0 {
		t.Fatal(r)
	}
}

// ───────── FCM ─────────

func serviceAccount(t *testing.T, tokenURI string) ([]byte, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	b, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": "evtap-test", "private_key_id": "kid-1", "private_key": string(pemKey),
		"client_email": "push@evtap-test.iam.gserviceaccount.com", "client_id": "1", "token_uri": tokenURI,
	})
	return b, key
}

func TestFCMJWTAssertionAndSend(t *testing.T) {
	var key *rsa.PrivateKey
	var tokenRequests atomic.Int32
	var assertionClaims jwt.MapClaims
	var assertionHeader map[string]any
	var tokenURI string
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenRequests.Add(1)
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
			http.Error(w, "bad grant", 400)
			return
		}
		tok, err := jwt.Parse(r.Form.Get("assertion"), func(tk *jwt.Token) (any, error) { return &key.PublicKey, nil },
			jwt.WithValidMethods([]string{"RS256"}))
		if err != nil {
			http.Error(w, err.Error(), 401)
			return
		}
		assertionClaims = tok.Claims.(jwt.MapClaims)
		assertionHeader = tok.Header
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"ya29.test-token","token_type":"Bearer","expires_in":3600}`))
	}))
	defer tokenSrv.Close()
	tokenURI = tokenSrv.URL + "/token"
	sa, k := serviceAccount(t, tokenURI)
	key = k

	var mu sync.Mutex
	var paths, auths []string
	bodies := map[string]map[string]any{}
	fcmSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		token := body["message"].(map[string]any)["token"].(string)
		mu.Lock()
		paths = append(paths, r.URL.Path)
		auths = append(auths, r.Header.Get("Authorization"))
		bodies[token] = body
		mu.Unlock()
		switch token {
		case "gone":
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`))
		case "malformed":
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error":{"code":400,"message":"The registration token is not a valid FCM registration token","status":"INVALID_ARGUMENT"}}`))
		case "busy":
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"error":{"code":503,"status":"UNAVAILABLE"}}`))
		default:
			_, _ = w.Write([]byte(`{"name":"projects/evtap-test/messages/1"}`))
		}
	}))
	defer fcmSrv.Close()

	p, err := NewFCM(sa)
	if err != nil {
		t.Fatal(err)
	}
	if p.ProjectID != "evtap-test" {
		t.Fatalf("project = %q", p.ProjectID)
	}
	p.Endpoint = fcmSrv.URL
	res := p.Send(context.Background(), []Message{msg("ok-1", "android"), msg("gone", "android"), msg("malformed", "web"), msg("busy", "android"), msg("ok-2", "android")})
	sort.Strings(res.InvalidTokens)
	if !reflect.DeepEqual(res.InvalidTokens, []string{"gone", "malformed"}) {
		t.Fatalf("invalid = %v", res.InvalidTokens)
	}
	if len(paths) != 5 || paths[0] != "/v1/projects/evtap-test/messages:send" {
		t.Fatalf("paths = %v", paths)
	}
	for _, a := range auths {
		if a != "Bearer ya29.test-token" {
			t.Fatalf("authorization = %q", a)
		}
	}
	if n := tokenRequests.Load(); n != 1 {
		t.Fatalf("token requests = %d (access token must be cached)", n)
	}
	// the service-account assertion: RS256, kid, iss/scope/aud/exp
	if assertionHeader["alg"] != "RS256" || assertionHeader["kid"] != "kid-1" {
		t.Fatalf("assertion header = %v", assertionHeader)
	}
	if assertionClaims["iss"] != "push@evtap-test.iam.gserviceaccount.com" || assertionClaims["scope"] != FCMScope || assertionClaims["aud"] != tokenURI {
		t.Fatalf("assertion claims = %v", assertionClaims)
	}
	iat, _ := assertionClaims["iat"].(float64)
	exp, _ := assertionClaims["exp"].(float64)
	if exp-iat != 3600 {
		t.Fatalf("assertion lifetime = %v", exp-iat)
	}
	if d := bodies["ok-1"]["message"].(map[string]any)["data"].(map[string]any); d["count"] != "3" || d["type"] != "NEW_MESSAGE" {
		t.Fatalf("fcm data = %v", d)
	}
}

func TestFCMConfigErrors(t *testing.T) {
	if _, err := NewFCM([]byte(`{`)); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
	if _, err := NewFCM([]byte(`{"type":"authorized_user"}`)); err == nil {
		t.Fatal("expected error for non service-account JSON")
	}
}

// ───────── APNs ─────────

func p8(t *testing.T) (string, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), key
}

func TestAPNsJWTSigningAndCaching(t *testing.T) {
	pemKey, key := p8(t)
	// single-line env form with literal \n
	p, err := NewAPNs("KEY123ABCD", "TEAM456XYZ", strings.ReplaceAll(pemKey, "\n", `\n`), "az.evtap.app", true)
	if err != nil {
		t.Fatal(err)
	}
	if p.Endpoint != APNsSandboxEndpoint {
		t.Fatalf("endpoint = %s", p.Endpoint)
	}
	now := time.Unix(1_800_000_000, 0)
	p.Now = func() time.Time { return now }
	tok, err := p.bearer()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(tok, func(*jwt.Token) (any, error) { return &key.PublicKey, nil }, jwt.WithValidMethods([]string{"ES256"}),
		jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	c := parsed.Claims.(jwt.MapClaims)
	if parsed.Header["kid"] != "KEY123ABCD" || parsed.Header["alg"] != "ES256" || c["iss"] != "TEAM456XYZ" || c["iat"] != float64(now.Unix()) {
		t.Fatalf("header %v claims %v", parsed.Header, c)
	}
	if len(c) != 2 {
		t.Fatalf("unexpected claims: %v", c)
	}
	now = now.Add(49 * time.Minute)
	if again, _ := p.bearer(); again != tok {
		t.Fatal("token must be cached for 50 minutes")
	}
	now = now.Add(2 * time.Minute)
	if again, _ := p.bearer(); again == tok {
		t.Fatal("token must be refreshed after 50 minutes")
	}
	if _, err := NewAPNs("k", "t", "not a key", "az.evtap.app", false); err == nil {
		t.Fatal("expected invalid key error")
	}
	if p2, _ := NewAPNs("k", "t", pemKey, "az.evtap.app", false); p2.Endpoint != APNsProductionEndpoint {
		t.Fatal("production endpoint expected")
	}
}

func TestAPNsSendOverHTTP2(t *testing.T) {
	pemKey, key := p8(t)
	var mu sync.Mutex
	seen := map[string]http.Header{}
	var protos []int
	var expiredOnce atomic.Bool
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.URL.Path, "/3/device/")
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		seen[token] = r.Header.Clone()
		protos = append(protos, r.ProtoMajor)
		mu.Unlock()
		bearer := strings.TrimPrefix(r.Header.Get("authorization"), "bearer ")
		if _, err := jwt.Parse(bearer, func(*jwt.Token) (any, error) { return &key.PublicKey, nil }, jwt.WithValidMethods([]string{"ES256"})); err != nil {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"reason":"InvalidProviderToken"}`))
			return
		}
		var payload map[string]any
		if json.Unmarshal(body, &payload) != nil || payload["aps"] == nil {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"reason":"PayloadEmpty"}`))
			return
		}
		switch token {
		case "uninstalled":
			w.WriteHeader(410)
			_, _ = w.Write([]byte(`{"reason":"Unregistered","timestamp":1700000000000}`))
		case "bad":
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"reason":"BadDeviceToken"}`))
		case "expired":
			if !expiredOnce.Swap(true) {
				w.WriteHeader(403)
				_, _ = w.Write([]byte(`{"reason":"ExpiredProviderToken"}`))
				return
			}
			w.WriteHeader(200)
		default:
			w.WriteHeader(200)
		}
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	defer srv.Close()

	p, err := NewAPNs("KEY123ABCD", "TEAM456XYZ", pemKey, "az.evtap.app", false)
	if err != nil {
		t.Fatal(err)
	}
	p.Endpoint, p.Client = srv.URL, srv.Client()
	res := p.Send(context.Background(), []Message{msg("ok", "ios"), msg("uninstalled", "ios"), msg("bad", "ios")})
	sort.Strings(res.InvalidTokens)
	if !reflect.DeepEqual(res.InvalidTokens, []string{"bad", "uninstalled"}) {
		t.Fatalf("invalid = %v", res.InvalidTokens)
	}
	h := seen["ok"]
	if h.Get("apns-topic") != "az.evtap.app" || h.Get("apns-push-type") != "alert" || h.Get("apns-priority") != "10" ||
		!strings.HasPrefix(h.Get("authorization"), "bearer ") {
		t.Fatalf("headers = %v", h)
	}
	for _, pm := range protos {
		if pm != 2 {
			t.Fatalf("APNs requests must use HTTP/2, got HTTP/%d", pm)
		}
	}
	// ExpiredProviderToken resets the cached provider token (and is not a device-token problem)
	if r := p.Send(context.Background(), []Message{msg("expired", "ios")}); len(r.InvalidTokens) != 0 {
		t.Fatalf("expired provider token reported as invalid device: %v", r.InvalidTokens)
	}
	p.mu.Lock()
	cached := p.token
	p.mu.Unlock()
	if cached != "" {
		t.Fatal("expired provider token must be dropped from the cache")
	}
}

// ───────── routing / config ─────────

type recorder struct {
	name string
	mu   sync.Mutex
	got  []string
}

func (r *recorder) Name() string { return r.name }
func (r *recorder) Send(_ context.Context, msgs []Message) Result {
	r.mu.Lock()
	defer r.mu.Unlock()
	var res Result
	for _, m := range msgs {
		r.got = append(r.got, m.To)
		if strings.HasPrefix(m.To, "dead") {
			res.InvalidTokens = append(res.InvalidTokens, m.To)
		}
	}
	return res
}

func TestNativeRouter(t *testing.T) {
	expo, apns, fcm := &recorder{name: "expo"}, &recorder{name: "apns"}, &recorder{name: "fcm"}
	r := &NativeRouter{Expo: expo, APNs: apns, FCM: fcm}
	res := r.Send(context.Background(), []Message{
		{To: "ExponentPushToken[ios-expo]", Platform: "ios"},
		{To: "ExponentPushToken[and-expo]", Platform: "android"},
		{To: "apns-1", Platform: "ios"},
		{To: "dead-apns", Platform: "ios"},
		{To: "fcm-1", Platform: "android"},
		{To: "web-1", Platform: "web"},
	})
	sort.Strings(expo.got)
	if !reflect.DeepEqual(expo.got, []string{"ExponentPushToken[and-expo]", "ExponentPushToken[ios-expo]"}) ||
		!reflect.DeepEqual(apns.got, []string{"apns-1", "dead-apns"}) || !reflect.DeepEqual(fcm.got, []string{"fcm-1", "web-1"}) {
		t.Fatalf("expo=%v apns=%v fcm=%v", expo.got, apns.got, fcm.got)
	}
	if !reflect.DeepEqual(res.InvalidTokens, []string{"dead-apns"}) {
		t.Fatalf("invalid = %v", res.InvalidTokens)
	}
	// unconfigured providers are skipped
	partial := &NativeRouter{FCM: fcm}
	if r := partial.Send(context.Background(), []Message{{To: "apns-2", Platform: "ios"}, {To: "ExponentPushToken[x]"}}); len(r.InvalidTokens) != 0 {
		t.Fatal(r)
	}
	if len(partial.CollectReceipts(context.Background()).InvalidTokens) != 0 {
		t.Fatal("no receipts without expo")
	}
}

func TestFromConfig(t *testing.T) {
	c := &config.Config{}
	if FromConfig(c).Name() != "console" {
		t.Fatal("console expected by default")
	}
	c.Push.Provider = "expo"
	if FromConfig(c).Name() != "expo" {
		t.Fatal("expo expected")
	}
	pemKey, _ := p8(t)
	sa, _ := serviceAccount(t, "https://oauth2.example/token")
	c.Push.Provider = "native"
	c.Push.APNs.KeyID, c.Push.APNs.TeamID, c.Push.APNs.KeyP8, c.Push.APNs.Topic = "K", "T", pemKey, "az.evtap.app"
	c.Push.FCMServiceAccountJSON = string(sa)
	r, ok := FromConfig(c).(*NativeRouter)
	if !ok || r.APNs == nil || r.FCM == nil || r.Expo == nil {
		t.Fatalf("native router = %+v", r)
	}
	c.Push.APNs.KeyP8 = "garbage"
	c.Push.FCMServiceAccountJSON = ""
	r = FromConfig(c).(*NativeRouter)
	if r.APNs != nil || r.FCM != nil {
		t.Fatal("misconfigured providers must be disabled")
	}
}
