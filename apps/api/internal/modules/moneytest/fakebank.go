package moneytest

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/modules/payments/providers"
)

// FakeBank is a TEST-ONLY acquirer implementing the docs/MOCKBANK.md merchant contract (port of
// apps/api/test/fake-bank.ts). Its hosted checkout auto-pays instead of rendering a card form:
//
//	GET /checkout/:orderId?card=4111111111111111[&save=0][&webhook=0][&action=cancel]
//	  → decides by test card, POSTs the signed webhook (unless webhook=0), then 302 → returnUrl?orderId&merchantOrderId&status
type FakeBank struct {
	Srv       *httptest.Server
	merchants map[string]string

	mu       sync.Mutex
	orders   map[string]*fbOrder
	meta     map[string]fbMeta
	byMerch  map[string]string
	tokens   map[string]*fbToken
	webhooks []Webhook
}

type fbOrder struct {
	OrderID         string     `json:"orderId"`
	MerchantOrderID string     `json:"merchantOrderId"`
	Amount          int        `json:"amount"`
	Currency        string     `json:"currency"`
	Description     string     `json:"description"`
	Status          string     `json:"status"`
	RefundedAmount  int        `json:"refundedAmount"`
	Card            *fbCard    `json:"card"`
	DeclineCode     *string    `json:"declineCode"`
	DeclineReason   *string    `json:"declineReason"`
	RRN             *string    `json:"rrn"`
	ApprovalCode    *string    `json:"approvalCode"`
	Refunds         []fbRefund `json:"refunds"`
	CreatedAt       string     `json:"createdAt"`
	UpdatedAt       string     `json:"updatedAt"`
	PaidAt          *string    `json:"paidAt"`
	ExpiresAt       string     `json:"expiresAt"`
}

type fbCard struct {
	Mask  string  `json:"mask"`
	Brand string  `json:"brand"`
	Token *string `json:"token"`
}

type fbRefund struct {
	ID        string `json:"id"`
	Amount    int    `json:"amount"`
	Reason    string `json:"reason"`
	CreatedAt string `json:"createdAt"`
}

type fbMeta struct {
	merchantID, returnURL, callbackURL string
	saveCard                           bool
}

type fbToken struct {
	mask, brand  string
	insufficient bool
}

// Webhook is one delivery attempt made by the fake bank.
type Webhook struct {
	OrderID, Event string
	Status         int
}

var declines = map[string][2]string{
	"4000000000000002": {"DO_NOT_HONOR", "Do not honor"},
	"4000000000009995": {"INSUFFICIENT_FUNDS", "Insufficient funds"},
	"4000000000000069": {"EXPIRED_CARD", "Expired card"},
	"4000000000000119": {"PROCESSING_ERROR", "Processing error"},
}

func rid(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func nowISO() string      { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func sp(s string) *string { return &s }

// NewFakeBank starts the fake bank (merchant evtap / evtap-mockbank-secret).
func NewFakeBank() *FakeBank {
	fb := &FakeBank{merchants: map[string]string{"evtap": "evtap-mockbank-secret"}, orders: map[string]*fbOrder{}, meta: map[string]fbMeta{},
		byMerch: map[string]string{}, tokens: map[string]*fbToken{}}
	fb.Srv = httptest.NewServer(http.HandlerFunc(fb.serve))
	return fb
}

func (fb *FakeBank) Close() { fb.Srv.Close() }

// URL is the bank base URL.
func (fb *FakeBank) URL() string { return fb.Srv.URL }

// OrderFor returns a copy of the order of a merchant order id (our payments.id) as raw JSON object.
func (fb *FakeBank) OrderFor(merchantOrderID string) map[string]any {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	o := fb.orders[fb.byMerch["evtap:"+merchantOrderID]]
	if o == nil {
		return nil
	}
	b, _ := json.Marshal(o)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return m
}

// Webhooks returns the delivery log.
func (fb *FakeBank) Webhooks() []Webhook {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	return append([]Webhook(nil), fb.webhooks...)
}

// SetInsufficient switches a saved token to "insufficient funds" (failed renewals).
func (fb *FakeBank) SetInsufficient(token string, v bool) {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if t := fb.tokens[token]; t != nil {
		t.insufficient = v
	}
}

// Expire marks an order EXPIRED and sends order.expired.
func (fb *FakeBank) Expire(orderID string) {
	fb.mu.Lock()
	o := fb.orders[orderID]
	if o != nil {
		o.Status, o.UpdatedAt = "EXPIRED", nowISO()
	}
	fb.mu.Unlock()
	if o != nil {
		fb.sendWebhook(orderID, "order.expired")
	}
}

func (fb *FakeBank) sendWebhook(orderID, event string) {
	fb.mu.Lock()
	o, m := fb.orders[orderID], fb.meta[orderID]
	var raw []byte
	if o != nil {
		raw, _ = json.Marshal(map[string]any{"event": event, "order": o})
	}
	secret := fb.merchants[m.merchantID]
	fb.mu.Unlock()
	if o == nil || m.callbackURL == "" {
		return
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	req, _ := http.NewRequest(http.MethodPost, m.callbackURL, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Merchant-Id", m.merchantID)
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", providers.Sign(secret, ts, raw))
	status := 0
	if res, err := http.DefaultClient.Do(req); err == nil {
		status = res.StatusCode
		_ = res.Body.Close()
	}
	fb.mu.Lock()
	fb.webhooks = append(fb.webhooks, Webhook{OrderID: orderID, Event: event, Status: status})
	fb.mu.Unlock()
}

func (fb *FakeBank) settle(o *fbOrder, card string, save bool) {
	brand := "VISA"
	if strings.HasPrefix(card, "5") {
		brand = "MASTERCARD"
	}
	mask := card[:6] + "******" + card[len(card)-4:]
	if d, ok := declines[card]; ok {
		o.Status, o.DeclineCode, o.DeclineReason, o.Card = "DECLINED", sp(d[0]), sp(d[1]), &fbCard{Mask: mask, Brand: brand}
	} else {
		var token *string
		if save {
			token = sp(rid("tok"))
			fb.tokens[*token] = &fbToken{mask: mask, brand: brand}
		}
		o.Status, o.Card, o.RRN, o.ApprovalCode, o.PaidAt = "APPROVED", &fbCard{Mask: mask, Brand: brand, Token: token}, sp("123456789012"), sp("A1B2C3"), sp(nowISO())
	}
	o.UpdatedAt = nowISO()
}

func send(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (fb *FakeBank) serve(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")

	// ── hosted checkout (auto-pay) ──
	if r.Method == http.MethodGet && parts[0] == "checkout" && len(parts) == 2 {
		q := r.URL.Query()
		fb.mu.Lock()
		o, m := fb.orders[parts[1]], fb.meta[parts[1]]
		if o == nil {
			fb.mu.Unlock()
			send(w, 404, map[string]any{"error": "NOT_FOUND"})
			return
		}
		changed := false
		if o.Status == "CREATED" {
			if q.Get("action") == "cancel" {
				o.Status, o.UpdatedAt = "CANCELLED", nowISO()
			} else {
				card := strings.ReplaceAll(q.Get("card"), " ", "")
				if card == "" {
					card = "4111111111111111"
				}
				fb.settle(o, card, m.saveCard && q.Get("save") != "0")
			}
			changed = true
		}
		status, orderID, merchantOrderID := o.Status, o.OrderID, o.MerchantOrderID
		fb.mu.Unlock()
		if changed && q.Get("webhook") != "0" {
			fb.sendWebhook(orderID, "order."+strings.ToLower(status))
		}
		ret, _ := url.Parse(m.returnURL)
		rq := ret.Query()
		rq.Set("orderId", orderID)
		rq.Set("merchantOrderId", merchantOrderID)
		rq.Set("status", status)
		ret.RawQuery = rq.Encode()
		w.Header().Set("Location", ret.String())
		w.WriteHeader(http.StatusFound)
		return
	}

	// ── merchant API (signed) ──
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "v1" {
		send(w, 404, map[string]any{"error": "NOT_FOUND"})
		return
	}
	merchantID := r.Header.Get("X-Merchant-Id")
	secret, known := fb.merchants[merchantID]
	if !known || providers.VerifySignature(merchantID, secret, r.Header, raw, time.Now()) != nil {
		send(w, 401, map[string]any{"error": "INVALID_SIGNATURE"})
		return
	}
	var body map[string]any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &body)
	}
	num := func(k string) int { f, _ := body[k].(float64); return int(f) }
	str := func(k string) string { s, _ := body[k].(string); return s }
	rest := parts[2:]

	fb.mu.Lock()
	defer fb.mu.Unlock() // webhooks triggered below run in goroutines and take the lock themselves
	switch {
	case r.Method == http.MethodPost && len(rest) == 1 && rest[0] == "orders":
		if id, ok := fb.byMerch[merchantID+":"+str("merchantOrderId")]; ok {
			o := fb.orders[id]
			send(w, 201, map[string]any{"orderId": o.OrderID, "status": o.Status, "paymentUrl": fb.Srv.URL + "/checkout/" + o.OrderID, "expiresAt": o.ExpiresAt})
			return
		}
		if num("amount") <= 0 || str("merchantOrderId") == "" || str("returnUrl") == "" || str("callbackUrl") == "" {
			send(w, 400, map[string]any{"error": "VALIDATION_ERROR"})
			return
		}
		cur := str("currency")
		if cur == "" {
			cur = "AZN"
		}
		now := nowISO()
		o := &fbOrder{OrderID: rid("ord"), MerchantOrderID: str("merchantOrderId"), Amount: num("amount"), Currency: cur, Description: str("description"),
			Status: "CREATED", Refunds: []fbRefund{}, CreatedAt: now, UpdatedAt: now, ExpiresAt: time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)}
		save, _ := body["saveCard"].(bool)
		fb.orders[o.OrderID] = o
		fb.meta[o.OrderID] = fbMeta{merchantID: merchantID, returnURL: str("returnUrl"), callbackURL: str("callbackUrl"), saveCard: save}
		fb.byMerch[merchantID+":"+o.MerchantOrderID] = o.OrderID
		send(w, 201, map[string]any{"orderId": o.OrderID, "status": o.Status, "paymentUrl": fb.Srv.URL + "/checkout/" + o.OrderID, "expiresAt": o.ExpiresAt})
		return

	case r.Method == http.MethodPost && len(rest) == 2 && rest[0] == "orders" && rest[1] == "charge-token":
		t := fb.tokens[str("cardToken")]
		now := nowISO()
		cur := str("currency")
		if cur == "" {
			cur = "AZN"
		}
		o := &fbOrder{OrderID: rid("ord"), MerchantOrderID: str("merchantOrderId"), Amount: num("amount"), Currency: cur, Description: str("description"),
			Status: "APPROVED", Refunds: []fbRefund{}, CreatedAt: now, UpdatedAt: now, ExpiresAt: now}
		switch {
		case t == nil:
			o.Status, o.DeclineCode, o.DeclineReason = "DECLINED", sp("TOKEN_INVALID"), sp("Unknown card token")
		case t.insufficient:
			o.Status, o.DeclineCode, o.DeclineReason = "DECLINED", sp("INSUFFICIENT_FUNDS"), sp("Insufficient funds")
			o.Card = &fbCard{Mask: t.mask, Brand: t.brand, Token: sp(str("cardToken"))}
		default:
			o.Card = &fbCard{Mask: t.mask, Brand: t.brand, Token: sp(str("cardToken"))}
			o.PaidAt, o.RRN, o.ApprovalCode = sp(now), sp("123456789012"), sp("TK0001")
		}
		fb.orders[o.OrderID] = o
		fb.meta[o.OrderID] = fbMeta{merchantID: merchantID, callbackURL: str("callbackUrl")}
		fb.byMerch[merchantID+":"+o.MerchantOrderID] = o.OrderID
		send(w, 200, o)
		return

	case rest[0] == "orders" && len(rest) >= 2:
		o := fb.orders[rest[1]]
		if o == nil || fb.meta[o.OrderID].merchantID != merchantID {
			send(w, 404, map[string]any{"error": "NOT_FOUND"})
			return
		}
		if r.Method == http.MethodGet && len(rest) == 2 {
			send(w, 200, o)
			return
		}
		if r.Method == http.MethodPost && len(rest) == 3 && rest[2] == "refund" {
			remaining := o.Amount - o.RefundedAmount
			amount := remaining
			if _, ok := body["amount"]; ok {
				amount = num("amount")
			}
			if (o.Status != "APPROVED" && o.Status != "PARTIALLY_REFUNDED") || amount <= 0 || amount > remaining {
				send(w, 409, map[string]any{"error": "NOT_REFUNDABLE"})
				return
			}
			o.RefundedAmount += amount
			o.Refunds = append(o.Refunds, fbRefund{ID: rid("rf"), Amount: amount, Reason: str("reason"), CreatedAt: nowISO()})
			o.Status = "PARTIALLY_REFUNDED"
			if o.RefundedAmount >= o.Amount {
				o.Status = "REFUNDED"
			}
			o.UpdatedAt = nowISO()
			send(w, 200, o)
			go fb.sendWebhook(o.OrderID, "order.refunded")
			return
		}
		if r.Method == http.MethodPost && len(rest) == 3 && rest[2] == "cancel" {
			if o.Status != "CREATED" {
				send(w, 409, map[string]any{"error": "NOT_CANCELLABLE"})
				return
			}
			o.Status, o.UpdatedAt = "CANCELLED", nowISO()
			send(w, 200, o)
			go fb.sendWebhook(o.OrderID, "order.cancelled")
			return
		}

	case r.Method == http.MethodDelete && rest[0] == "tokens" && len(rest) == 2:
		delete(fb.tokens, rest[1])
		send(w, 200, map[string]any{"ok": true})
		return
	}
	send(w, 404, map[string]any{"error": fmt.Sprintf("NOT_FOUND %s %s", r.Method, r.URL.Path)})
}
