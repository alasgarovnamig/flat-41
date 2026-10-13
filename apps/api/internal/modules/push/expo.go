package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

const (
	ExpoSendURL     = "https://exp.host/--/api/v2/push/send"
	ExpoReceiptsURL = "https://exp.host/--/api/v2/push/getReceipts"

	expoSendBatch       = 100     // Expo limit per request
	expoReceiptsBatch   = 1000    // Expo limit per request
	expoMaxPending      = 100_000 // in-memory receipt backlog cap
	expoDefaultDelay    = 15 * time.Minute
	expoDefaultMaxAge   = 24 * time.Hour
	expoRequestTimeout  = 15 * time.Second
	expoDeviceNotRegErr = "DeviceNotRegistered"
)

// ExpoProvider sends through the Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/).
// Tickets are kept in memory until their receipts are checked (best-effort, lost on restart) — same as the former API.
type ExpoProvider struct {
	AccessToken   string
	SendURL       string
	ReceiptsURL   string
	Client        *http.Client
	ReceiptDelay  time.Duration // receipts are reliably available after ~15 min
	ReceiptMaxAge time.Duration // Expo keeps receipts for 24 h
	Now           func() time.Time

	mu      sync.Mutex
	pending map[string]pendingTicket // ticket id → token
}

type pendingTicket struct {
	token string
	at    time.Time
}

type expoStatus struct {
	Status  string `json:"status"` // ok | error
	ID      string `json:"id"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

func NewExpo(accessToken string) *ExpoProvider {
	return &ExpoProvider{
		AccessToken: accessToken, SendURL: ExpoSendURL, ReceiptsURL: ExpoReceiptsURL,
		Client:       &http.Client{Timeout: expoRequestTimeout},
		ReceiptDelay: expoDefaultDelay, ReceiptMaxAge: expoDefaultMaxAge, Now: time.Now,
		pending: map[string]pendingTicket{},
	}
}

func (p *ExpoProvider) Name() string { return "expo" }

// ExpoPayload builds one entry of the /push/send array.
func ExpoPayload(m Message) map[string]any {
	data := m.Data
	if data == nil {
		data = map[string]any{}
	}
	return map[string]any{"to": m.To, "title": m.Title, "body": m.Body, "data": data, "sound": "default", "priority": "high"}
}

func (p *ExpoProvider) post(ctx context.Context, url string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, expoRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if p.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.AccessToken)
	}
	res, err := p.Client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d %s", res.StatusCode, truncate(string(raw), 300))
	}
	return json.Unmarshal(raw, out)
}

func (p *ExpoProvider) Send(ctx context.Context, msgs []Message) Result {
	var res Result
	valid := make([]Message, 0, len(msgs))
	for _, m := range msgs {
		if IsExpoToken(m.To) {
			valid = append(valid, m)
		}
	}
	for i := 0; i < len(valid); i += expoSendBatch {
		batch := valid[i:min(i+expoSendBatch, len(valid))]
		body := make([]map[string]any, len(batch))
		for j, m := range batch {
			body[j] = ExpoPayload(m)
		}
		var out struct {
			Data []expoStatus `json:"data"`
		}
		if err := p.post(ctx, p.SendURL, body, &out); err != nil || out.Data == nil {
			slog.Warn("push:expo send failed", "err", err)
			continue
		}
		p.mu.Lock()
		for j, t := range out.Data {
			if j >= len(batch) {
				break
			}
			token := batch[j].To
			switch {
			case t.Status == "ok":
				if len(p.pending) < expoMaxPending {
					p.pending[t.ID] = pendingTicket{token: token, at: p.Now()}
				}
			case t.Details.Error == expoDeviceNotRegErr:
				res.InvalidTokens = append(res.InvalidTokens, token)
			default:
				slog.Warn("push:expo ticket error", "token", truncate(token, 32), "error", t.Details.Error, "message", t.Message)
			}
		}
		p.mu.Unlock()
	}
	return res
}

// PendingReceipts is the number of tickets waiting for a receipt check (tests / metrics).
func (p *ExpoProvider) PendingReceipts() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.pending)
}

func (p *ExpoProvider) CollectReceipts(ctx context.Context) Result {
	var res Result
	now := p.Now()
	var due []string
	p.mu.Lock()
	for id, t := range p.pending {
		if now.Sub(t.at) > p.ReceiptMaxAge {
			delete(p.pending, id)
		} else if now.Sub(t.at) >= p.ReceiptDelay {
			due = append(due, id)
		}
	}
	p.mu.Unlock()
	for i := 0; i < len(due); i += expoReceiptsBatch {
		ids := due[i:min(i+expoReceiptsBatch, len(due))]
		var out struct {
			Data map[string]expoStatus `json:"data"`
		}
		if err := p.post(ctx, p.ReceiptsURL, map[string]any{"ids": ids}, &out); err != nil || out.Data == nil {
			slog.Warn("push:expo getReceipts failed", "err", err)
			continue
		}
		p.mu.Lock()
		for id, r := range out.Data {
			t, ok := p.pending[id]
			delete(p.pending, id)
			if !ok || r.Status == "ok" {
				continue
			}
			if r.Details.Error == expoDeviceNotRegErr {
				res.InvalidTokens = append(res.InvalidTokens, t.token)
			} else {
				slog.Warn("push:expo receipt error", "token", truncate(t.token, 32), "error", r.Details.Error, "message", r.Message)
			}
		}
		p.mu.Unlock()
	}
	return res
}
