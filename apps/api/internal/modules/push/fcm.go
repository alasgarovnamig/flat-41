package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2/google"
	"golang.org/x/oauth2/jwt"
)

const (
	FCMEndpoint = "https://fcm.googleapis.com"
	FCMScope    = "https://www.googleapis.com/auth/firebase.messaging"

	fcmConcurrency    = 8
	fcmRequestTimeout = 15 * time.Second
)

// FCMProvider sends through Firebase Cloud Messaging HTTP v1 (one request per token — the v1 API has no batch call).
// Auth: OAuth2 access token obtained with a service-account JWT assertion (RS256), cached and refreshed by oauth2.
type FCMProvider struct {
	ProjectID   string
	Endpoint    string       // https://fcm.googleapis.com (overridable for tests)
	Client      *http.Client // OAuth2-authorised client
	Concurrency int
}

// FCMJWTConfig parses a service-account JSON into the JWT-bearer OAuth2 config used to mint access tokens.
func FCMJWTConfig(serviceAccountJSON []byte) (*jwt.Config, string, error) {
	var sa struct {
		ProjectID string `json:"project_id"`
		Type      string `json:"type"`
	}
	if err := json.Unmarshal(serviceAccountJSON, &sa); err != nil {
		return nil, "", fmt.Errorf("FCM_SERVICE_ACCOUNT_JSON: %w", err)
	}
	if sa.Type != "service_account" || sa.ProjectID == "" {
		return nil, "", errors.New("FCM_SERVICE_ACCOUNT_JSON: expected a service_account key with project_id")
	}
	cfg, err := google.JWTConfigFromJSON(serviceAccountJSON, FCMScope)
	if err != nil {
		return nil, "", fmt.Errorf("FCM_SERVICE_ACCOUNT_JSON: %w", err)
	}
	return cfg, sa.ProjectID, nil
}

func NewFCM(serviceAccountJSON []byte) (*FCMProvider, error) {
	cfg, projectID, err := FCMJWTConfig(serviceAccountJSON)
	if err != nil {
		return nil, err
	}
	client := cfg.Client(context.Background()) // token source is cached & refreshed ~1 min before expiry
	client.Timeout = fcmRequestTimeout
	return &FCMProvider{ProjectID: projectID, Endpoint: FCMEndpoint, Client: client, Concurrency: fcmConcurrency}, nil
}

func (p *FCMProvider) Name() string { return "fcm" }

// fcmReservedKey reports data keys FCM rejects ("from", "notification", "message_type", google*/gcm* prefixes).
func fcmReservedKey(k string) bool {
	l := strings.ToLower(k)
	return l == "from" || l == "notification" || l == "message_type" || strings.HasPrefix(l, "google") || strings.HasPrefix(l, "gcm")
}

// FCMPayload builds the v1 `messages:send` request body for one device.
func FCMPayload(m Message) map[string]any {
	data := stringData(m.Data)
	for k := range data {
		if fcmReservedKey(k) {
			delete(data, k)
		}
	}
	return map[string]any{
		"message": map[string]any{
			"token":        m.To,
			"notification": map[string]any{"title": m.Title, "body": m.Body},
			"data":         data,
			"android": map[string]any{
				"priority":     "HIGH",
				"notification": map[string]any{"sound": "default"},
			},
		},
	}
}

type fcmErrorBody struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			Type      string `json:"@type"`
			ErrorCode string `json:"errorCode"`
		} `json:"details"`
	} `json:"error"`
}

// fcmTokenInvalid decides whether an FCM error means "this registration token will never work again".
func fcmTokenInvalid(status int, body []byte) bool {
	var e fcmErrorBody
	_ = json.Unmarshal(body, &e)
	for _, d := range e.Error.Details {
		switch d.ErrorCode {
		case "UNREGISTERED", "SENDER_ID_MISMATCH":
			return true
		}
	}
	if status == http.StatusNotFound && e.Error.Status == "NOT_FOUND" {
		return true
	}
	return e.Error.Status == "INVALID_ARGUMENT" && strings.Contains(strings.ToLower(e.Error.Message), "registration token")
}

func (p *FCMProvider) Send(ctx context.Context, msgs []Message) Result {
	url := strings.TrimRight(p.Endpoint, "/") + "/v1/projects/" + p.ProjectID + "/messages:send"
	return parallel(ctx, msgs, p.Concurrency, func(ctx context.Context, m Message) bool {
		b, _ := json.Marshal(FCMPayload(m))
		ctx, cancel := context.WithTimeout(ctx, fcmRequestTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/json")
		res, err := p.Client.Do(req)
		if err != nil {
			slog.Warn("push:fcm send error", "token", truncate(m.To, 32), "err", err)
			return false
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		if res.StatusCode < 300 {
			return false
		}
		if fcmTokenInvalid(res.StatusCode, raw) {
			return true
		}
		slog.Warn("push:fcm send failed", "token", truncate(m.To, 32), "status", res.StatusCode, "body", truncate(string(raw), 300))
		return false
	})
}
