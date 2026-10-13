package promotions

import (
	"testing"
	"time"
)

func TestExtendUntilStacks(t *testing.T) {
	now := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	ts := func(s string) *time.Time { v, _ := time.Parse(time.RFC3339, s); return &v }
	cases := []struct {
		cur  *time.Time
		want string
	}{
		{nil, "2026-10-20T00:00:00Z"},
		{ts("2026-10-15T00:00:00Z"), "2026-10-22T00:00:00Z"}, // running period → stacks on its end
		{ts("2026-10-01T00:00:00Z"), "2026-10-20T00:00:00Z"}, // past period → starts now
	}
	for _, c := range cases {
		if got := ExtendUntil(c.cur, 7, now).UTC().Format(time.RFC3339); got != c.want {
			t.Errorf("ExtendUntil(%v) = %s, want %s", c.cur, got, c.want)
		}
	}
}

func TestF32ShortestDecimal(t *testing.T) {
	if got := F32(72.3); got != 72.3 {
		t.Errorf("F32(72.3) = %v", got)
	}
}
