package providers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Ported from apps/api/test/money.test.ts ("mockbank webhook signature").

const secret = "evtap-mockbank-secret"

func TestSignReferenceValue(t *testing.T) {
	// reference: printf '%s' '1700000000000.{}' | openssl dgst -sha256 -hmac evtap-mockbank-secret
	if got := Sign(secret, "1700000000000", []byte("{}")); got != "270788c4b3af7ab78a9f2ca52ccc54d54cceca091efa8670138593b933ec2c68" {
		t.Fatalf("Sign = %s", got)
	}
	if Sign(secret, "1700000000000", []byte("{}")) == Sign(secret, "1700000000001", []byte("{}")) {
		t.Fatal("timestamp must be part of the signature")
	}
}

func headers(ts, sig, merchant string) http.Header {
	h := http.Header{}
	h.Set("X-Merchant-Id", merchant)
	h.Set("X-Timestamp", ts)
	h.Set("X-Signature", sig)
	return h
}

var rawWebhook = func() []byte {
	b, _ := json.Marshal(map[string]any{"event": "order.approved", "order": map[string]any{
		"orderId": "ord_1", "merchantOrderId": "00000000-0000-4000-8000-000000000000", "amount": 1500, "currency": "AZN", "status": "APPROVED"}})
	return b
}()

func TestVerifyWebhookValid(t *testing.T) {
	mb := NewMockBank(MockBankConfig{URL: "http://unused", MerchantID: "evtap", Secret: secret})
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	ev, err := mb.VerifyWebhook(headers(ts, Sign(secret, ts, rawWebhook), "evtap"), rawWebhook)
	if err != nil {
		t.Fatal(err)
	}
	if ev.Event != "order.approved" || ev.Order.Amount != 1500 || ev.Order.Status != StatusApproved {
		t.Fatalf("parsed %+v / %+v", ev, ev.Order)
	}
	// upper-case hex signature is accepted too
	if _, err := mb.VerifyWebhook(headers(ts, strings.ToUpper(Sign(secret, ts, rawWebhook)), "evtap"), rawWebhook); err != nil {
		t.Fatal(err)
	}
}

func TestVerifySignatureRejects(t *testing.T) {
	now := time.Now()
	ts := strconv.FormatInt(now.UnixMilli(), 10)
	sig := Sign(secret, ts, rawWebhook)
	old := strconv.FormatInt(now.Add(-6*time.Minute).UnixMilli(), 10)
	future := strconv.FormatInt(now.Add(6*time.Minute).UnixMilli(), 10)
	cases := map[string]struct {
		h   http.Header
		raw []byte
	}{
		"tampered body":    {headers(ts, sig, "evtap"), []byte(strings.Replace(string(rawWebhook), "1500", "1", 1))},
		"wrong secret":     {headers(ts, Sign("other", ts, rawWebhook), "evtap"), rawWebhook},
		"unknown merchant": {headers(ts, sig, "acme"), rawWebhook},
		"stale timestamp":  {headers(old, Sign(secret, old, rawWebhook), "evtap"), rawWebhook},
		"future timestamp": {headers(future, Sign(secret, future, rawWebhook), "evtap"), rawWebhook},
		"non-numeric ts":   {headers("12a", Sign(secret, "12a", rawWebhook), "evtap"), rawWebhook},
		"missing headers":  {http.Header{}, rawWebhook},
	}
	for name, c := range cases {
		err := VerifySignature("evtap", secret, c.h, c.raw, now)
		var ise *InvalidSignatureError
		if !errors.As(err, &ise) {
			t.Errorf("%s: want InvalidSignatureError, got %v", name, err)
		}
	}
}

func TestParseOrderRejectsMalformed(t *testing.T) {
	if _, err := ParseOrder(map[string]any{"orderId": "x", "merchantOrderId": "y", "status": "WHATEVER"}); err == nil {
		t.Fatal("unknown status must be refused")
	}
	if _, err := ParseOrder(map[string]any{"merchantOrderId": "y", "status": "APPROVED"}); err == nil {
		t.Fatal("missing orderId must be refused")
	}
	o, err := ParseOrder(map[string]any{"orderId": "x", "merchantOrderId": "y", "status": "APPROVED", "amount": 1500.0,
		"card": map[string]any{"mask": "411111******1111", "brand": "VISA", "token": nil}})
	if err != nil || o.Currency != "AZN" || o.Card == nil || *o.Card.Mask != "411111******1111" || o.Card.Token != nil {
		t.Fatalf("parse: %+v %v", o, err)
	}
}
