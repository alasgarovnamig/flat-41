package sig

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestSign(t *testing.T) {
	m := hmac.New(sha256.New, []byte("s3cret"))
	m.Write([]byte(`1700000000000.{"a":1}`))
	expected := hex.EncodeToString(m.Sum(nil))
	if got := Sign("s3cret", "1700000000000", `{"a":1}`); got != expected {
		t.Fatalf("Sign = %s, want %s", got, expected)
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(expected) {
		t.Fatal("not lowercase hex")
	}
	// Vectors computed with Node's crypto.createHmac (the former implementation / apps/api signMockbank).
	if got := Sign("evtap-mockbank-secret", "1700000000000", ""); got != "6f8dc44ef63b88a6309e91a37f8a939fdf177319f1a6af8e92521a564bfde835" {
		t.Fatalf("GET vector: %s", got)
	}
	if got := Sign("evtap-mockbank-secret", "1700000000000", `{"amount":1500,"description":"VIP (7 gün)"}`); got != "42882b2d48459fd5124474febadf504a12431660f22285af02bee7c9ff5a4a1e" {
		t.Fatalf("UTF-8 body vector: %s", got)
	}
	if !Matches(expected, strings.ToUpper(expected)) {
		t.Fatal("uppercase must match")
	}
	if Matches(expected, expected[:62]) {
		t.Fatal("truncated must not match")
	}
	if Matches(expected, "zz") {
		t.Fatal("non-hex must not match")
	}
	if Matches(expected, "") {
		t.Fatal("empty must not match")
	}
}

func TestSetHeaders(t *testing.T) {
	h := http.Header{}
	now := time.UnixMilli(1700000000123)
	SetHeaders(h, "evtap", "secret", "body", now)
	if h.Get("X-Merchant-Id") != "evtap" || h.Get("X-Timestamp") != "1700000000123" {
		t.Fatalf("headers %v", h)
	}
	if h.Get("X-Signature") != Sign("secret", "1700000000123", "body") {
		t.Fatal("bad signature header")
	}
}
