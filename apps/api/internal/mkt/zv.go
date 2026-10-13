package mkt

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// Body is a JSON object body validated field by field with zod-like rules. It keeps track of which keys were
// present, so PATCH handlers can tell "absent" (leave unchanged) from `null` (clear) — the former API's
// `onlyProvided(parsed, raw)` semantics. Unknown keys are ignored (zod strips them).
type Body struct {
	raw   map[string]json.RawMessage
	order []string
	errs  []string
}

// Opt is a parsed field: Present = key in the body (null included), Null = explicit null.
type Opt[T any] struct {
	Present bool
	Null    bool
	V       T
}

// Ok reports whether the field carries a (non-null) value.
func (o Opt[T]) Ok() bool { return o.Present && !o.Null }

// Ptr returns the value, nil when absent or null.
func (o Opt[T]) Ptr() *T {
	if !o.Ok() {
		return nil
	}
	v := o.V
	return &v
}

// ReadBody reads a JSON object body (max 2 MB). An empty body is {}; anything but an object is a VALIDATION_ERROR.
func ReadBody(r *http.Request) (*Body, error) {
	data, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		return nil, httpx.BadRequest("VALIDATION_ERROR", "cannot read body")
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		data = []byte("{}")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil || raw == nil {
		var v any
		if json.Unmarshal(data, &v) != nil {
			return nil, httpx.ValidationError([]string{"body: invalid JSON"})
		}
		return nil, httpx.ValidationError([]string{"body: Invalid input: expected object, received " + jsType(data)})
	}
	return &Body{raw: raw, order: keyOrder(data)}, nil
}

// keyOrder returns the top-level keys of a JSON object in document order (JS Object.keys order).
func keyOrder(data []byte) []string {
	dec := json.NewDecoder(bytes.NewReader(data))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil
	}
	var keys []string
	seen := map[string]bool{}
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return keys
		}
		k, _ := t.(string)
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
		var skip json.RawMessage
		if err := dec.Decode(&skip); err != nil {
			return keys
		}
	}
	return keys
}

// BodyFromMap wraps an already-decoded object (e.g. a saved search query stored as jsonb).
func BodyFromMap(m map[string]any) *Body {
	raw := map[string]json.RawMessage{}
	for k, v := range m {
		b, _ := json.Marshal(v)
		raw[k] = b
	}
	return &Body{raw: raw}
}

// Has reports whether the key is present (null included).
func (b *Body) Has(k string) bool { _, ok := b.raw[k]; return ok }

// Keys lists the present keys (document order when known).
func (b *Body) Keys() []string {
	if b.order != nil {
		return append([]string(nil), b.order...)
	}
	out := make([]string, 0, len(b.raw))
	for k := range b.raw {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// KnownKeys lists the present keys that belong to the given schema keys (document order).
func (b *Body) KnownKeys(schema ...string) []string {
	out := []string{}
	for _, k := range b.Keys() {
		for _, s := range schema {
			if k == s {
				out = append(out, k)
				break
			}
		}
	}
	return out
}

// Add records a validation problem ("path: message").
func (b *Body) Add(path, msg string) { b.errs = append(b.errs, path+": "+msg) }

// Errs returns the collected messages.
func (b *Body) Errs() []string { return b.errs }

// Err returns a VALIDATION_ERROR listing every problem, or nil.
func (b *Body) Err() error {
	if len(b.errs) > 0 {
		return httpx.ValidationError(b.errs)
	}
	return nil
}

func jsType(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return "undefined"
	}
	switch raw[0] {
	case 'n':
		return "null"
	case '"':
		return "string"
	case 't', 'f':
		return "boolean"
	case '[':
		return "array"
	case '{':
		return "object"
	}
	return "number"
}

func expected(want, got string) string {
	return "Invalid input: expected " + want + ", received " + got
}

// field returns the raw value and whether to continue parsing (false when absent / null / error).
func field[T any](b *Body, k, want string, required, nullable bool) (json.RawMessage, Opt[T], bool) {
	var o Opt[T]
	raw, ok := b.raw[k]
	if !ok {
		if required {
			b.Add(k, expected(want, "undefined"))
		}
		return nil, o, false
	}
	o.Present = true
	if jsType(raw) == "null" {
		o.Null = true
		if !nullable {
			b.Add(k, expected(want, "null"))
		}
		return nil, o, false
	}
	return raw, o, true
}

// S are string rules.
type S struct {
	Req, Null    bool
	Trim, Lower  bool
	Min, Max     int // in UTF-16 units like JS .length; 0 = unchecked
	Enum         []string
	Re           *regexp.Regexp
	ReMsg        string
	Email, URL   bool
	UUID, Phone  bool
	DateTime     bool
	OptionalNull bool // treat null like absent (no error)
}

var (
	emailRe    = regexp.MustCompile(`^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)
	uuidRe     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	dateTimeRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$`)
)

func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

// IsUUID validates the canonical 8-4-4-4-12 hex form.
func IsUUID(s string) bool { return uuidRe.MatchString(s) }

// IsURL mirrors zod's url() (WHATWG URL parse succeeds: needs a scheme).
func IsURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && (u.Host != "" || u.Opaque != "")
}

// checkStr applies string rules to v (already decoded); returns the normalised value and an error message.
func checkStr(v string, r S) (string, string) {
	if r.Trim {
		v = strings.TrimSpace(v)
	}
	if r.Lower {
		v = strings.ToLower(v)
	}
	if r.Phone {
		v = shared.NormalizePhone(v)
		if !shared.PhoneRe.MatchString(v) {
			return v, "Invalid phone number"
		}
		return v, ""
	}
	if r.Enum != nil {
		if !shared.In(v, r.Enum) {
			return v, `Invalid option: expected one of "` + strings.Join(r.Enum, `"|"`) + `"`
		}
		return v, ""
	}
	n := jsLen(v)
	if r.Min > 0 && n < r.Min {
		return v, fmt.Sprintf("Too small: expected string to have >=%d characters", r.Min)
	}
	if r.Max > 0 && n > r.Max {
		return v, fmt.Sprintf("Too big: expected string to have <=%d characters", r.Max)
	}
	switch {
	case r.Email && !emailRe.MatchString(v):
		return v, "Invalid email address"
	case r.URL && !IsURL(v):
		return v, "Invalid URL"
	case r.UUID && !uuidRe.MatchString(v):
		return v, "Invalid UUID"
	case r.DateTime && !dateTimeRe.MatchString(v):
		return v, "Invalid ISO datetime"
	case r.Re != nil && !r.Re.MatchString(v):
		if r.ReMsg != "" {
			return v, r.ReMsg
		}
		return v, "Invalid string: must match pattern /" + r.Re.String() + "/"
	}
	return v, ""
}

// Str parses a string field.
func (b *Body) Str(k string, r S) Opt[string] {
	raw, o, ok := field[string](b, k, "string", r.Req, r.Null || r.OptionalNull)
	if !ok {
		return o
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		b.Add(k, expected("string", jsType(raw)))
		return Opt[string]{}
	}
	v, msg := checkStr(v, r)
	if msg != "" {
		b.Add(k, msg)
		return Opt[string]{}
	}
	o.V = v
	return o
}

// N are number rules.
type N struct {
	Req, Null bool
	Int       bool
	Min, Max  *float64
	Positive  bool // > 0
}

// F is a float pointer helper for N.Min / N.Max.
func F(v float64) *float64 { return &v }

func fmtNum(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func checkNum(v float64, r N) string {
	if r.Int && (v != math.Trunc(v) || math.Abs(v) > 9007199254740991) {
		return expected("int", "number")
	}
	if r.Positive && v <= 0 {
		return "Too small: expected number to be >0"
	}
	if r.Min != nil && v < *r.Min {
		return "Too small: expected number to be >=" + fmtNum(*r.Min)
	}
	if r.Max != nil && v > *r.Max {
		return "Too big: expected number to be <=" + fmtNum(*r.Max)
	}
	return ""
}

// Num parses a JSON number field.
func (b *Body) Num(k string, r N) Opt[float64] {
	raw, o, ok := field[float64](b, k, "number", r.Req, r.Null)
	if !ok {
		return o
	}
	var v float64
	if jsType(raw) != "number" || json.Unmarshal(raw, &v) != nil {
		b.Add(k, expected("number", jsType(raw)))
		return Opt[float64]{}
	}
	if msg := checkNum(v, r); msg != "" {
		b.Add(k, msg)
		return Opt[float64]{}
	}
	o.V = v
	return o
}

// Int parses an integer JSON number field.
func (b *Body) Int(k string, r N) Opt[int] {
	r.Int = true
	f := b.Num(k, r)
	return Opt[int]{Present: f.Present, Null: f.Null, V: int(f.V)}
}

// Bool parses a boolean field.
func (b *Body) Bool(k string, req, nullable bool) Opt[bool] {
	raw, o, ok := field[bool](b, k, "boolean", req, nullable)
	if !ok {
		return o
	}
	if jsType(raw) != "boolean" {
		b.Add(k, expected("boolean", jsType(raw)))
		return Opt[bool]{}
	}
	o.V = string(bytes.TrimSpace(raw)) == "true"
	return o
}

// A are string-array rules.
type A struct {
	Req      bool
	Min, Max int
	Item     S
}

// StrArr parses an array of strings, validating each item (errors as "key.i: msg").
func (b *Body) StrArr(k string, r A) Opt[[]string] {
	raw, o, ok := field[[]string](b, k, "array", r.Req, false)
	if !ok {
		return o
	}
	var items []json.RawMessage
	if jsType(raw) != "array" || json.Unmarshal(raw, &items) != nil {
		b.Add(k, expected("array", jsType(raw)))
		return Opt[[]string]{}
	}
	if r.Min > 0 && len(items) < r.Min {
		b.Add(k, fmt.Sprintf("Too small: expected array to have >=%d items", r.Min))
		return Opt[[]string]{}
	}
	if r.Max > 0 && len(items) > r.Max {
		b.Add(k, fmt.Sprintf("Too big: expected array to have <=%d items", r.Max))
		return Opt[[]string]{}
	}
	out := make([]string, 0, len(items))
	bad := false
	for i, it := range items {
		var s string
		if jsType(it) != "string" || json.Unmarshal(it, &s) != nil {
			b.Add(fmt.Sprintf("%s.%d", k, i), expected("string", jsType(it)))
			bad = true
			continue
		}
		s, msg := checkStr(s, r.Item)
		if msg != "" {
			b.Add(fmt.Sprintf("%s.%d", k, i), msg)
			bad = true
			continue
		}
		out = append(out, s)
	}
	if bad {
		return Opt[[]string]{}
	}
	o.V = out
	return o
}

// Record parses an object field into a map (z.record(z.string(), z.unknown())).
func (b *Body) Record(k string, req bool) Opt[map[string]any] {
	raw, o, ok := field[map[string]any](b, k, "record", req, false)
	if !ok {
		return o
	}
	var m map[string]any
	if jsType(raw) != "object" || json.Unmarshal(raw, &m) != nil {
		b.Add(k, expected("record", jsType(raw)))
		return Opt[map[string]any]{}
	}
	o.V = m
	return o
}

// Localized parses {az, ru, en} (all strings, required).
func (b *Body) Localized(k string, req bool) Opt[shared.Localized] {
	raw, o, ok := field[shared.Localized](b, k, "object", req, false)
	if !ok {
		return o
	}
	if jsType(raw) != "object" {
		b.Add(k, expected("object", jsType(raw)))
		return Opt[shared.Localized]{}
	}
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	sub := &Body{raw: m}
	az := sub.Str("az", S{Req: true})
	ru := sub.Str("ru", S{Req: true})
	en := sub.Str("en", S{Req: true})
	if len(sub.errs) > 0 {
		for _, e := range sub.errs {
			b.errs = append(b.errs, k+"."+e)
		}
		return Opt[shared.Localized]{}
	}
	o.V = shared.Localized{Az: az.V, Ru: ru.V, En: en.V}
	return o
}
