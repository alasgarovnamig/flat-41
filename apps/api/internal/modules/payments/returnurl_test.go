package payments

import (
	"testing"

	"github.com/alasgarovnamig/evtap/api/internal/config"
)

// Ported from apps/api/test/money.test.ts ("payment return URLs").

func testCfg(prod bool) *config.Config {
	return &config.Config{
		IsProd: prod, WebURL: "https://evtap.az", AdminURL: "https://admin.evtap.az", APIPublicURL: "https://api.evtap.az",
		CORSOrigins: []string{"*", "https://partner.evtap.az:8443"},
	}
}

func TestReturnURLAllowList(t *testing.T) {
	dev, prod := testCfg(false), testCfg(true)
	cases := []struct {
		url        string
		dev, prodV bool
	}{
		{"evtap://payment/result", true, true},
		{"exp://192.168.1.5:8081/--/payment/result", true, true},
		{"exps://u.expo.dev/payment/result", true, true},
		{"https://evtap.az/az/payment/result?x=1", true, true},
		{"https://EVTAP.az:443/payment/result", true, true}, // default port + case-insensitive host
		{"https://admin.evtap.az/payments", true, true},
		{"https://partner.evtap.az:8443/back", true, true}, // CORS origin
		{"https://partner.evtap.az/back", false, false},    // different port → different origin
		{"http://localhost:3000/payment/result", true, false},
		{"http://127.0.0.1:5173/x", true, false},
		{"https://evil.example.com/payment/result", false, false},
		{"https://evtap.az.evil.com/payment/result", false, false},
		{"javascript:alert(1)", false, false},
		{"/payment/result", false, false},
		{"not a url", false, false},
	}
	for _, c := range cases {
		if got := IsAllowedReturnURL(dev, c.url); got != c.dev {
			t.Errorf("dev %s = %v", c.url, got)
		}
		if got := IsAllowedReturnURL(prod, c.url); got != c.prodV {
			t.Errorf("prod %s = %v", c.url, got)
		}
	}
}

func TestBuildClientReturn(t *testing.T) {
	cfg := testCfg(false)
	s := func(v string) *string { return &v }
	cases := []struct {
		ret  *string
		want string
	}{
		{s("evtap://payment/result"), "evtap://payment/result?paymentId=p1&status=SUCCEEDED"},
		{s("https://evtap.az/payment/result?x=1"), "https://evtap.az/payment/result?x=1&paymentId=p1&status=SUCCEEDED"},
		{s("https://evtap.az/r?status=OLD&a=b&status=X"), "https://evtap.az/r?status=SUCCEEDED&a=b&paymentId=p1"},
		{nil, "https://evtap.az/payment/result?paymentId=p1&status=SUCCEEDED"},
	}
	for _, c := range cases {
		if got := BuildClientReturn(cfg, c.ret, "p1", "SUCCEEDED"); got != c.want {
			t.Errorf("BuildClientReturn(%v) = %s, want %s", c.ret, got, c.want)
		}
	}
	if got := BuildClientReturn(cfg, s("https://evtap.az/payment/result?x=1"), "p1", "FAILED"); got != "https://evtap.az/payment/result?x=1&paymentId=p1&status=FAILED" {
		t.Errorf("FAILED: %s", got)
	}
}

func TestCheckoutBodyValidation(t *testing.T) {
	amt := 50
	b := &CheckoutBody{Purpose: "WALLET_TOPUP", Amount: &amt, Method: "WALLET"}
	if errs := b.Check(); len(errs) != 2 {
		t.Errorf("top-up below 100 by wallet: %v", errs)
	}
	lid := "not-a-uuid"
	b = &CheckoutBody{Purpose: "PROMOTION", ListingID: &lid, ServiceCodes: []string{}, Method: "CARD"}
	if errs := b.Check(); len(errs) != 2 {
		t.Errorf("promotion: %v", errs)
	}
	b = &CheckoutBody{Purpose: "NOPE"}
	if errs := b.Check(); len(errs) != 1 {
		t.Errorf("purpose: %v", errs)
	}
	plan, period, ret := "PRO", "YEAR", "evtap://payment/result"
	b = &CheckoutBody{Purpose: "SUBSCRIPTION", PlanCode: &plan, Period: &period, Method: "CARD", ReturnURL: &ret}
	if errs := b.Check(); len(errs) != 0 {
		t.Errorf("subscription: %v", errs)
	}
}
