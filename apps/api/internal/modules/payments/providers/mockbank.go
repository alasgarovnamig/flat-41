package providers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// MaxSkew: docs/MOCKBANK.md — requests / webhooks older (or further in the future) than this are rejected.
const MaxSkew = 5 * time.Minute

type MockBankConfig struct {
	URL        string
	MerchantID string
	Secret     string
	Timeout    time.Duration // default 15 s
}

// Sign returns lowercase hex HMAC_SHA256(secret, "${timestamp}.${rawBody}") — docs/MOCKBANK.md "Merchant authentication".
func Sign(secret, timestamp string, rawBody []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(timestamp))
	m.Write([]byte{'.'})
	m.Write(rawBody)
	return hex.EncodeToString(m.Sum(nil))
}

var digits = regexp.MustCompile(`^\d+$`)

// VerifySignature checks X-Merchant-Id / X-Timestamp / X-Signature. Pure — exported for tests.
func VerifySignature(merchantID, secret string, h http.Header, rawBody []byte, now time.Time) error {
	mid, ts, sig := h.Get("X-Merchant-Id"), h.Get("X-Timestamp"), h.Get("X-Signature")
	if mid == "" || ts == "" || sig == "" {
		return &InvalidSignatureError{"Missing signature headers"}
	}
	if mid != merchantID {
		return &InvalidSignatureError{"Unknown merchant"}
	}
	n, err := strconv.ParseInt(ts, 10, 64)
	if !digits.MatchString(ts) || err != nil {
		return &InvalidSignatureError{"Stale timestamp"}
	}
	skew := now.UnixMilli() - n
	if skew < 0 {
		skew = -skew
	}
	if skew > MaxSkew.Milliseconds() {
		return &InvalidSignatureError{"Stale timestamp"}
	}
	if !hmac.Equal([]byte(strings.ToLower(sig)), []byte(Sign(secret, ts, rawBody))) {
		return &InvalidSignatureError{"Bad signature"}
	}
	return nil
}

func str(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

func num(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	}
	return 0
}

// ParseOrder maps a MockBank Order JSON object onto Order.
func ParseOrder(o map[string]any) (*Order, error) {
	orderID, ok1 := o["orderId"].(string)
	merchantOrderID, ok2 := o["merchantOrderId"].(string)
	status, _ := o["status"].(string)
	if o == nil || !ok1 || !ok2 || !slices.Contains(allStatuses, status) {
		return nil, &ProviderError{Msg: "Malformed order from mockbank", Body: o}
	}
	currency := "AZN"
	if c, ok := o["currency"]; ok && c != nil {
		currency = fmt.Sprint(c)
	}
	out := &Order{
		OrderID: orderID, MerchantOrderID: merchantOrderID, Amount: num(o["amount"]), Currency: currency, Status: status,
		RefundedAmount: num(o["refundedAmount"]), DeclineCode: str(o["declineCode"]), DeclineReason: str(o["declineReason"]),
		RRN: str(o["rrn"]), ApprovalCode: str(o["approvalCode"]), PaidAt: str(o["paidAt"]), Raw: o,
	}
	if c, ok := o["card"].(map[string]any); ok {
		out.Card = &Card{Mask: str(c["mask"]), Brand: str(c["brand"]), Token: str(c["token"])}
	}
	return out, nil
}

// MockBank is the apps/mockbank client — see docs/MOCKBANK.md.
type MockBank struct {
	cfg    MockBankConfig
	client *http.Client
}

func NewMockBank(cfg MockBankConfig) *MockBank {
	if cfg.Timeout == 0 {
		cfg.Timeout = 15 * time.Second
	}
	cfg.URL = strings.TrimRight(cfg.URL, "/")
	return &MockBank{cfg: cfg, client: &http.Client{Timeout: cfg.Timeout}}
}

func (m *MockBank) Name() string { return "mockbank" }

// SetURL points the client at another bank base URL (tests).
func (m *MockBank) SetURL(u string) { m.cfg.URL = strings.TrimRight(u, "/") }

func (m *MockBank) request(ctx context.Context, method, path string, body any) (map[string]any, error) {
	// GET / DELETE: signed over the empty string. POST: signed over the exact JSON we send.
	var raw []byte
	if method == http.MethodPost {
		if body == nil {
			body = map[string]any{}
		}
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	var rd io.Reader
	if method == http.MethodPost {
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, m.cfg.URL+path, rd)
	if err != nil {
		return nil, err
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Merchant-Id", m.cfg.MerchantID)
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", Sign(m.cfg.Secret, ts, raw))
	res, err := m.client.Do(req)
	if err != nil {
		return nil, &ProviderError{Msg: fmt.Sprintf("mockbank %s %s unreachable: %v", method, path, err)}
	}
	defer res.Body.Close()
	text, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	var parsed any
	if len(text) > 0 {
		if err := json.Unmarshal(text, &parsed); err != nil {
			parsed = string(text)
		}
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, &ProviderError{Msg: fmt.Sprintf("mockbank %s %s → %d", method, path, res.StatusCode), Status: res.StatusCode, Body: parsed}
	}
	obj, _ := parsed.(map[string]any)
	return obj, nil
}

func (m *MockBank) CreateOrder(ctx context.Context, in CreateOrderInput) (*CreatedOrder, error) {
	r, err := m.request(ctx, http.MethodPost, "/api/v1/orders", in)
	if err != nil {
		return nil, err
	}
	orderID, _ := r["orderId"].(string)
	paymentURL, _ := r["paymentUrl"].(string)
	if orderID == "" || paymentURL == "" {
		return nil, &ProviderError{Msg: "Malformed createOrder response", Body: r}
	}
	status, _ := r["status"].(string)
	if status == "" {
		status = StatusCreated
	}
	return &CreatedOrder{OrderID: orderID, Status: status, PaymentURL: paymentURL, ExpiresAt: str(r["expiresAt"])}, nil
}

func (m *MockBank) GetOrder(ctx context.Context, orderID string) (*Order, error) {
	r, err := m.request(ctx, http.MethodGet, "/api/v1/orders/"+url.PathEscape(orderID), nil)
	if err != nil {
		return nil, err
	}
	return ParseOrder(r)
}

func (m *MockBank) Refund(ctx context.Context, orderID string, amount int, reason string) (*Order, error) {
	body := map[string]any{}
	if amount > 0 {
		body["amount"] = amount
	}
	if reason != "" {
		body["reason"] = reason
	}
	r, err := m.request(ctx, http.MethodPost, "/api/v1/orders/"+url.PathEscape(orderID)+"/refund", body)
	if err != nil {
		return nil, err
	}
	return ParseOrder(r)
}

func (m *MockBank) ChargeToken(ctx context.Context, in ChargeTokenInput) (*Order, error) {
	r, err := m.request(ctx, http.MethodPost, "/api/v1/orders/charge-token", in)
	if err != nil {
		return nil, err
	}
	return ParseOrder(r)
}

func (m *MockBank) Cancel(ctx context.Context, orderID string) (*Order, error) {
	r, err := m.request(ctx, http.MethodPost, "/api/v1/orders/"+url.PathEscape(orderID)+"/cancel", map[string]any{})
	if err != nil {
		return nil, err
	}
	return ParseOrder(r)
}

func (m *MockBank) DeleteToken(ctx context.Context, cardToken string) error {
	_, err := m.request(ctx, http.MethodDelete, "/api/v1/tokens/"+url.PathEscape(cardToken), nil)
	return err
}

func (m *MockBank) VerifyWebhook(h http.Header, rawBody []byte) (*WebhookEvent, error) {
	if err := VerifySignature(m.cfg.MerchantID, m.cfg.Secret, h, rawBody, time.Now()); err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(rawBody, &body); err != nil {
		return nil, &InvalidSignatureError{"Malformed webhook body"}
	}
	event, ok := body["event"].(string)
	order, ok2 := body["order"].(map[string]any)
	if !ok || !ok2 {
		return nil, &ProviderError{Msg: "Malformed webhook payload", Body: body}
	}
	o, err := ParseOrder(order)
	if err != nil {
		return nil, err
	}
	return &WebhookEvent{Event: event, Order: o}, nil
}
