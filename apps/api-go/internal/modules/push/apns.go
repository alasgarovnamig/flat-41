package push

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	APNsProductionEndpoint = "https://api.push.apple.com"
	APNsSandboxEndpoint    = "https://api.sandbox.push.apple.com"

	// Apple rejects provider tokens older than 1 h and throttles refreshes more often than every 20 min.
	apnsTokenTTL       = 50 * time.Minute
	apnsConcurrency    = 8
	apnsRequestTimeout = 15 * time.Second
)

// APNsProvider sends to iOS devices with token-based (.p8, ES256 JWT) authentication over HTTP/2.
type APNsProvider struct {
	KeyID, TeamID, Topic string
	Endpoint             string
	Client               *http.Client
	Concurrency          int
	Now                  func() time.Time

	key     *ecdsa.PrivateKey
	mu      sync.Mutex
	token   string
	tokenAt time.Time
}

// ParseP8 parses an APNs .p8 key (PKCS#8 PEM). Literal `\n` sequences (single-line env vars) are accepted.
func ParseP8(p8 string) (*ecdsa.PrivateKey, error) {
	pem := strings.TrimSpace(strings.ReplaceAll(p8, `\n`, "\n"))
	key, err := jwt.ParseECPrivateKeyFromPEM([]byte(pem))
	if err != nil {
		return nil, fmt.Errorf("APNS_KEY_P8: %w", err)
	}
	return key, nil
}

func NewAPNs(keyID, teamID, keyP8, topic string, sandbox bool) (*APNsProvider, error) {
	if keyID == "" || teamID == "" || topic == "" {
		return nil, errors.New("APNs: APNS_KEY_ID, APNS_TEAM_ID and APNS_TOPIC are required")
	}
	key, err := ParseP8(keyP8)
	if err != nil {
		return nil, err
	}
	endpoint := APNsProductionEndpoint
	if sandbox {
		endpoint = APNsSandboxEndpoint
	}
	// http.Transport negotiates HTTP/2 via ALPN (ForceAttemptHTTP2 is set on the default transport), which APNs requires.
	tr := http.DefaultTransport.(*http.Transport).Clone()
	return &APNsProvider{
		KeyID: keyID, TeamID: teamID, Topic: topic, Endpoint: endpoint, key: key, Now: time.Now,
		Client: &http.Client{Transport: tr, Timeout: apnsRequestTimeout}, Concurrency: apnsConcurrency,
	}, nil
}

func (p *APNsProvider) Name() string { return "apns" }

// SignAPNsJWT creates the provider authentication token: header {alg: ES256, kid}, claims {iss: teamID, iat}.
func SignAPNsJWT(key *ecdsa.PrivateKey, keyID, teamID string, iat time.Time) (string, error) {
	t := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"iss": teamID, "iat": iat.Unix()})
	t.Header["kid"] = keyID
	return t.SignedString(key)
}

// bearer returns the cached provider token, re-signing it every 50 minutes (or after Apple rejected it).
func (p *APNsProvider) bearer() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.Now()
	if p.token != "" && now.Sub(p.tokenAt) < apnsTokenTTL {
		return p.token, nil
	}
	tok, err := SignAPNsJWT(p.key, p.KeyID, p.TeamID, now)
	if err != nil {
		return "", err
	}
	p.token, p.tokenAt = tok, now
	return tok, nil
}

func (p *APNsProvider) resetToken() {
	p.mu.Lock()
	p.token = ""
	p.mu.Unlock()
}

// APNsPayload builds the JSON body: { aps: { alert: {title, body}, sound }, ...data } (custom keys at top level).
func APNsPayload(m Message) map[string]any {
	out := map[string]any{}
	for k, v := range m.Data {
		if k != "aps" && v != nil {
			out[k] = v
		}
	}
	out["aps"] = map[string]any{
		"alert": map[string]any{"title": m.Title, "body": m.Body},
		"sound": "default",
	}
	return out
}

// apnsTokenInvalid: 410 Unregistered, or 400 BadDeviceToken → the token will never work again for this topic/env.
func apnsTokenInvalid(status int, reason string) bool {
	return status == http.StatusGone || reason == "Unregistered" || reason == "BadDeviceToken"
}

func (p *APNsProvider) Send(ctx context.Context, msgs []Message) Result {
	return parallel(ctx, msgs, p.Concurrency, func(ctx context.Context, m Message) bool {
		b, _ := json.Marshal(APNsPayload(m))
		bearer, err := p.bearer()
		if err != nil {
			slog.Error("push:apns sign token", "err", err)
			return false
		}
		ctx, cancel := context.WithTimeout(ctx, apnsRequestTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.Endpoint, "/")+"/3/device/"+m.To, bytes.NewReader(b))
		if err != nil {
			return false
		}
		req.Header.Set("authorization", "bearer "+bearer)
		req.Header.Set("apns-topic", p.Topic)
		req.Header.Set("apns-push-type", "alert")
		req.Header.Set("apns-priority", "10")
		req.Header.Set("content-type", "application/json")
		res, err := p.Client.Do(req)
		if err != nil {
			slog.Warn("push:apns send error", "token", truncate(m.To, 32), "err", err)
			return false
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusOK {
			return false
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 16<<10))
		var e struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(raw, &e)
		if e.Reason == "ExpiredProviderToken" || e.Reason == "InvalidProviderToken" {
			p.resetToken()
		}
		if apnsTokenInvalid(res.StatusCode, e.Reason) {
			return true
		}
		slog.Warn("push:apns send failed", "token", truncate(m.To, 32), "status", res.StatusCode, "reason", e.Reason)
		return false
	})
}
