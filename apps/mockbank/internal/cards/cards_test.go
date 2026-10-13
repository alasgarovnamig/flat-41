package cards

import (
	"testing"
	"time"
)

func TestLuhnAndBrands(t *testing.T) {
	for _, c := range TestCards {
		if !LuhnValid(c.PAN) {
			t.Errorf("test card %s must be Luhn-valid", c.PAN)
		}
	}
	for _, pan := range []string{"4111111111111112", "411111111", "abcd", ""} {
		if LuhnValid(pan) {
			t.Errorf("%q must be invalid", pan)
		}
	}
	brands := map[string]string{
		"4111111111111111": Visa,
		"5555555555554444": Mastercard,
		"2221000000000009": Mastercard,
		"378282246310005":  Amex,
		"6200000000000005": UnionPay,
		"6759649826438453": Maestro,
		"5018000000000009": Maestro,
		"9999999999999995": Unknown,
		"":                 Unknown,
	}
	for pan, want := range brands {
		if got := DetectBrand(pan); got != want {
			t.Errorf("DetectBrand(%s) = %s, want %s", pan, got, want)
		}
	}
	if got := MaskPAN("4111111111111111"); got != "411111******1111" {
		t.Errorf("mask %s", got)
	}
	if got := MaskPAN("123456789"); got != "*********" {
		t.Errorf("short mask %s", got)
	}
}

func TestCardOutcome(t *testing.T) {
	cases := map[string]Outcome{
		"4111111111111111": {Kind: Approve},
		"4242424242424242": {Kind: Approve},
		"5555555555554444": {Kind: ThreeDS},
		"4000000000003220": {Kind: ThreeDS},
		"4000000000000002": {Kind: Decline, Code: "DO_NOT_HONOR"},
		"4000000000009995": {Kind: Decline, Code: "INSUFFICIENT_FUNDS"},
		"4000000000000069": {Kind: Decline, Code: "EXPIRED_CARD"},
		"4000000000000119": {Kind: Decline, Code: "PROCESSING_ERROR"},
		"4012888888881881": {Kind: ThreeDS},
	}
	for pan, want := range cases {
		if got := CardOutcome(pan); got != want {
			t.Errorf("CardOutcome(%s) = %+v, want %+v", pan, got, want)
		}
	}
}

func TestValidate(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.Local)
	card, errs := Validate(Input{Number: "4111 1111 1111 1111", Expiry: "12/29", CVV: " 123 ", Holder: "  ali   veli  "}, now)
	if card == nil {
		t.Fatalf("errors %v", errs)
	}
	if card.PAN != "4111111111111111" || card.Mask != "411111******1111" || card.Brand != Visa || card.ExpMonth != 12 || card.ExpYear != 2029 || card.Holder != "ALI VELI" {
		t.Fatalf("card %+v", card)
	}
	for _, exp := range []string{"10/26", "1026", "10 / 2026", "10/2030"} {
		if _, errs := Validate(Input{Number: "4111111111111111", Expiry: exp, CVV: "123", Holder: "Ali"}, now); len(errs) > 0 {
			t.Errorf("expiry %q: %v", exp, errs)
		}
	}
	_, errs = Validate(Input{Number: "4111111111111112", Expiry: "09/26", CVV: "12", Holder: "1"}, now)
	want := map[string]string{"number": NumberInvalid, "expiry": ExpiryPast, "cvv": CVVInvalid, "holder": HolderInvalid}
	for f, k := range want {
		if errs[f] != k {
			t.Errorf("%s: got %q want %q", f, errs[f], k)
		}
	}
	for _, exp := range []string{"13/30", "00/30", "1/2", "12/80", "abc"} {
		if _, errs := Validate(Input{Number: "4111111111111111", Expiry: exp, CVV: "123", Holder: "Ali"}, now); errs["expiry"] != ExpiryInvalid {
			t.Errorf("expiry %q: %v", exp, errs)
		}
	}
	// AMEX takes 3 or 4 digit CVV, others exactly 3
	if _, errs := Validate(Input{Number: "378282246310005", Expiry: "12/29", CVV: "1234", Holder: "Ali"}, now); len(errs) > 0 {
		t.Errorf("amex cvv: %v", errs)
	}
	if _, errs := Validate(Input{Number: "4111111111111111", Expiry: "12/29", CVV: "1234", Holder: "Ali"}, now); errs["cvv"] != CVVInvalid {
		t.Errorf("visa 4-digit cvv must fail")
	}
	// Unicode letters, apostrophes and hyphens are fine in the holder name.
	if _, errs := Validate(Input{Number: "4111111111111111", Expiry: "12/29", CVV: "123", Holder: "Şəhla O'Neil-Əliyeva"}, now); len(errs) > 0 {
		t.Errorf("holder: %v", errs)
	}
}
