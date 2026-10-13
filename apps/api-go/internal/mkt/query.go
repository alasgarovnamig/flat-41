package mkt

import (
	"strings"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// QEnum reads an optional enum query param; an unknown value is recorded as a validation problem.
func QEnum(q *httpx.Query, name string, values []string) *string {
	v := q.Str(name)
	if v == nil {
		return nil
	}
	if !contains(values, *v) {
		q.Fail(name + `: Invalid option: expected one of "` + strings.Join(values, `"|"`) + `"`)
		return nil
	}
	return v
}

// QUUID reads an optional UUID query param.
func QUUID(q *httpx.Query, name string) *string {
	v := q.Str(name)
	if v == nil {
		return nil
	}
	if !IsUUID(*v) {
		q.Fail(name + ": Invalid UUID")
		return nil
	}
	return v
}

// QMax reads an optional string param with a max length (after trim).
func QMax(q *httpx.Query, name string, max int) *string {
	v := q.Str(name)
	if v != nil && jsLen(*v) > max {
		q.Fail(name + ": Too big: expected string to have <=" + itoa(max) + " characters")
		return nil
	}
	return v
}

// QDays parses ?days (int 1..365, default 30) like the former daysSchema.
func QDays(q *httpx.Query) int {
	d := q.Int("days")
	if d == nil {
		return 30
	}
	if *d < 1 || *d > 365 {
		q.Fail("days: expected 1..365")
		return 30
	}
	return *d
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}
