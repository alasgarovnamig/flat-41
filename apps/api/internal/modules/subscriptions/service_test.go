package subscriptions

import (
	"testing"
	"time"
)

func TestAddPeriodClampsToMonthEnd(t *testing.T) {
	cases := []struct{ in, period, want string }{
		{"2026-01-31T10:00:00Z", "MONTH", "2026-02-28T10:00:00Z"},
		{"2028-01-31T10:00:00Z", "MONTH", "2028-02-29T10:00:00Z"},
		{"2026-10-13T10:00:00Z", "YEAR", "2027-10-13T10:00:00Z"},
		{"2026-12-15T00:00:00Z", "MONTH", "2027-01-15T00:00:00Z"},
	}
	for _, c := range cases {
		in, _ := time.Parse(time.RFC3339, c.in)
		if got := AddPeriod(in, c.period, 1).Format(time.RFC3339); got != c.want {
			t.Errorf("AddPeriod(%s, %s) = %s, want %s", c.in, c.period, got, c.want)
		}
	}
}
