package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// Handler is an http handler that returns an error; Wrap turns it into http.HandlerFunc.
// Return (value, nil) to respond 200 JSON, (nil, err) to render an error.
type Handler func(w http.ResponseWriter, r *http.Request) (any, error)

// H adapts a Handler: 200 + JSON body on success.
func H(fn Handler) http.HandlerFunc { return HS(http.StatusOK, fn) }

// HS adapts a Handler with an explicit success status (e.g. 201 for creates, matching the former Nest defaults:
// POST → 201 unless the contract says otherwise).
func HS(status int, fn Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := fn(w, r)
		if err != nil {
			WriteError(w, r, err)
			return
		}
		if v == nil { // handler already wrote the response (redirects, files)
			return
		}
		JSON(w, status, v)
	}
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// OK is the common `{ "ok": true }` response.
var OK = map[string]bool{"ok": true}

// DecodeJSON reads a JSON body (max 2 MB) into dst. Empty body decodes as {}.
func DecodeJSON(r *http.Request, dst any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		return BadRequest("VALIDATION_ERROR", "cannot read body")
	}
	if len(body) == 0 {
		body = []byte("{}")
	}
	if err := json.Unmarshal(body, dst); err != nil {
		var te *json.UnmarshalTypeError
		if errors.As(err, &te) {
			return ValidationError([]string{te.Field + ": expected " + te.Type.String()})
		}
		return ValidationError([]string{"body: invalid JSON"})
	}
	return nil
}

// ISO formats a time like JavaScript's Date#toISOString (UTC, millisecond precision) — the format all DTOs use.
func ISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// ISOPtr formats a nullable time.
func ISOPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := ISO(*t)
	return &s
}
