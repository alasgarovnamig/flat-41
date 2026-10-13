package util

import (
	"regexp"
	"testing"
)

func TestFormatMoney(t *testing.T) {
	cases := map[string]string{
		FormatMoney(1500, "AZN"):        "15.00 ₼",
		FormatMoney(1500, "USD"):        "$15.00",
		FormatMoney(99, "EUR"):          "€0.99",
		FormatMoney(123456789, "GEL"):   "1 234 567.89 ₾",
		FormatMoney(100000000, "AZN"):   "1 000 000.00 ₼",
		FormatMoney(5, "XYZ"):           "0.05 XYZ",
		FormatMoney(100000, "USD"):      "$1 000.00",
		FormatMoney(10000000000, "AZN"): "100 000 000.00 ₼",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %q want %q", got, want)
		}
	}
}

func TestParseMajorAmount(t *testing.T) {
	ok := map[string]int64{"5": 500, "5.5": 550, "5,50": 550, " 12.34 ": 1234, "0.01": 1}
	for in, want := range ok {
		if got, valid := ParseMajorAmount(in); !valid || got != want {
			t.Errorf("%q → %d %v, want %d", in, got, valid, want)
		}
	}
	for _, in := range []string{"", "abc", "1.234", "-5", "1e3", "1234567890"} {
		if _, valid := ParseMajorAmount(in); valid {
			t.Errorf("%q must be invalid", in)
		}
	}
}

func TestIsValidURL(t *testing.T) {
	for _, u := range []string{"https://evtap.az/x?y=1", "http://127.0.0.1:4000/hook", "HTTPS://Example.com"} {
		if !IsValidURL(u, false) {
			t.Errorf("%q must be valid", u)
		}
	}
	for _, u := range []string{"not a url", "ftp://example.com/x", "http://", "evtap://payment/result", "javascript:alert(1)", "/relative"} {
		if IsValidURL(u, false) {
			t.Errorf("%q must be invalid for callbacks", u)
		}
	}
	if !IsValidURL("evtap://payment/result", true) {
		t.Error("app scheme must be allowed for returnUrl")
	}
	for _, u := range []string{"javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "blob:x"} {
		if IsValidURL(u, true) {
			t.Errorf("%q must be rejected", u)
		}
	}
	long := "https://e.com/" + string(make([]byte, 0))
	for len(long) <= 2048 {
		long += "a"
	}
	if IsValidURL(long, false) {
		t.Error("URLs over 2048 chars are rejected")
	}
}

func TestAppendQueryAndEncoding(t *testing.T) {
	p := []KV{{"orderId", "ord_1"}, {"merchantOrderId", "a b*~é&/"}, {"status", "APPROVED"}}
	cases := map[string]string{
		"https://x.test/r":         "https://x.test/r?orderId=ord_1&merchantOrderId=a+b*%7E%C3%A9%26%2F&status=APPROVED",
		"https://x.test/r?p=1":     "https://x.test/r?p=1&orderId=ord_1&merchantOrderId=a+b*%7E%C3%A9%26%2F&status=APPROVED",
		"https://x.test/r?":        "https://x.test/r?orderId=ord_1&merchantOrderId=a+b*%7E%C3%A9%26%2F&status=APPROVED",
		"https://x.test/r?p=1&":    "https://x.test/r?p=1&orderId=ord_1&merchantOrderId=a+b*%7E%C3%A9%26%2F&status=APPROVED",
		"evtap://payment/result#f": "evtap://payment/result?orderId=ord_1&merchantOrderId=a+b*%7E%C3%A9%26%2F&status=APPROVED#f",
	}
	for in, want := range cases {
		if got := AppendQuery(in, p...); got != want {
			t.Errorf("AppendQuery(%q)\n got %s\nwant %s", in, got, want)
		}
	}
	if got := EncodeURL("https://x.test/a b?q=é&x=%41%zz\"<>"); got != "https://x.test/a%20b?q=%C3%A9&x=%41%25zz%22%3C%3E" {
		t.Errorf("EncodeURL %s", got)
	}
}

func TestIDs(t *testing.T) {
	if !regexp.MustCompile(`^ord_[0-9a-f]{24}$`).MatchString(NewID("ord", 12)) {
		t.Error("ord id")
	}
	if !regexp.MustCompile(`^tok_[0-9a-f]{32}$`).MatchString(NewID("tok", 16)) {
		t.Error("tok id")
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{24}$`).MatchString(NewNonce()) {
		t.Error("nonce")
	}
	for i := 0; i < 200; i++ {
		if !regexp.MustCompile(`^[1-9]\d{11}$`).MatchString(NewRRN()) {
			t.Fatal("rrn")
		}
		if !regexp.MustCompile(`^[A-HJ-NP-Z0-9]{6}$`).MatchString(NewApprovalCode()) {
			t.Fatal("approval code")
		}
	}
}

func TestJSStrings(t *testing.T) {
	if JSLen("a😀é") != 4 {
		t.Error("JSLen counts UTF-16 units")
	}
	if JSSlice("ab😀c", 3) != "ab" || JSSlice("abc", 10) != "abc" || JSSlice("ab😀c", 4) != "ab😀" {
		t.Error("JSSlice")
	}
	if JSTrim("\u00a0"+string(rune(0xFEFF))+" x \n") != "x" {
		t.Error("JSTrim")
	}
	if CollapseSpaces("a \t\n b") != "a b" {
		t.Error("CollapseSpaces")
	}
	if DigitsOnly("4111 1111-11a11 1111") != "4111111111111111" {
		t.Error("DigitsOnly")
	}
	if SanitizeText("a\x00b\xffc") != "a�b�c" {
		t.Error("SanitizeText")
	}
}
