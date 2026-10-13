package bookings

import (
	"testing"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// Ported from apps/api/test/money.test.ts ("booking price math", "cancellation refund policy").

func TestBookingPriceMath(t *testing.T) {
	r := shared.CalcBooking(100, shared.NightsBetween("2026-11-01", "2026-11-04"), shared.Defs.Settings)
	if r != (shared.BookingCalc{Subtotal: 30000, GuestFee: 2400, HostFee: 900, Total: 32400, HostPayout: 29100}) {
		t.Fatalf("3 nights × 100 ₼: %+v", r)
	}
	r = shared.CalcBooking(37, 3, shared.PlatformSettings{DailyRentGuestFeePercent: 7.5, DailyRentHostFeePercent: 3})
	if r.Subtotal != 11100 || r.GuestFee != 833 || r.Total != r.Subtotal+r.GuestFee {
		t.Fatalf("rounding (832.5 → 833): %+v", r)
	}
}

func TestRangesHalfOpen(t *testing.T) {
	cases := []struct {
		a, b, c, d string
		want       bool
	}{
		{"2026-11-01", "2026-11-04", "2026-11-04", "2026-11-06", false}, // back-to-back allowed
		{"2026-11-01", "2026-11-04", "2026-11-03", "2026-11-06", true},
		{"2026-11-02", "2026-11-03", "2026-11-01", "2026-11-06", true},
	}
	for _, c := range cases {
		if got := RangesOverlap(c.a, c.b, c.c, c.d); got != c.want {
			t.Errorf("RangesOverlap(%s,%s,%s,%s) = %v", c.a, c.b, c.c, c.d, got)
		}
	}
}

func TestCheckInMomentBakuTime(t *testing.T) {
	ct := "15:00"
	if got := CheckInMoment("2026-11-01", &ct).UTC().Format(time.RFC3339); got != "2026-11-01T11:00:00Z" {
		t.Errorf("15:00 Baku = %s", got)
	}
	if got := CheckInMoment("2026-11-01", nil).UTC().Format(time.RFC3339); got != "2026-11-01T10:00:00Z" {
		t.Errorf("default 14:00 Baku = %s", got)
	}
	bad := "3pm"
	if got := CheckInMoment("2026-11-01", &bad).UTC().Format(time.RFC3339); got != "2026-11-01T10:00:00Z" {
		t.Errorf("invalid time falls back to 14:00: %s", got)
	}
	if got := LocalToday(time.Date(2026, 11, 1, 21, 30, 0, 0, time.UTC)); got != "2026-11-02" {
		t.Errorf("LocalToday = %s", got)
	}
}

func TestTopupBonusTiers(t *testing.T) {
	for amount, want := range map[int]int{4999: 0, 5000: 250, 10000: 1000, 30000: 4500} {
		if got := shared.TopupBonusFor(amount, shared.Defs.Settings); got != want {
			t.Errorf("bonus(%d) = %d, want %d", amount, got, want)
		}
	}
}

func TestCancellationPolicy(t *testing.T) {
	b := Amounts{Subtotal: 30000, GuestFee: 2400, HostFee: 900, Total: 32400}
	if got := Cancellation(b, ByGuest, 48, 48); got != (CancellationOutcome{Refund: 32400, HostPayout: 0, Policy: "FULL"}) {
		t.Errorf("guest ≥ 48 h: %+v", got)
	}
	if got := Cancellation(b, ByGuest, 47.9, 48); got != (CancellationOutcome{Refund: 15000, HostPayout: 15000 - 450, Policy: "PARTIAL"}) {
		t.Errorf("guest late: %+v", got)
	}
	if got := Cancellation(b, ByHost, 1, 48); got.Refund != 32400 || got.HostPayout != 0 {
		t.Errorf("host: %+v", got)
	}
	if got := Cancellation(b, ByAdmin, -10, 48); got.Refund != 32400 {
		t.Errorf("admin: %+v", got)
	}
}
