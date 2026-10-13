package httpx

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// UUIDParam returns the named URL param, or a 400 VALIDATION_ERROR when it is not a UUID.
func UUIDParam(r *http.Request, name string) (string, error) {
	v := chi.URLParam(r, name)
	if _, err := uuid.Parse(v); err != nil {
		return "", ValidationError([]string{name + ": Invalid UUID"})
	}
	return strings.ToLower(v), nil
}

// Query helpers mirroring the zod coercions of the shared schemas.
type Query struct {
	r    *http.Request
	errs []string
}

func Q(r *http.Request) *Query { return &Query{r: r} }

func (q *Query) Str(name string) *string {
	v := strings.TrimSpace(q.r.URL.Query().Get(name))
	if v == "" {
		return nil
	}
	return &v
}

func (q *Query) Int(name string) *int {
	s := q.Str(name)
	if s == nil {
		return nil
	}
	n, err := strconv.Atoi(*s)
	if err != nil {
		q.errs = append(q.errs, name+": expected integer")
		return nil
	}
	return &n
}

func (q *Query) Float(name string) *float64 {
	s := q.Str(name)
	if s == nil {
		return nil
	}
	f, err := strconv.ParseFloat(*s, 64)
	if err != nil {
		q.errs = append(q.errs, name+": expected number")
		return nil
	}
	return &f
}

// Bool accepts true/false/1/0; anything else is treated as absent (zod boolQ semantics).
func (q *Query) Bool(name string) *bool {
	switch q.r.URL.Query().Get(name) {
	case "true", "1":
		t := true
		return &t
	case "false", "0":
		f := false
		return &f
	}
	return nil
}

// CSV splits "a,b,c" (also accepts repeated params ?a=1&a=2).
func (q *Query) CSV(name string) []string {
	var out []string
	for _, v := range q.r.URL.Query()[name] {
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}

func (q *Query) Fail(msg string) { q.errs = append(q.errs, msg) }

// Err returns a VALIDATION_ERROR if any query param failed to parse.
func (q *Query) Err() error {
	if len(q.errs) > 0 {
		return ValidationError(q.errs)
	}
	return nil
}
