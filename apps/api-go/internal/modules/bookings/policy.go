package bookings

import (
	"math"
	"regexp"
	"time"
)

// Pure booking rules (no DB) — shared by Service and unit tests.
// All bookable listings are in AZ / GE, both UTC+4 without DST, so "local" time is a fixed +04:00 offset.

// Local is the fixed UTC+4 zone of Baku / Tbilisi.
var Local = time.FixedZone("+04:00", 4*3600)

const (
	DefaultCheckInTime = "14:00"
	HoldMinutes        = 30
	MaxNights          = 365
)

var hhmm = regexp.MustCompile(`^\d{2}:\d{2}$`)

// LocalToday returns today's date (YYYY-MM-DD) in Baku / Tbilisi.
func LocalToday(now time.Time) string { return now.In(Local).Format("2006-01-02") }

// CheckInMoment is the check-in date at the listing's check-in time (default 14:00), local time.
func CheckInMoment(checkIn string, checkInTime *string) time.Time {
	t := DefaultCheckInTime
	if checkInTime != nil && hhmm.MatchString(*checkInTime) {
		t = *checkInTime
	}
	m, err := time.ParseInLocation("2006-01-02 15:04", checkIn+" "+t, Local)
	if err != nil {
		return time.Time{}
	}
	return m
}

// RangesOverlap: half-open date ranges [checkIn, checkOut) overlap (the checkout day can be the next guest's check-in day).
func RangesOverlap(aIn, aOut, bIn, bOut string) bool { return aIn < bOut && bIn < aOut }

// Cancellation actors.
const (
	ByGuest = "GUEST"
	ByHost  = "HOST"
	ByAdmin = "ADMIN"
)

// CancellationOutcome: refund to the guest and what the host still receives at payout time (0 = payout cancelled).
type CancellationOutcome struct {
	Refund     int
	HostPayout int
	Policy     string // FULL | PARTIAL
}

// Amounts are the money fields of a booking used by the cancellation policy.
type Amounts struct{ Subtotal, GuestFee, HostFee, Total int }

// Cancellation implements the policy of docs/BUSINESS_MODEL.md D:
//   - host or admin cancels → guest gets 100 % of the total (incl. service fee), host gets nothing;
//   - guest cancels ≥ freeCancellationHours before check-in → 100 % of the total;
//   - guest cancels later → 50 % of the subtotal is refunded, the guest service fee is kept. The host keeps the other
//     50 % of the subtotal minus the platform commission at the same rate as the booking (hostFee / subtotal).
func Cancellation(b Amounts, by string, hoursBeforeCheckIn float64, freeCancellationHours int) CancellationOutcome {
	if by != ByGuest || hoursBeforeCheckIn >= float64(freeCancellationHours) {
		return CancellationOutcome{Refund: b.Total, HostPayout: 0, Policy: "FULL"}
	}
	refund := b.Subtotal / 2
	kept := b.Subtotal - refund
	commission := 0
	if b.Subtotal > 0 {
		commission = int(math.Floor(float64(kept*b.HostFee)/float64(b.Subtotal) + 0.5)) // Math.round
	}
	return CancellationOutcome{Refund: refund, HostPayout: kept - commission, Policy: "PARTIAL"}
}
