// Package sig implements the merchant request / webhook signature of docs/MOCKBANK.md:
// lowercase hex HMAC_SHA256(secret, "${timestamp}.${rawBody}").
package sig

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Header names.
const (
	HeaderMerchant  = "X-Merchant-Id"
	HeaderTimestamp = "X-Timestamp"
	HeaderSignature = "X-Signature"
)

// Sign returns lowercase hex HMAC_SHA256(secret, timestamp + "." + rawBody).
func Sign(secret, timestamp, rawBody string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(timestamp + "." + rawBody))
	return hex.EncodeToString(m.Sum(nil))
}

var hexRe = regexp.MustCompile(`^[0-9a-fA-F]+$`)

// Matches compares an expected hex signature with a provided one (case-insensitive, constant time).
func Matches(expectedHex, providedHex string) bool {
	if !hexRe.MatchString(providedHex) {
		return false
	}
	a, err := hex.DecodeString(expectedHex)
	if err != nil {
		return false
	}
	b, err := hex.DecodeString(strings.ToLower(providedHex))
	if err != nil {
		return false
	}
	return len(a) == len(b) && hmac.Equal(a, b)
}

// Timestamp formats t as unix milliseconds.
func Timestamp(t time.Time) string { return strconv.FormatInt(t.UnixMilli(), 10) }

// SetHeaders adds X-Merchant-Id / X-Timestamp / X-Signature for an outgoing signed request.
func SetHeaders(h http.Header, merchantID, secret, rawBody string, now time.Time) {
	ts := Timestamp(now)
	h.Set(HeaderMerchant, merchantID)
	h.Set(HeaderTimestamp, ts)
	h.Set(HeaderSignature, Sign(secret, ts, rawBody))
}
