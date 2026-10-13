// Package mkt holds helpers shared by the marketplace modules (users, listings, favorites, saved searches,
// agencies, mortgage, content, stats, admin): zod-like body validation with absent/null distinction,
// URL params with the former API's semantics, LIKE escaping and float4 handling.
package mkt

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// UUIDParam returns the named URL param; a malformed UUID answers 400 VALIDATION_ERROR (contract decision —
// the former Nest API answered 404, see tests/contract/KNOWN_ISSUES.md). Delegates to httpx.UUIDParam.
func UUIDParam(r *http.Request, name string) (string, error) { return httpx.UUIDParam(r, name) }

// ClientIP mirrors the former @ClientIp(): first X-Forwarded-For entry, else the remote address (without port).
func ClientIP(r *http.Request) *string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if ip := strings.TrimSpace(strings.Split(xf, ",")[0]); ip != "" {
			return &ip
		}
	}
	ip := r.RemoteAddr
	if h, _, err := net.SplitHostPort(ip); err == nil {
		ip = h
	}
	if ip == "" {
		return nil
	}
	return &ip
}

// EscapeLike escapes %, _ and \ for ILIKE patterns (same as the TS escapeLike).
func EscapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// F32 converts a Postgres real (float4) to the float64 a JS client would see ("3.1", not 3.0999999046325684).
func F32(f float32) float64 {
	v, _ := strconv.ParseFloat(strconv.FormatFloat(float64(f), 'g', -1, 32), 64)
	return v
}

// F32Ptr is F32 for nullable columns.
func F32Ptr(f *float32) *float64 {
	if f == nil {
		return nil
	}
	v := F32(*f)
	return &v
}

// YMD formats a date as YYYY-MM-DD in UTC (TS `ymd`).
func YMD(t time.Time) string { return t.UTC().Format("2006-01-02") }

// AddDays mirrors TS addDays (exact 24 h steps).
func AddDays(t time.Time, days int) time.Time { return t.Add(time.Duration(days) * 24 * time.Hour) }

// Ptr returns a pointer to v.
func Ptr[T any](v T) *T { return &v }
