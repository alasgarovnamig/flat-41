package moneytest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments/providers"
)

// Integration tests ported from apps/api/test/money.test.ts plus renewal, /bookings/:id/pay, payouts and refunds.

func appErr(err error) *httpx.AppError {
	var ae *httpx.AppError
	if errors.As(err, &ae) {
		return ae
	}
	return nil
}

func TestWalletLockingBonusFirstAndConcurrentDebits(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	u, tok := e.User("Wallet")
	e.Fund(u, 1000)
	if err := e.Wal.Credit(ctx, nil, u, 300, "BONUS", "bonus", app.WalletOpts{}); err != nil {
		t.Fatal(err)
	}
	row, err := e.Wal.DebitTx(ctx, nil, u, 400, "spend", app.WalletOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if row.Amount != -400 || row.BonusAmount != -300 || row.BalanceAfter != 900 || row.Type != "SPEND" {
		t.Fatalf("ledger row %+v", row)
	}
	if w := e.Wallet(u); w.Balance != 900 || w.BonusBalance != 0 || w.Currency != "AZN" {
		t.Fatalf("wallet %+v", w)
	}
	err = e.Wal.Debit(ctx, nil, u, 901, "too much", app.WalletOpts{})
	if ae := appErr(err); ae == nil || ae.Status != 402 || ae.Code != "INSUFFICIENT_FUNDS" {
		t.Fatalf("want 402 INSUFFICIENT_FUNDS, got %v", err)
	}
	if err := e.Wal.Debit(ctx, nil, u, 0, "zero", app.WalletOpts{}); appErr(err) == nil || appErr(err).Code != "INVALID_AMOUNT" {
		t.Fatalf("zero amount: %v", err)
	}

	// 20 concurrent debits of 50 on 900 → exactly 18 succeed, balance never negative.
	var wg sync.WaitGroup
	var mu sync.Mutex
	okCount, failCount := 0, 0
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := e.Wal.Debit(ctx, nil, u, 50, "race", app.WalletOpts{})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				okCount++
			} else if ae := appErr(err); ae != nil && ae.Code == "INSUFFICIENT_FUNDS" {
				failCount++
			} else {
				t.Errorf("unexpected error %v", err)
			}
		}()
	}
	wg.Wait()
	if okCount != 18 || failCount != 2 {
		t.Fatalf("concurrent debits: %d ok, %d insufficient", okCount, failCount)
	}
	if w := e.Wallet(u); w.Balance != 0 || w.BonusBalance != 0 {
		t.Fatalf("wallet after race %+v", w)
	}
	// Ledger is consistent: the sum of all rows equals the balance; balanceAfter strictly follows the order.
	var sum, minAfter int
	e.Scalar(`select coalesce(sum(amount),0) from wallet_transactions where user_id = $1`, &sum, u)
	e.Scalar(`select min(balance_after) from wallet_transactions where user_id = $1`, &minAfter, u)
	if sum != 0 || minAfter < 0 {
		t.Fatalf("ledger sum %d, min balanceAfter %d", sum, minAfter)
	}
	// HTTP: GET /wallet, /wallet/transactions
	r := e.Call("GET", "/wallet/transactions?pageSize=5", nil, tok)
	if r.Status != 200 || r.N("total") != 21 || len(r.Body["items"].([]any)) != 5 {
		t.Fatalf("transactions %d %s", r.Status, r.Raw)
	}
	if r := e.Call("GET", "/wallet", nil, ""); r.Status != 401 {
		t.Fatalf("anonymous /wallet → %d", r.Status)
	}
}

func signedWebhook(e *Env, raw []byte, secret string, ts string) Res {
	req, _ := http.NewRequest(http.MethodPost, e.Srv.URL+"/api/v1/payments/webhook/mockbank", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Merchant-Id", "evtap")
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", providers.Sign(secret, ts, raw))
	return e.Do(req)
}

func now() string { return strconv.FormatInt(time.Now().UnixMilli(), 10) }

func TestCardTopupWebhookFulfilsOnceReplaysIdempotent(t *testing.T) {
	e := New(t)
	u, tok := e.User("Topup")
	co := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 10000, "method": "CARD", "returnUrl": "evtap://payment/result"}, tok)
	if co.Status != 201 || co.S("status") != "PENDING" || !strings.HasPrefix(co.S("paymentUrl"), e.Bank.URL()) {
		t.Fatalf("checkout %d %s", co.Status, co.Raw)
	}
	pid := co.S("paymentId")
	back := e.PayCard(co.S("paymentUrl"), "4111111111111111", "")
	if back != "evtap://payment/result?paymentId="+pid+"&status=SUCCEEDED" {
		t.Fatalf("client redirect %s", back)
	}
	if !slices.ContainsFunc(e.Bank.Webhooks(), func(w Webhook) bool { return w.Event == "order.approved" && w.Status == 200 }) {
		t.Fatalf("webhook deliveries %+v", e.Bank.Webhooks())
	}
	order, _ := providers.ParseOrder(e.Bank.OrderFor(pid))
	var wg sync.WaitGroup
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := e.Pay.ApplyProviderOrder(context.Background(), order); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	raw, _ := json.Marshal(map[string]any{"event": "order.approved", "order": e.Bank.OrderFor(pid)})
	if r := signedWebhook(e, raw, "evtap-mockbank-secret", now()); r.Status != 200 || r.Body["ok"] != true {
		t.Fatalf("replay %d %s", r.Status, r.Raw)
	}
	if w := e.Wallet(u); w.Balance != 10000 || w.BonusBalance != 1000 {
		t.Fatalf("wallet %+v", w)
	}
	var n int
	e.Scalar(`select count(*) from wallet_transactions where payment_id = $1`, &n, pid)
	if n != 2 {
		t.Fatalf("TOPUP + BONUS exactly once, got %d rows", n)
	}
	p := e.Payment(pid)
	if p.Status != "SUCCEEDED" || p.FulfilledAt == nil || p.CardMask == nil || *p.CardMask != "411111******1111" || p.PaidAt == nil {
		t.Fatalf("payment %+v", p)
	}
	if got := e.Notifications(u); !slices.Equal(got, []string{"PAYMENT_SUCCEEDED"}) {
		t.Fatalf("notifications %v", got)
	}
	g := e.Call("GET", "/payments/"+pid, nil, tok)
	if g.Status != 200 || g.S("status") != "SUCCEEDED" || g.S("provider") != "mockbank" {
		t.Fatalf("GET payment %d %s", g.Status, g.Raw)
	}
	_, other := e.User("Other")
	if r := e.Call("GET", "/payments/"+pid, nil, other); r.Status != 404 {
		t.Fatalf("foreign payment → %d", r.Status)
	}
}

// Webhook and browser return race each other (and themselves) before either has finalised the payment.
func TestWebhookAndReturnRace(t *testing.T) {
	e := New(t)
	u, tok := e.User("Race")
	co := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 5000, "method": "CARD"}, tok)
	pid := co.S("paymentId")
	req, _ := http.NewRequest(http.MethodGet, co.S("paymentUrl")+"?card=4242424242424242&webhook=0", nil)
	r1 := e.Do(req) // approved at the bank, no webhook delivered yet
	returnURL := r1.Header.Get("Location")
	raw, _ := json.Marshal(map[string]any{"event": "order.approved", "order": e.Bank.OrderFor(pid)})

	var wg sync.WaitGroup
	locs := make(chan string, 8)
	for i := range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if i%2 == 0 {
				if r := signedWebhook(e, raw, "evtap-mockbank-secret", now()); r.Status != 200 {
					t.Errorf("webhook %d %s", r.Status, r.Raw)
				}
				return
			}
			req, _ := http.NewRequest(http.MethodGet, returnURL, nil)
			locs <- e.Do(req).Header.Get("Location")
		}()
	}
	wg.Wait()
	close(locs)
	for l := range locs {
		if l != "http://localhost:3000/payment/result?paymentId="+pid+"&status=SUCCEEDED" {
			t.Errorf("return redirect %s", l)
		}
	}
	if w := e.Wallet(u); w.Balance != 5000 || w.BonusBalance != 250 {
		t.Fatalf("wallet %+v (fulfilled more than once?)", w)
	}
	var n int
	e.Scalar(`select count(*) from wallet_transactions where payment_id = $1`, &n, pid)
	if n != 2 {
		t.Fatalf("ledger rows %d", n)
	}
	if got := e.Notifications(u); len(got) != 1 {
		t.Fatalf("one PAYMENT_SUCCEEDED expected, got %v", got)
	}
}

func TestForgedWebhookRejected(t *testing.T) {
	e := New(t)
	u, tok := e.User("Forged")
	co := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 500, "method": "CARD"}, tok)
	pid := co.S("paymentId")
	raw, _ := json.Marshal(map[string]any{"event": "order.approved", "order": map[string]any{
		"orderId": "ord_x", "merchantOrderId": pid, "amount": 500, "currency": "AZN", "status": "APPROVED"}})
	if r := signedWebhook(e, raw, "wrong-secret", now()); r.Status != 401 || r.Code() != "INVALID_SIGNATURE" {
		t.Fatalf("wrong secret → %d %s", r.Status, r.Raw)
	}
	old := strconv.FormatInt(time.Now().Add(-10*time.Minute).UnixMilli(), 10)
	if r := signedWebhook(e, raw, "evtap-mockbank-secret", old); r.Status != 401 {
		t.Fatalf("stale → %d", r.Status)
	}
	if r := signedWebhook(e, []byte("{not json"), "evtap-mockbank-secret", now()); r.Status != 401 {
		t.Fatalf("malformed body → %d", r.Status)
	}
	if r := signedWebhook(e, []byte(`{"event":"order.approved"}`), "evtap-mockbank-secret", now()); r.Status != 400 || r.Code() != "VALIDATION_ERROR" {
		t.Fatalf("payload without order → %d %s", r.Status, r.Raw)
	}
	req, _ := http.NewRequest(http.MethodPost, e.Srv.URL+"/api/v1/payments/webhook/otherbank", bytes.NewReader(raw))
	if r := e.Do(req); r.Status != 404 {
		t.Fatalf("unknown provider → %d", r.Status)
	}
	// A genuine signature over an order id that is not the payment's bank order is ignored.
	if r := signedWebhook(e, raw, "evtap-mockbank-secret", now()); r.Status != 200 {
		t.Fatalf("mismatched order → %d", r.Status)
	}
	if w := e.Wallet(u); w.Balance != 0 {
		t.Fatalf("wallet changed: %+v", w)
	}
	if p := e.Payment(pid); p.Status != "PENDING" {
		t.Fatalf("payment %s", p.Status)
	}
}

func TestDeclinedCard(t *testing.T) {
	e := New(t)
	u, tok := e.User("Declined")
	co := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 500, "method": "CARD"}, tok)
	back := e.PayCard(co.S("paymentUrl"), "4000000000000002", "")
	if !strings.Contains(back, "status=FAILED") {
		t.Fatalf("redirect %s", back)
	}
	p := e.Payment(co.S("paymentId"))
	if p.Status != "FAILED" || p.FailureReason == nil || *p.FailureReason != "Do not honor (DO_NOT_HONOR)" || p.FulfilledAt != nil {
		t.Fatalf("payment %+v", p)
	}
	if w := e.Wallet(u); w.Balance != 0 {
		t.Fatalf("wallet %+v", w)
	}
	if got := e.Notifications(u); !slices.Equal(got, []string{"PAYMENT_FAILED"}) {
		t.Fatalf("notifications %v", got)
	}
	// Cancel on the bank page → CANCELLED.
	co = e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 500, "method": "CARD"}, tok)
	if back := e.PayCard(co.S("paymentUrl"), "", "&action=cancel"); !strings.Contains(back, "status=CANCELLED") {
		t.Fatalf("cancel redirect %s", back)
	}
	// Return with an unknown payment id → FAILED redirect to the web result page.
	req, _ := http.NewRequest(http.MethodGet, e.Srv.URL+"/api/v1/payments/return/mockbank?paymentId=nope", nil)
	if r := e.Do(req); r.Status != 302 || r.Header.Get("Location") != "http://localhost:3000/payment/result?paymentId=nope&status=FAILED" {
		t.Fatalf("unknown return %d %s", r.Status, r.Header.Get("Location"))
	}
}

func TestCheckoutValidation(t *testing.T) {
	e := New(t)
	host, htok := e.User("Host")
	_, gtok := e.User("Guest")
	lid := e.Listing(host, ListingOpts{DealType: "SALE"})
	cases := []struct {
		body   map[string]any
		tok    string
		status int
		code   string
	}{
		{map[string]any{"purpose": "WALLET_TOPUP", "amount": 99, "method": "CARD"}, gtok, 400, "VALIDATION_ERROR"},
		{map[string]any{"purpose": "WALLET_TOPUP", "amount": 600000, "method": "CARD"}, gtok, 400, "AMOUNT_OUT_OF_RANGE"},
		{map[string]any{"purpose": "WALLET_TOPUP", "amount": 500, "method": "CARD", "returnUrl": "https://evil.example.com/x"}, gtok, 400, "RETURN_URL_NOT_ALLOWED"},
		{map[string]any{"purpose": "PROMOTION", "listingId": lid, "method": "WALLET"}, htok, 400, "VALIDATION_ERROR"},
		{map[string]any{"purpose": "PROMOTION", "listingId": lid, "serviceCodes": []string{"VIP_7"}, "method": "WALLET"}, gtok, 403, "FORBIDDEN"},
		{map[string]any{"purpose": "PROMOTION", "listingId": lid, "serviceCodes": []string{"NOPE"}, "method": "WALLET"}, htok, 400, "INVALID_SERVICE"},
		{map[string]any{"purpose": "PROMOTION", "listingId": lid, "serviceCodes": []string{"VIP_7"}, "method": "WALLET"}, htok, 402, "INSUFFICIENT_FUNDS"},
		{map[string]any{"purpose": "LISTING_FEE", "listingId": lid, "method": "WALLET"}, htok, 409, "LISTING_STATUS_INVALID"},
		{map[string]any{"purpose": "SUBSCRIPTION", "planCode": "GOLD", "period": "MONTH", "method": "WALLET"}, htok, 400, "VALIDATION_ERROR"},
		{map[string]any{"purpose": "VERIFICATION", "listingId": "00000000-0000-4000-8000-000000000000", "method": "WALLET"}, htok, 404, "NOT_FOUND"},
	}
	for i, c := range cases {
		r := e.Call("POST", "/checkout", c.body, c.tok)
		if r.Status != c.status || r.Code() != c.code {
			t.Errorf("case %d: %d %s", i, r.Status, r.Raw)
		}
	}
}

// Wallet-paid promotion / bundle / listing fee / verification, admin refund reversal, apply-credit, promotion crons.
func TestWalletPurchasesAndPromotionCrons(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	host, htok := e.User("Seller")
	e.Fund(host, 20000)
	lid := e.Listing(host, ListingOpts{DealType: "SALE"})

	r := e.Call("POST", "/checkout", map[string]any{"purpose": "PROMOTION", "listingId": lid, "bundleCode": "FAST_SALE", "serviceCodes": []string{"PREMIUM_1"}, "method": "WALLET"}, htok)
	if r.Status != 201 || r.S("status") != "SUCCEEDED" || r.N("amount") != 1100+300 || r.Body["paymentUrl"] != nil {
		t.Fatalf("bundle %d %s", r.Status, r.Raw)
	}
	var vip, urgent, premium, autoBump bool
	e.Scalar(`select vip_until > now() + interval '6 days' from listings where id = $1`, &vip, lid)
	e.Scalar(`select urgent_until > now() + interval '6 days' from listings where id = $1`, &urgent, lid)
	e.Scalar(`select premium_until > now() from listings where id = $1`, &premium, lid)
	e.Scalar(`select auto_bump_until > now() from listings where id = $1`, &autoBump, lid)
	if !vip || !urgent || !premium || !autoBump {
		t.Fatalf("promotions not applied vip=%v urgent=%v premium=%v autobump=%v", vip, urgent, premium, autoBump)
	}
	// stacking: VIP_7 again → +14 days
	e.Call("POST", "/checkout", map[string]any{"purpose": "PROMOTION", "listingId": lid, "serviceCodes": []string{"VIP_7"}, "method": "WALLET"}, htok)
	e.Scalar(`select vip_until > now() + interval '13 days' from listings where id = $1`, &vip, lid)
	if !vip {
		t.Fatal("VIP periods must stack")
	}

	// VERIFICATION by wallet → badge; admin full refund → badge revoked, money back.
	v := e.Call("POST", "/checkout", map[string]any{"purpose": "VERIFICATION", "listingId": lid, "method": "WALLET"}, htok)
	var verified bool
	e.Scalar(`select is_verified from listings where id = $1`, &verified, lid)
	if v.Status != 201 || !verified {
		t.Fatalf("verification %d %s", v.Status, v.Raw)
	}
	if r := e.Call("POST", "/checkout", map[string]any{"purpose": "VERIFICATION", "listingId": lid, "method": "WALLET"}, htok); r.Code() != "ALREADY_VERIFIED" {
		t.Fatalf("second verification %s", r.Raw)
	}
	_, atok := e.Admin()
	before := e.Wallet(host)
	rf := e.Call("POST", "/admin/payments/"+v.S("paymentId")+"/refund", map[string]any{"reason": "inspection failed"}, atok)
	if rf.Status != 200 || rf.S("status") != "REFUNDED" || rf.N("refundedAmount") != 1500 {
		t.Fatalf("refund %d %s", rf.Status, rf.Raw)
	}
	e.Scalar(`select is_verified from listings where id = $1`, &verified, lid)
	if verified || e.Wallet(host).Balance != before.Balance+1500 {
		t.Fatalf("verified=%v wallet %+v → %+v", verified, before, e.Wallet(host))
	}
	if r := e.Call("POST", "/admin/payments/"+v.S("paymentId")+"/refund", nil, atok); r.Status != 409 || r.Code() != "NOT_REFUNDABLE" {
		t.Fatalf("double refund %d %s", r.Status, r.Raw)
	}
	var audits int
	e.Scalar(`select count(*) from audit_logs where action = 'payment.refund' and entity_id = $1`, &audits, v.S("paymentId"))
	if audits != 1 {
		t.Fatalf("audit rows %d", audits)
	}

	// LISTING_FEE (DRAFT → PENDING with moderation; listings fallback while d.Listings is nil).
	draft := e.Listing(host, ListingOpts{DealType: "SALE", Status: "DRAFT"})
	if r := e.Call("POST", "/checkout", map[string]any{"purpose": "LISTING_FEE", "listingId": draft, "method": "WALLET"}, htok); r.Status != 201 || r.N("amount") != 300 {
		t.Fatalf("listing fee %d %s", r.Status, r.Raw)
	}
	var status string
	var free bool
	e.Scalar(`select status from listings where id = $1`, &status, draft)
	e.Scalar(`select is_free_quota from listings where id = $1`, &free, draft)
	if status != "PENDING" || free {
		t.Fatalf("draft → %s free=%v", status, free)
	}

	// apply-credit without subscription → 402 NO_SUBSCRIPTION
	if r := e.Call("POST", "/listings/"+lid+"/apply-credit", map[string]any{"credit": "BUMP"}, htok); r.Status != 402 || r.Code() != "NO_SUBSCRIPTION" {
		t.Fatalf("apply-credit %d %s", r.Status, r.Raw)
	}
	if r := e.Call("POST", "/listings/"+lid+"/apply-credit", map[string]any{"credit": "GOLD"}, htok); r.Status != 400 {
		t.Fatalf("bad credit %d", r.Status)
	}

	// Crons: expire past promotions (one notification), auto-bump.
	e.Exec(`update listings set vip_until = now() - interval '1 minute', urgent_until = now() - interval '1 minute', bumped_at = now() - interval '2 days' where id = $1`, lid)
	if _, err := e.Promo.ExpirePromotions(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	var vipNull, urgentNull bool
	e.Scalar(`select vip_until is null from listings where id = $1`, &vipNull, lid)
	e.Scalar(`select urgent_until is null from listings where id = $1`, &urgentNull, lid)
	if !vipNull || !urgentNull {
		t.Fatal("expired promotions not cleared")
	}
	var body string
	e.Scalar(`select body from notifications where user_id = $1 and type = 'PROMOTION_EXPIRED'`, &body, host)
	if !strings.Contains(body, "VIP, \"Təcili\" nişanı") {
		t.Fatalf("notification body %q", body)
	}
	if _, err := e.Promo.AutoBump(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	var bumped bool
	e.Scalar(`select bumped_at > now() - interval '1 minute' from listings where id = $1`, &bumped, lid)
	if !bumped {
		t.Fatal("auto-bump did not bump")
	}
}

// Partial admin refund of a card top-up: money taken back from the wallet, proportional bonus revoked, bank refunded.
func TestAdminRefundOfCardTopup(t *testing.T) {
	e := New(t)
	u, tok := e.User("Refund")
	_, atok := e.Admin()
	co := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 10000, "method": "CARD"}, tok)
	e.PayCard(co.S("paymentUrl"), "4111111111111111", "")
	rf := e.Call("POST", "/admin/payments/"+co.S("paymentId")+"/refund", map[string]any{"amount": 5000}, atok)
	if rf.Status != 200 || rf.S("status") != "PARTIALLY_REFUNDED" {
		t.Fatalf("refund %d %s", rf.Status, rf.Raw)
	}
	if w := e.Wallet(u); w.Balance != 5000 || w.BonusBalance != 500 {
		t.Fatalf("wallet %+v", w)
	}
	if o := e.Bank.OrderFor(co.S("paymentId")); o["refundedAmount"].(float64) != 5000 {
		t.Fatalf("bank order %+v", o)
	}
	if r := e.Call("POST", "/admin/payments/"+co.S("paymentId")+"/refund", map[string]any{"amount": 6000}, atok); r.Code() != "REFUND_AMOUNT_INVALID" {
		t.Fatalf("over-refund %s", r.Raw)
	}
	_, mtok := e.User("Mod")
	if r := e.Call("POST", "/admin/payments/"+co.S("paymentId")+"/refund", nil, mtok); r.Status != 403 {
		t.Fatalf("non-admin refund → %d", r.Status)
	}
	d := e.Call("GET", "/admin/payments/"+co.S("paymentId"), nil, atok)
	if d.Status != 200 || d.Body["user"].(map[string]any)["id"] != u || d.Body["fulfilledAt"] == nil || d.Body["metadata"].(map[string]any)["refunds"] == nil {
		t.Fatalf("admin detail %s", d.Raw)
	}
	l := e.Call("GET", "/admin/payments?purpose=WALLET_TOPUP&status=PARTIALLY_REFUNDED&userId="+u, nil, atok)
	if l.N("total") != 1 || l.Body["items"].([]any)[0].(map[string]any)["userName"] != "Refund" {
		t.Fatalf("admin list %s", l.Raw)
	}
	if r := e.Call("GET", "/admin/payments?status=NOPE", nil, atok); r.Status != 400 {
		t.Fatalf("bad filter → %d", r.Status)
	}
}

// Concurrent requests for the same dates → exactly one hold; wallet booking confirms; refund policy applied.
func TestConcurrentBookingsExactlyOneWins(t *testing.T) {
	e := New(t)
	host, _ := e.User("Host")
	lid := e.Listing(host, ListingOpts{Price: 80})
	type guest struct{ id, tok string }
	var gs []guest
	for range 4 {
		id, tok := e.User("Guest")
		e.Fund(id, 100000)
		gs = append(gs, guest{id, tok})
	}
	in := map[string]any{"listingId": lid, "checkIn": Day(10), "checkOut": Day(12), "guests": 2, "method": "WALLET"}
	results := make([]Res, len(gs))
	var wg sync.WaitGroup
	for i, g := range gs {
		wg.Add(1)
		go func() { defer wg.Done(); results[i] = e.Call("POST", "/bookings", in, g.tok) }()
	}
	wg.Wait()
	var winner *Res
	var winnerTok, winnerID string
	for i, r := range results {
		switch r.Status {
		case 201:
			if winner != nil {
				t.Fatal("more than one booking won")
			}
			winner, winnerTok, winnerID = &results[i], gs[i].tok, gs[i].id
		case 409:
			if r.Code() != "DATES_UNAVAILABLE" {
				t.Errorf("loser code %s", r.Code())
			}
		default:
			t.Errorf("unexpected %d %s", r.Status, r.Raw)
		}
	}
	if winner == nil {
		t.Fatal("no booking won")
	}
	b := winner.Body["booking"].(map[string]any)
	if b["status"] != "CONFIRMED" || b["total"].(float64) != 17280 || winner.Body["checkout"].(map[string]any)["status"] != "SUCCEEDED" {
		t.Fatalf("booking %s", winner.Raw)
	}
	bid := b["id"].(string)
	if w := e.Wallet(winnerID); w.Balance != 100000-17280 {
		t.Fatalf("winner wallet %+v", w)
	}
	// own listing / past dates / too many guests are refused
	_, htok := "", e.Token(host, "USER")
	if r := e.Call("POST", "/bookings/quote", map[string]any{"listingId": lid, "checkIn": Day(20), "checkOut": Day(21), "guests": 1}, htok); r.S("unavailableReason") != "OWN_LISTING" {
		t.Fatalf("own listing quote %s", r.Raw)
	}
	if r := e.Call("POST", "/bookings", map[string]any{"listingId": lid, "checkIn": Day(-2), "checkOut": Day(1), "guests": 1, "method": "WALLET"}, winnerTok); r.Code() != "PAST_DATE" {
		t.Fatalf("past date %s", r.Raw)
	}
	if r := e.Call("POST", "/bookings/quote", map[string]any{"listingId": lid, "checkIn": Day(20), "checkOut": Day(21), "guests": 9}, ""); r.S("unavailableReason") != "MAX_GUESTS" || r.Body["available"] != false {
		t.Fatalf("max guests %s", r.Raw)
	}
	if r := e.Call("POST", "/bookings/quote", map[string]any{"listingId": lid, "checkIn": Day(21), "checkOut": Day(20), "guests": 1}, ""); r.Status != 400 {
		t.Fatalf("checkOut before checkIn → %d", r.Status)
	}
	// host sees the booking with the guest phone (paid), notifications sent
	hl := e.Call("GET", "/bookings?role=host", nil, htok)
	if hl.N("total") != 1 || hl.Body["items"].([]any)[0].(map[string]any)["guest"].(map[string]any)["phone"] == nil {
		t.Fatalf("host list %s", hl.Raw)
	}
	if !slices.Contains(e.Notifications(host), "BOOKING_NEW") || !slices.Contains(e.Notifications(winnerID), "BOOKING_CONFIRMED") {
		t.Fatalf("notifications host %v guest %v", e.Notifications(host), e.Notifications(winnerID))
	}

	// guest cancels 10 days ahead → 100 % back to the wallet; twice → refused
	c := e.Call("POST", "/bookings/"+bid+"/cancel", map[string]any{"reason": "test"}, winnerTok)
	if c.Status != 200 || c.S("status") != "CANCELLED" || c.N("refundedAmount") != 17280 || c.S("payoutStatus") != "CANCELLED" || c.S("cancelledBy") != "GUEST" {
		t.Fatalf("cancel %d %s", c.Status, c.Raw)
	}
	if w := e.Wallet(winnerID); w.Balance != 100000 {
		t.Fatalf("wallet after refund %+v", w)
	}
	if r := e.Call("POST", "/bookings/"+bid+"/cancel", nil, winnerTok); r.Status != 409 || r.Code() != "BOOKING_NOT_CANCELLABLE" {
		t.Fatalf("second cancel %d %s", r.Status, r.Raw)
	}
	_, stranger := e.User("Stranger")
	if r := e.Call("GET", "/bookings/"+bid, nil, stranger); r.Status != 404 {
		t.Fatalf("stranger get → %d", r.Status)
	}
	// dates are free again
	if r := e.Call("POST", "/bookings/quote", map[string]any{"listingId": lid, "checkIn": Day(10), "checkOut": Day(12), "guests": 2}, ""); r.Body["available"] != true {
		t.Fatalf("dates after cancel %s", r.Raw)
	}
}

// Late guest cancellation (< 48 h) → 50 % of the subtotal refunded by the bank; host payout of the rest; payouts cron;
// completion; review + reply.
func TestLateCancelPayoutCompletionAndReviews(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	host, htok := e.User("Host")
	lid := e.Listing(host, ListingOpts{Price: 100})
	g, gtok := e.User("Guest")

	// card booking tomorrow (< 48 h before check-in)
	r := e.Call("POST", "/bookings", map[string]any{"listingId": lid, "checkIn": Day(1), "checkOut": Day(3), "guests": 1, "method": "CARD", "returnUrl": "evtap://payment/result"}, gtok)
	if r.Status != 201 || r.Body["checkout"].(map[string]any)["status"] != "PENDING" {
		t.Fatalf("create %d %s", r.Status, r.Raw)
	}
	bid := r.Body["booking"].(map[string]any)["id"].(string)
	co := r.Body["checkout"].(map[string]any)
	if b := e.Call("GET", "/bookings/"+bid, nil, gtok); b.Body["host"].(map[string]any)["phone"] != nil {
		t.Fatal("phones must stay hidden until paid")
	}
	e.PayCard(co["paymentUrl"].(string), "5555555555554444", "")
	c := e.Call("POST", "/bookings/"+bid+"/cancel", nil, gtok)
	// subtotal 20000, fee 1600 → refund 10000; host keeps 10000 - 3 % = 9700
	if c.N("refundedAmount") != 10000 || c.N("hostPayout") != 9700 || c.S("payoutStatus") != "PENDING" {
		t.Fatalf("late cancel %s", c.Raw)
	}
	if p := e.Payment(co["paymentId"].(string)); p.Status != "PARTIALLY_REFUNDED" || p.RefundedAmount != 10000 {
		t.Fatalf("payment %+v", p)
	}

	// second booking via wallet, moved into the past → completion + payout
	e.Fund(g, 100000)
	r = e.Call("POST", "/bookings", map[string]any{"listingId": lid, "checkIn": Day(5), "checkOut": Day(7), "guests": 1, "method": "WALLET"}, gtok)
	bid2 := r.Body["booking"].(map[string]any)["id"].(string)
	if rv := e.Call("POST", "/bookings/"+bid2+"/review", map[string]any{"rating": 5, "comment": "Əla idi!"}, gtok); rv.Code() != "BOOKING_NOT_COMPLETED" {
		t.Fatalf("early review %s", rv.Raw)
	}
	if hc := e.Call("POST", "/bookings/"+bid2+"/cancel", nil, htok); hc.Status != 200 {
		// host cancel would refund 100 %; just make sure the host is allowed (then recreate)
		t.Fatalf("host cancel %d %s", hc.Status, hc.Raw)
	}
	r = e.Call("POST", "/bookings", map[string]any{"listingId": lid, "checkIn": Day(5), "checkOut": Day(7), "guests": 1, "method": "WALLET"}, gtok)
	bid2 = r.Body["booking"].(map[string]any)["id"].(string)
	e.Exec(`update bookings set check_in = $2::date, check_out = $3::date where id = $1`, bid2, Day(-3), Day(-1))
	e.Exec(`update bookings set check_in = $2::date where id = $1`, bid, Day(-3))
	hostBefore := e.Wallet(host)
	st, err := e.Book.CompleteAndPayout(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var status, payout string
	e.Scalar(`select status from bookings where id = $1`, &status, bid2)
	e.Scalar(`select payout_status from bookings where id = $1`, &payout, bid2)
	if status != "COMPLETED" || payout != "PAID" || st.PaidOut < 2 {
		t.Fatalf("completion %s / %s stats %+v", status, payout, st)
	}
	if w := e.Wallet(host); w.Balance != hostBefore.Balance+19400+9700 {
		t.Fatalf("host wallet %+v → %+v", hostBefore, w)
	}
	if !slices.Contains(e.Notifications(host), "PAYOUT") {
		t.Fatal("PAYOUT notification missing")
	}
	// idempotent
	if st, _ := e.Book.CompleteAndPayout(ctx, time.Now()); st.PaidOut != 0 {
		t.Fatalf("second run paid again %+v", st)
	}

	rv := e.Call("POST", "/bookings/"+bid2+"/review", map[string]any{"rating": 4, "comment": "  Çox gözəl yer  "}, gtok)
	if rv.Status != 201 || rv.S("comment") != "Çox gözəl yer" || rv.Body["author"].(map[string]any)["id"] != g {
		t.Fatalf("review %d %s", rv.Status, rv.Raw)
	}
	if again := e.Call("POST", "/bookings/"+bid2+"/review", map[string]any{"rating": 4, "comment": "again!"}, gtok); again.Code() != "ALREADY_REVIEWED" {
		t.Fatalf("second review %s", again.Raw)
	}
	var avg float64
	var cnt int
	e.Scalar(`select rating_avg::float8 from listings where id = $1`, &avg, lid)
	e.Scalar(`select reviews_count from listings where id = $1`, &cnt, lid)
	if avg != 4 || cnt != 1 {
		t.Fatalf("rating %v count %d", avg, cnt)
	}
	if rp := e.Call("POST", "/reviews/"+rv.S("id")+"/reply", map[string]any{"reply": "Təşəkkürlər"}, gtok); rp.Status != 403 {
		t.Fatalf("guest reply → %d", rp.Status)
	}
	if rp := e.Call("POST", "/reviews/"+rv.S("id")+"/reply", map[string]any{"reply": "Təşəkkürlər"}, htok); rp.Status != 200 || rp.S("hostReply") != "Təşəkkürlər" {
		t.Fatalf("host reply %d %s", rp.Status, rp.Raw)
	}
	if b := e.Call("GET", "/bookings/"+bid2, nil, gtok); b.Body["canReview"] != false {
		t.Fatalf("canReview after review %s", b.Raw)
	}

	// admin cancel of a completed stay is refused; admin list filters
	_, atok := e.Admin()
	if r := e.Call("POST", "/admin/bookings/"+bid2+"/cancel", map[string]any{"reason": "x"}, atok); r.Code() != "BOOKING_NOT_CANCELLABLE" {
		t.Fatalf("admin cancel completed %s", r.Raw)
	}
	if r := e.Call("POST", "/admin/bookings/"+bid2+"/cancel", map[string]any{"reason": "  "}, atok); r.Status != 400 {
		t.Fatalf("admin cancel without reason %d", r.Status)
	}
	if r := e.Call("GET", "/admin/bookings?payoutStatus=PAID&pageSize=100", nil, atok); r.Status != 200 || r.N("total") < 1 {
		t.Fatalf("admin list %s", r.Raw)
	}
}

// POST /bookings/:id/pay: a declined card releases the booking (not resumable); an abandoned checkout is resumed by
// reusing the open bank order; a card declined at the bank whose webhook was lost gets a new payment; switching to
// the wallet cancels the open order; an expired hold is refused and released by the cron.
func TestBookingPayResume(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	host, _ := e.User("Host")
	lid := e.Listing(host, ListingOpts{Price: 50})
	g, gtok := e.User("Guest")
	book := func(day int, extra map[string]any) (string, map[string]any) {
		body := map[string]any{"listingId": lid, "checkIn": Day(day), "checkOut": Day(day + 1), "guests": 1, "method": "CARD", "returnUrl": "evtap://payment/result"}
		for k, v := range extra {
			body[k] = v
		}
		r := e.Call("POST", "/bookings", body, gtok)
		if r.Status != 201 {
			t.Fatalf("create %d %s", r.Status, r.Raw)
		}
		return r.Body["booking"].(map[string]any)["id"].(string), r.Body["checkout"].(map[string]any)
	}

	// declined card → booking CANCELLED, dates free, /pay refused
	bid, first := book(10, nil)
	if back := e.PayCard(first["paymentUrl"].(string), "4000000000009995", ""); !strings.Contains(back, "status=FAILED") {
		t.Fatalf("decline redirect %s", back)
	}
	if b := e.Call("GET", "/bookings/"+bid, nil, gtok); b.S("status") != "CANCELLED" || b.S("cancelReason") != "Ödəniş alınmadı" {
		t.Fatalf("declined booking %s", b.Raw)
	}
	if q := e.Call("POST", "/bookings/quote", map[string]any{"listingId": lid, "checkIn": Day(10), "checkOut": Day(11), "guests": 1}, ""); q.Body["available"] != true {
		t.Fatalf("dates must be free again %s", q.Raw)
	}
	if r := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD"}, gtok); r.Status != 409 || r.Code() != "INVALID_STATUS" {
		t.Fatalf("pay cancelled → %d %s", r.Status, r.Raw)
	}

	// abandoned checkout → /pay reuses the open order (return URL updated) → paid
	bid, first = book(12, nil)
	_, otok := e.User("Other")
	if r := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD"}, otok); r.Status != 404 || r.Code() != "NOT_FOUND" {
		t.Fatalf("foreign pay → %d", r.Status)
	}
	if r := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD", "returnUrl": "https://evil.example.com"}, gtok); r.Code() != "RETURN_URL_NOT_ALLOWED" {
		t.Fatalf("bad return url %s", r.Raw)
	}
	if r := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "BITCOIN"}, gtok); r.Status != 400 {
		t.Fatalf("bad method → %d", r.Status)
	}
	p1 := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD", "returnUrl": "http://localhost:3000/az/payment/result"}, gtok)
	if p1.Status != 200 || p1.S("status") != "PENDING" || p1.S("paymentId") != first["paymentId"] || p1.S("paymentUrl") != first["paymentUrl"] {
		t.Fatalf("pay must reuse the open order: %d %s", p1.Status, p1.Raw)
	}
	if back := e.PayCard(p1.S("paymentUrl"), "4111111111111111", ""); back != "http://localhost:3000/az/payment/result?paymentId="+p1.S("paymentId")+"&status=SUCCEEDED" {
		t.Fatalf("redirect %s", back)
	}
	if b := e.Call("GET", "/bookings/"+bid, nil, gtok); b.S("status") != "CONFIRMED" || b.S("paymentId") != p1.S("paymentId") {
		t.Fatalf("booking %s", b.Raw)
	}
	if r := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD"}, gtok); r.Status != 409 || r.Code() != "INVALID_STATUS" {
		t.Fatalf("pay confirmed → %d %s", r.Status, r.Raw)
	}

	// declined at the bank but the webhook was lost and the browser never came back → /pay records the decline,
	// keeps the booking and starts a new payment
	bid, first = book(14, nil)
	req, _ := http.NewRequest(http.MethodGet, first["paymentUrl"].(string)+"?card=4000000000000002&webhook=0", nil)
	e.Do(req)
	p2 := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD"}, gtok)
	if p2.Status != 200 || p2.S("paymentId") == first["paymentId"] || p2.S("status") != "PENDING" {
		t.Fatalf("pay after lost decline %d %s", p2.Status, p2.Raw)
	}
	if p := e.Payment(first["paymentId"].(string)); p.Status != "FAILED" {
		t.Fatalf("old payment %s", p.Status)
	}
	if b := e.Call("GET", "/bookings/"+bid, nil, gtok); b.S("status") != "PENDING_PAYMENT" {
		t.Fatalf("booking must survive the superseded payment: %s", b.Raw)
	}
	e.PayCard(p2.S("paymentUrl"), "5555555555554444", "")
	if b := e.Call("GET", "/bookings/"+bid, nil, gtok); b.S("status") != "CONFIRMED" || b.S("paymentId") != p2.S("paymentId") {
		t.Fatalf("booking %s", b.Raw)
	}

	// switch to the wallet: insufficient first (open order untouched), then the open order is cancelled and the wallet pays
	bid, first = book(20, nil)
	open := first["paymentId"].(string)
	if w := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "WALLET"}, gtok); w.Status != 402 || w.Code() != "INSUFFICIENT_FUNDS" || e.Payment(open).Status != "PENDING" {
		t.Fatalf("insufficient wallet %d %s / %s", w.Status, w.Raw, e.Payment(open).Status)
	}
	e.Fund(g, 10000)
	w := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "WALLET"}, gtok)
	if w.Status != 200 || w.S("status") != "SUCCEEDED" || w.Body["paymentUrl"] != nil || w.N("amount") != 5400 {
		t.Fatalf("wallet pay %d %s", w.Status, w.Raw)
	}
	if p := e.Payment(open); p.Status != "CANCELLED" {
		t.Fatalf("open order → %s", p.Status)
	}
	if o := e.Bank.OrderFor(open); o["status"] != "CANCELLED" {
		t.Fatalf("bank order %v", o["status"])
	}
	if b := e.Call("GET", "/bookings/"+bid, nil, gtok); b.S("status") != "CONFIRMED" || b.S("paymentId") != w.S("paymentId") {
		t.Fatalf("booking %s", b.Raw)
	}
	if bal := e.Wallet(g); bal.Balance != 10000-5400 {
		t.Fatalf("wallet %+v", bal)
	}

	// expired hold → /pay refused; the cron releases it and cancels the open bank order
	bid, first = book(40, nil)
	pid := first["paymentId"].(string)
	e.Exec(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, bid)
	if r := e.Call("POST", "/bookings/"+bid+"/pay", map[string]any{"method": "CARD"}, gtok); r.Status != 409 || r.Code() != "INVALID_STATUS" {
		t.Fatalf("expired hold pay %d %s", r.Status, r.Raw)
	}
	if _, err := e.Book.ReleaseExpiredHolds(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	var reason string
	e.Scalar(`select status || ':' || cancel_reason from bookings where id = $1`, &reason, bid)
	if reason != "CANCELLED:Ödəniş vaxtı bitdi" || e.Payment(pid).Status != "CANCELLED" {
		t.Fatalf("released hold %s / payment %s", reason, e.Payment(pid).Status)
	}
	// a late approval of the released (system-cancelled) hold revives it when the dates are still free
	order, _ := providers.ParseOrder(e.Bank.OrderFor(pid))
	order.Status, order.Raw["status"] = providers.StatusApproved, "APPROVED"
	e.Exec(`update payments set status = 'PENDING' where id = $1`, pid)
	if _, err := e.Pay.ApplyProviderOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	var st string
	e.Scalar(`select status from bookings where id = $1`, &st, bid)
	if st != "CONFIRMED" {
		t.Fatalf("late approval did not revive the hold: %s", st)
	}
}

// A payment approved for dates that were taken meanwhile is refunded automatically.
func TestLateApprovalForTakenDatesIsRefunded(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	host, _ := e.User("Host")
	lid := e.Listing(host, ListingOpts{Price: 50})
	_, gtok := e.User("Guest")
	r := e.Call("POST", "/bookings", map[string]any{"listingId": lid, "checkIn": Day(10), "checkOut": Day(12), "guests": 1, "method": "CARD"}, gtok)
	bid := r.Body["booking"].(map[string]any)["id"].(string)
	co := r.Body["checkout"].(map[string]any)
	// hold expires, someone else books the dates by wallet
	e.Exec(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, bid)
	if _, err := e.Book.ReleaseExpiredHolds(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	o, otok := e.User("Other")
	e.Fund(o, 100000)
	if r := e.Call("POST", "/bookings", map[string]any{"listingId": lid, "checkIn": Day(11), "checkOut": Day(13), "guests": 1, "method": "WALLET"}, otok); r.Status != 201 {
		t.Fatalf("other booking %d %s", r.Status, r.Raw)
	}
	// the first guest's bank order gets approved late (reopen it at the bank for the test)
	order, _ := providers.ParseOrder(e.Bank.OrderFor(co["paymentId"].(string)))
	order.Status, order.Raw["status"] = providers.StatusApproved, "APPROVED"
	e.Exec(`update payments set status = 'PENDING' where id = $1`, co["paymentId"])
	order.RefundedAmount = 0
	// the fake bank must accept the refund: mark its order approved too
	e.Bank.mu.Lock()
	e.Bank.orders[order.OrderID].Status = "APPROVED"
	e.Bank.mu.Unlock()
	if _, err := e.Pay.ApplyProviderOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	p := e.Payment(co["paymentId"].(string))
	if p.Status != "REFUNDED" || p.RefundedAmount != p.Amount {
		t.Fatalf("late approval must be refunded: %s %d/%d", p.Status, p.RefundedAmount, p.Amount)
	}
	var st string
	e.Scalar(`select status from bookings where id = $1`, &st, bid)
	if st != "CANCELLED" {
		t.Fatalf("booking %s", st)
	}
}

// Subscription by card with saved token → renewal by token (success); token declined → PAST_DUE, retried daily,
// EXPIRED after 3 attempts; wallet renewal success + failure; cancel / resume.
func TestSubscriptionRenewal(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	u, tok := e.User("Agency")
	lid := e.Listing(u, ListingOpts{DealType: "SALE"})

	co := e.Call("POST", "/checkout", map[string]any{"purpose": "SUBSCRIPTION", "planCode": "PRO", "period": "MONTH", "method": "CARD", "returnUrl": "evtap://payment/result"}, tok)
	if !strings.Contains(e.PayCard(co.S("paymentUrl"), "4111111111111111", ""), "SUCCEEDED") {
		t.Fatal("subscription payment failed")
	}
	me := e.Call("GET", "/subscriptions/me", nil, tok)
	usage := me.Body["usage"].(map[string]any)
	if me.S("status") != "ACTIVE" || me.S("cardMask") != "411111******1111" || usage["bumpsLeft"].(float64) != 150 || usage["vipCreditsLeft"].(float64) != 5 {
		t.Fatalf("subscription %s", me.Raw)
	}
	var acct string
	e.Scalar(`select account_type from users where id = $1`, &acct, u)
	if acct != "BUSINESS" {
		t.Fatalf("account type %s", acct)
	}
	sid := me.S("id")
	var token string
	e.Scalar(`select card_token from subscriptions where id = $1`, &token, sid)

	// spend a credit
	cr := e.Call("POST", "/listings/"+lid+"/apply-credit", map[string]any{"credit": "VIP_7"}, tok)
	if cr.Status != 200 || cr.Body["isVip"] != true {
		t.Fatalf("apply credit %d %s", cr.Status, cr.Raw)
	}

	// renewal by saved card (success)
	e.Exec(`update subscriptions set current_period_end = now() - interval '1 minute' where id = $1`, sid)
	res, err := e.Subs.Renew(ctx, sid, time.Now())
	if err != nil || res != "RENEWED" {
		t.Fatalf("renew %q %v", res, err)
	}
	var vip, attempts int
	var ends time.Time
	e.Scalar(`select vip_credits_left from subscriptions where id = $1`, &vip, sid)
	e.Scalar(`select renewal_attempts from subscriptions where id = $1`, &attempts, sid)
	e.Scalar(`select current_period_end from subscriptions where id = $1`, &ends, sid)
	if vip != 5 || attempts != 0 || ends.Before(time.Now().Add(27*24*time.Hour)) {
		t.Fatalf("after renewal vip=%d attempts=%d end=%v", vip, attempts, ends)
	}
	var renewals int
	e.Scalar(`select count(*) from payments where user_id = $1 and purpose = 'SUBSCRIPTION' and status = 'SUCCEEDED' and metadata->>'renewal' = 'true'`, &renewals, u)
	if renewals != 1 || !slices.Contains(e.Notifications(u), "SUBSCRIPTION_RENEWED") {
		t.Fatalf("renewal payments %d, notifications %v", renewals, e.Notifications(u))
	}

	// failure path: token declined → PAST_DUE ×2, then EXPIRED; back to INDIVIDUAL
	e.Bank.SetInsufficient(token, true)
	e.Exec(`update subscriptions set current_period_end = now() - interval '1 minute' where id = $1`, sid)
	for i, want := range []string{"PAST_DUE", "PAST_DUE", "EXPIRED"} {
		res, err := e.Subs.Renew(ctx, sid, time.Now())
		if err != nil || res != want {
			t.Fatalf("attempt %d: %q %v", i+1, res, err)
		}
		if i == 0 {
			// the hourly job does not retry within a day
			if _, err := e.Subs.ProcessRenewals(ctx, time.Now()); err != nil {
				t.Fatal(err)
			}
			e.Scalar(`select renewal_attempts from subscriptions where id = $1`, &attempts, sid)
			if attempts != 1 {
				t.Fatalf("retried too early: %d attempts", attempts)
			}
		}
	}
	var failed int
	e.Scalar(`select count(*) from payments where user_id = $1 and purpose = 'SUBSCRIPTION' and status = 'FAILED'`, &failed, u)
	e.Scalar(`select account_type from users where id = $1`, &acct, u)
	if failed != 3 || acct != "INDIVIDUAL" || !slices.Contains(e.Notifications(u), "SUBSCRIPTION_EXPIRED") {
		t.Fatalf("failed payments %d, account %s, notifications %v", failed, acct, e.Notifications(u))
	}
	if me := e.Call("GET", "/subscriptions/me", nil, tok); string(bytes.TrimSpace(me.Raw)) != "null" {
		t.Fatalf("expired subscription still returned: %s", me.Raw)
	}

	// wallet subscription: cancel / resume, renewal from the wallet, then failure for lack of funds
	w, wtok := e.User("WalletBiz")
	e.Fund(w, 4900)
	if r := e.Call("POST", "/checkout", map[string]any{"purpose": "SUBSCRIPTION", "planCode": "START", "period": "MONTH", "method": "WALLET"}, wtok); r.S("status") != "SUCCEEDED" {
		t.Fatalf("wallet subscription %s", r.Raw)
	}
	if r := e.Call("POST", "/subscriptions/me/cancel", nil, wtok); r.S("status") != "CANCELLED" || r.Body["autoRenew"] != false {
		t.Fatalf("cancel %s", r.Raw)
	}
	if r := e.Call("POST", "/subscriptions/me/resume", nil, wtok); r.S("status") != "ACTIVE" || r.Body["autoRenew"] != true {
		t.Fatalf("resume %s", r.Raw)
	}
	var wsid string
	e.Scalar(`select id from subscriptions where user_id = $1`, &wsid, w)
	e.Fund(w, 4900)
	e.Exec(`update subscriptions set current_period_end = now() - interval '1 minute' where id = $1`, wsid)
	if res, err := e.Subs.Renew(ctx, wsid, time.Now()); err != nil || res != "RENEWED" {
		t.Fatalf("wallet renewal %q %v", res, err)
	}
	if bal := e.Wallet(w); bal.Balance != 0 {
		t.Fatalf("wallet after renewal %+v", bal)
	}
	e.Exec(`update subscriptions set current_period_end = now() - interval '1 minute' where id = $1`, wsid)
	if res, err := e.Subs.Renew(ctx, wsid, time.Now()); err != nil || res != "PAST_DUE" {
		t.Fatalf("wallet renewal failure %q %v", res, err)
	}
	var body string
	e.Scalar(`select body from notifications where user_id = $1 and type = 'PAYMENT_FAILED' order by created_at desc limit 1`, &body, w)
	if !strings.Contains(body, "Balansda kifayət qədər vəsait yoxdur") {
		t.Fatalf("PAYMENT_FAILED body %q", body)
	}
	// PAST_DUE + new purchase of the same plan → a fresh subscription replaces it
	e.Fund(w, 4900)
	if r := e.Call("POST", "/checkout", map[string]any{"purpose": "SUBSCRIPTION", "planCode": "START", "period": "MONTH", "method": "WALLET"}, wtok); r.S("status") != "SUCCEEDED" {
		t.Fatalf("re-subscribe %s", r.Raw)
	}
	var active, expired int
	e.Scalar(`select count(*) from subscriptions where user_id = $1 and status = 'ACTIVE'`, &active, w)
	e.Scalar(`select count(*) from subscriptions where user_id = $1 and status = 'EXPIRED'`, &expired, w)
	if active != 1 || expired != 1 {
		t.Fatalf("active %d expired %d", active, expired)
	}
	// non-renewing subscription past its end → EXPIRED by the job
	e.Exec(`update subscriptions set auto_renew = false, status = 'CANCELLED', current_period_end = now() - interval '1 minute' where user_id = $1 and status = 'ACTIVE'`, w)
	if _, err := e.Subs.ProcessRenewals(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.Scalar(`select count(*) from subscriptions where user_id = $1 and status = 'EXPIRED'`, &expired, w)
	if expired != 2 {
		t.Fatalf("expired %d", expired)
	}
	_, atok := e.Admin()
	if r := e.Call("GET", "/admin/subscriptions?status=EXPIRED&pageSize=100", nil, atok); r.Status != 200 || r.N("total") < 2 {
		t.Fatalf("admin subscriptions %d %s", r.Status, r.Raw)
	}
}

// Admin catalog / settings and revenue stats.
func TestAdminCatalogSettingsRevenue(t *testing.T) {
	e := New(t)
	_, atok := e.Admin()
	mid, _ := e.User("Moderator")
	e.Exec(`update users set role = 'MODERATOR' where id = $1`, mid)
	mtok := e.Token(mid, "MODERATOR")

	if r := e.Call("GET", "/catalog", nil, ""); r.Status != 200 || len(r.Body["plans"].([]any)) != 3 || r.Body["settings"].(map[string]any)["listingFee"] == nil {
		t.Fatalf("catalog %s", r.Raw)
	}
	if r := e.Call("GET", "/admin/catalog", nil, mtok); r.Status != 200 {
		t.Fatalf("admin catalog for moderator → %d", r.Status)
	}
	if r := e.Call("PATCH", "/admin/catalog/services/URGENT_7", map[string]any{"price": 250}, mtok); r.Status != 403 {
		t.Fatalf("moderator patch → %d", r.Status)
	}
	r := e.Call("PATCH", "/admin/catalog/services/URGENT_7", map[string]any{"price": 250}, atok)
	if r.Status != 200 || r.N("price") != 250 || r.S("code") != "URGENT_7" {
		t.Fatalf("patch service %d %s", r.Status, r.Raw)
	}
	e.Call("PATCH", "/admin/catalog/services/URGENT_7", map[string]any{"price": 200}, atok)
	if r := e.Call("PATCH", "/admin/catalog/services/NOPE", map[string]any{"price": 1}, atok); r.Status != 404 {
		t.Fatalf("unknown service → %d", r.Status)
	}
	if r := e.Call("PATCH", "/admin/catalog/plans/START", map[string]any{"listingQuota": -2}, atok); r.Status != 400 {
		t.Fatalf("invalid plan quota → %d", r.Status)
	}
	if r := e.Call("PATCH", "/admin/catalog/plans/START", map[string]any{"maxAgents": 3}, atok); r.N("maxAgents") != 3 {
		t.Fatalf("patch plan %s", r.Raw)
	}
	e.Call("PATCH", "/admin/catalog/plans/START", map[string]any{"maxAgents": 2}, atok)
	cur := e.Call("GET", "/admin/settings", nil, atok)
	if cur.Status != 200 || cur.Body["moderationEnabled"] == nil {
		t.Fatalf("settings %s", cur.Raw)
	}
	if r := e.Call("PATCH", "/admin/settings", map[string]any{"minTopup": 999999999}, atok); r.Status != 400 || r.Code() != "VALIDATION_ERROR" {
		t.Fatalf("minTopup > maxTopup → %d %s", r.Status, r.Raw)
	}
	r = e.Call("PATCH", "/admin/settings", map[string]any{"payoutDelayHours": 12, "topupBonuses": []map[string]any{{"minAmount": 5000, "bonusPercent": 5}}}, atok)
	if r.Status != 200 || r.N("payoutDelayHours") != 12 || len(r.Body["topupBonuses"].([]any)) != 1 || r.N("listingFee") != cur.N("listingFee") {
		t.Fatalf("patch settings %d %s", r.Status, r.Raw)
	}
	e.Call("PATCH", "/admin/settings", map[string]any{"payoutDelayHours": cur.N("payoutDelayHours"), "topupBonuses": cur.Body["topupBonuses"]}, atok)

	rev := e.Call("GET", "/admin/stats/revenue?days=3", nil, mtok)
	var pts []map[string]any
	if err := json.Unmarshal(rev.Raw, &pts); err != nil || len(pts) != 3 || pts[2]["date"] != time.Now().In(time.FixedZone("", 4*3600)).Format("2006-01-02") {
		t.Fatalf("revenue %s", rev.Raw)
	}
	for _, k := range []string{"value", "bookingCommission", "WALLET_TOPUP", "PROMOTION", "LISTING_FEE", "SUBSCRIPTION", "BOOKING", "VERIFICATION"} {
		if _, ok := pts[0][k]; !ok {
			t.Fatalf("revenue point lacks %s", k)
		}
	}
	if r := e.Call("GET", "/admin/stats/revenue?days=0", nil, mtok); r.Status != 400 {
		t.Fatalf("days=0 → %d", r.Status)
	}
}

// Reconciliation: stale PENDING card payments are re-fetched from the bank; unanswered ones fail after 24 h.
func TestReconciliation(t *testing.T) {
	e := New(t)
	ctx := context.Background()
	u, tok := e.User("Reconcile")
	co := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 700, "method": "CARD"}, tok)
	pid := co.S("paymentId")
	req, _ := http.NewRequest(http.MethodGet, co.S("paymentUrl")+"?card=4111111111111111&webhook=0", nil)
	e.Do(req) // paid at the bank, webhook lost, browser never returned
	co2 := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 700, "method": "CARD"}, tok)
	e.Exec(`update payments set created_at = now() - interval '20 minutes' where id = $1`, pid)
	e.Exec(`update payments set created_at = now() - interval '25 hours', provider_order_id = null where id = $1`, co2.S("paymentId"))
	if _, err := e.Pay.Reconcile(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if p := e.Payment(pid); p.Status != "SUCCEEDED" || e.Wallet(u).Balance != 700 {
		t.Fatalf("reconciled payment %s wallet %+v", p.Status, e.Wallet(u))
	}
	if p := e.Payment(co2.S("paymentId")); p.Status != "FAILED" || p.FailureReason == nil || *p.FailureReason != "Bankdan cavab alınmadı" {
		t.Fatalf("dead payment %+v", p)
	}
	// expired at the bank → FAILED with the expiry reason
	co3 := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 700, "method": "CARD"}, tok)
	o := e.Bank.OrderFor(co3.S("paymentId"))
	e.Bank.Expire(o["orderId"].(string))
	if p := e.Payment(co3.S("paymentId")); p.Status != "FAILED" || *p.FailureReason != "Ödəniş müddəti bitdi" {
		t.Fatalf("expired order → %s %v", p.Status, p.FailureReason)
	}
}

// Bank unreachable when creating the order → 502, payment FAILED without a notification.
func TestProviderUnavailable(t *testing.T) {
	e := New(t)
	u, tok := e.User("NoBank")
	e.Bank.Close()
	r := e.Call("POST", "/checkout", map[string]any{"purpose": "WALLET_TOPUP", "amount": 700, "method": "CARD"}, tok)
	if r.Status != 502 || r.Code() != "PAYMENT_PROVIDER_UNAVAILABLE" {
		t.Fatalf("checkout with bank down %d %s", r.Status, r.Raw)
	}
	var status string
	e.Scalar(`select status from payments where user_id = $1`, &status, u)
	if status != "FAILED" || len(e.Notifications(u)) != 0 {
		t.Fatalf("payment %s notifications %v", status, e.Notifications(u))
	}
}
