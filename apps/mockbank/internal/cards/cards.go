// Package cards implements PAN validation, brand detection, masking and the simulated
// issuer behaviour for the test cards (docs/MOCKBANK.md).
package cards

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

// Brands.
const (
	Visa       = "VISA"
	Mastercard = "MASTERCARD"
	Amex       = "AMEX"
	Maestro    = "MAESTRO"
	UnionPay   = "UNIONPAY"
	Unknown    = "UNKNOWN"
)

// Outcome kinds.
const (
	Approve = "APPROVE"
	ThreeDS = "3DS"
	Decline = "DECLINE"
)

// Outcome is what the simulated issuer does with a (Luhn-valid) PAN.
type Outcome struct {
	Kind string
	Code string // decline code when Kind == Decline
}

// TestCard is one row of the test-card table.
type TestCard struct {
	PAN     string
	Outcome Outcome
}

// TestCards — docs/MOCKBANK.md "Test cards".
var TestCards = []TestCard{
	{"4111111111111111", Outcome{Kind: Approve}},
	{"4242424242424242", Outcome{Kind: Approve}},
	{"5555555555554444", Outcome{Kind: ThreeDS}},
	{"4000000000003220", Outcome{Kind: ThreeDS}},
	{"4000000000000002", Outcome{Kind: Decline, Code: "DO_NOT_HONOR"}},
	{"4000000000009995", Outcome{Kind: Decline, Code: "INSUFFICIENT_FUNDS"}},
	{"4000000000000069", Outcome{Kind: Decline, Code: "EXPIRED_CARD"}},
	{"4000000000000119", Outcome{Kind: Decline, Code: "PROCESSING_ERROR"}},
}

// CardOutcome returns the issuer behaviour; unknown cards go through 3-D Secure.
func CardOutcome(pan string) Outcome {
	for _, c := range TestCards {
		if c.PAN == pan {
			return c.Outcome
		}
	}
	return Outcome{Kind: ThreeDS}
}

var panRe = regexp.MustCompile(`^\d{12,19}$`)

// LuhnValid reports whether pan is 12–19 digits with a valid Luhn checksum.
func LuhnValid(pan string) bool {
	if !panRe.MatchString(pan) {
		return false
	}
	sum := 0
	double := false
	for i := len(pan) - 1; i >= 0; i-- {
		d := int(pan[i] - '0')
		if double {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}
	return sum%10 == 0
}

var (
	maestroRe = regexp.MustCompile(`^(50|5[6-9]|6)`)
	mcRe      = regexp.MustCompile(`^5[1-5]`)
	amexRe    = regexp.MustCompile(`^3[47]`)
)

// DetectBrand returns the card scheme for a PAN prefix.
func DetectBrand(pan string) string {
	if strings.HasPrefix(pan, "4") {
		return Visa
	}
	if amexRe.MatchString(pan) {
		return Amex
	}
	p4 := 0
	if len(pan) >= 1 {
		end := 4
		if len(pan) < 4 {
			end = len(pan)
		}
		p4, _ = strconv.Atoi(pan[:end])
	}
	if mcRe.MatchString(pan) || (p4 >= 2221 && p4 <= 2720) {
		return Mastercard
	}
	if strings.HasPrefix(pan, "62") {
		return UnionPay
	}
	if maestroRe.MatchString(pan) {
		return Maestro
	}
	return Unknown
}

// MaskPAN: "4111111111111111" → "411111******1111".
func MaskPAN(pan string) string {
	if len(pan) < 10 {
		return strings.Repeat("*", len(pan))
	}
	return pan[:6] + strings.Repeat("*", len(pan)-10) + pan[len(pan)-4:]
}

// Input is the raw card form.
type Input struct {
	Number string
	Expiry string
	CVV    string
	Holder string
}

// Validated is a card that passed validation. The PAN only lives in memory for the
// duration of the request — it is never persisted (nor is the CVV).
type Validated struct {
	PAN      string
	Brand    string
	Mask     string
	ExpMonth int
	ExpYear  int
	Holder   string
}

// Error keys (i18n keys).
const (
	NumberInvalid = "numberInvalid"
	ExpiryInvalid = "expiryInvalid"
	ExpiryPast    = "expiryPast"
	CVVInvalid    = "cvvInvalid"
	HolderInvalid = "holderInvalid"
)

var expiryRe = regexp.MustCompile(`^(\d{1,2})\s*/?\s*(\d{2}|\d{4})$`)

// ParseExpiry parses "MM/YY", "MM / YY", "MMYY" or "MM/YYYY".
func ParseExpiry(value string) (month, year int, ok bool) {
	m := expiryRe.FindStringSubmatch(util.JSTrim(value))
	if m == nil {
		return 0, 0, false
	}
	month, _ = strconv.Atoi(m[1])
	year, _ = strconv.Atoi(m[2])
	if year < 100 {
		year += 2000
	}
	if month < 1 || month > 12 {
		return 0, 0, false
	}
	return month, year, true
}

var (
	cvv3Re   = regexp.MustCompile(`^\d{3}$`)
	cvv34Re  = regexp.MustCompile(`^\d{3,4}$`)
	holderRe = regexp.MustCompile(`^[\p{L} .'-]+$`)
)

// Validate checks the card form. errors maps field (number|expiry|cvv|holder) → error key.
func Validate(in Input, now time.Time) (*Validated, map[string]string) {
	errs := map[string]string{}
	pan := util.DigitsOnly(in.Number)
	if len(pan) < 12 || len(pan) > 19 || !LuhnValid(pan) {
		errs["number"] = NumberInvalid
	}
	brand := DetectBrand(pan)

	month, year, ok := ParseExpiry(in.Expiry)
	if !ok {
		errs["expiry"] = ExpiryInvalid
	} else {
		current := now.Year()*12 + int(now.Month()) - 1
		card := year*12 + (month - 1)
		if card < current {
			errs["expiry"] = ExpiryPast
		} else if card > current+20*12 {
			errs["expiry"] = ExpiryInvalid
		}
	}

	cvv := util.JSTrim(in.CVV)
	cvvOK := cvv3Re.MatchString(cvv)
	if brand == Amex {
		cvvOK = cvv34Re.MatchString(cvv)
	}
	if !cvvOK {
		errs["cvv"] = CVVInvalid
	}

	holder := util.CollapseSpaces(util.JSTrim(in.Holder))
	if n := util.JSLen(holder); n < 2 || n > 60 || !holderRe.MatchString(holder) {
		errs["holder"] = HolderInvalid
	}

	if len(errs) > 0 || !ok {
		return nil, errs
	}
	return &Validated{PAN: pan, Brand: brand, Mask: MaskPAN(pan), ExpMonth: month, ExpYear: year, Holder: strings.ToUpper(holder)}, nil
}
