package app

import (
	"context"
	"regexp"
	"testing"
	"time"
)

func TestOrderExpiry(t *testing.T) {
	srv := startTestServer(t, serverOpts{})
	rcv := startReceiver(t)

	t.Run("expires unpaid orders after their 30-minute window and sends order.expired", func(t *testing.T) {
		id := srv.createOrder(rcv, nil)
		processing := srv.createOrder(rcv, nil)
		srv.submitCard(processing, "5555555555554444", nil) // stuck in 3-D Secure
		paid := srv.createOrder(rcv, nil)
		srv.submitCard(paid, "4111111111111111", nil)

		if _, err := srv.App.DB.Exec(context.Background(), `UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = ANY($1)`,
			[]string{id, processing, paid}); err != nil {
			t.Fatal(err)
		}

		waitFor(t, 5*time.Second, "order.expired webhook", func() bool { return len(rcv.hooksFor(id)) > 0 })
		hook := rcv.hooksFor(id)[0]
		eq(t, hook.event(), "order.expired")
		eq(t, hook.order()["status"], any("EXPIRED"))
		waitFor(t, 5*time.Second, "expired PROCESSING order", func() bool { return len(rcv.hooksFor(processing)) > 0 })

		eq(t, srv.getOrder(id).str("status"), "EXPIRED")
		eq(t, srv.getOrder(processing).str("status"), "EXPIRED")
		eq(t, srv.getOrder(paid).str("status"), "APPROVED", "paid orders never expire")

		p := getPage(t, srv.URL+"/checkout/"+id)
		match(t, p.HTML, `Payment session expired`)
		back := getPage(t, srv.URL+"/checkout/"+id+"/return")
		match(t, back.Location, `&status=CANCELLED$`)

		timeline, _ := srv.App.Orders.Timeline(context.Background(), id)
		found := false
		for _, e := range timeline {
			found = found || (e.Type == "EXPIRED" && e.Message == "Not paid within 30 min — expired")
		}
		if !found {
			t.Fatalf("EXPIRED timeline event missing: %+v", timeline)
		}
	})

	t.Run("expires on access even before the scheduler runs", func(t *testing.T) {
		srv.App.Scheduler.Stop()
		defer srv.App.Scheduler.Start()
		id := srv.createOrder(rcv, nil)
		if _, err := srv.App.DB.Exec(context.Background(), `UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		p := getPage(t, srv.URL+"/checkout/"+id)
		eq(t, p.Status, 200)
		match(t, p.HTML, `Payment session expired`)
		hooks := rcv.hooksFor(id)
		if len(hooks) == 0 || hooks[0].event() != "order.expired" {
			t.Fatalf("hooks %v", hooks)
		}
	})

	t.Run("new orders expire 30 minutes after creation", func(t *testing.T) {
		id := srv.createOrder(rcv, nil)
		var mins float64
		if err := srv.App.DB.QueryRow(context.Background(), `SELECT extract(epoch FROM expires_at - created_at) / 60 FROM orders WHERE id = $1`, id).Scan(&mins); err != nil {
			t.Fatal(err)
		}
		if mins < 29.99 || mins > 30.01 {
			t.Fatalf("ttl %v min", mins)
		}
	})
}

func TestBankAdmin(t *testing.T) {
	srv := startTestServer(t, serverOpts{})
	rcv := startReceiver(t)
	auth := adminAuth("admin", "admin")

	t.Run("requires basic auth", func(t *testing.T) {
		res := getPage(t, srv.URL+"/admin/orders")
		eq(t, res.Status, 401)
		match(t, res.Header.Get("WWW-Authenticate"), `Basic`)
		eq(t, res.HTML, "Authentication required")
		wrong := getPage(t, srv.URL+"/admin/orders", adminAuth("admin", "nope"))
		eq(t, wrong.Status, 401)
		eq(t, postForm(t, srv.URL+"/admin/tokens/x/delete", map[string]string{}).Status, 401)
		root := getPage(t, srv.URL+"/admin", auth)
		eq(t, root.Status, 302)
		eq(t, root.Location, "/admin/orders")
	})

	t.Run("lists, filters and shows orders; resends webhooks; refunds; rejects missing CSRF", func(t *testing.T) {
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "4111111111111111", nil)
		other := srv.createOrder(rcv, nil)

		list := getPage(t, srv.URL+"/admin/orders?status=APPROVED", auth)
		eq(t, list.Status, 200)
		eq(t, list.Header.Get("X-Frame-Options"), "DENY")
		match(t, list.HTML, id)
		noMatch(t, list.HTML, other)
		match(t, list.HTML, `<option value="APPROVED" selected>APPROVED</option>`)
		search := getPage(t, srv.URL+"/admin/orders?q="+other[4:14], auth)
		match(t, search.HTML, other)
		byMerchant := getPage(t, srv.URL+"/admin/orders?merchant=other", auth)
		noMatch(t, byMerchant.HTML, id)
		match(t, byMerchant.HTML, `0 total`)

		detail := getPage(t, srv.URL+"/admin/orders/"+id, auth)
		eq(t, detail.Status, 200)
		match(t, detail.HTML, `Delivery attempts`)
		match(t, detail.HTML, `HTTP 200`)
		match(t, detail.HTML, `APPROVED`)
		match(t, detail.HTML, `CARD_SUBMITTED`)
		match(t, detail.HTML, `411111\*\*\*\*\*\*1111 · VISA`)
		match(t, detail.HTML, `&quot;orderId&quot;: &quot;`+id)
		csrf := regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindStringSubmatch(detail.HTML)[1]

		eq(t, postForm(t, srv.URL+"/admin/orders/"+id+"/resend", map[string]string{}, auth).Status, 403, "CSRF token required")

		before := len(rcv.all())
		resend := postForm(t, srv.URL+"/admin/orders/"+id+"/resend", map[string]string{"csrf": csrf}, auth)
		eq(t, resend.Status, 303)
		eq(t, resend.Location, "/admin/orders/"+id+"?kind=ok&msg=Webhook+re-sent+%E2%80%94+see+the+delivery+log+below.")
		all := rcv.all()
		eq(t, len(all), before+1)
		eq(t, all[len(all)-1].event(), "order.approved")

		refund := postForm(t, srv.URL+"/admin/orders/"+id+"/refund", map[string]string{"csrf": csrf, "amount": "5.00", "reason": "goodwill"}, auth)
		eq(t, refund.Status, 303)
		order := srv.getOrder(id)
		eq(t, order.str("status"), "PARTIALLY_REFUNDED")
		eq(t, order.num("refundedAmount"), float64(500))
		all = rcv.all()
		eq(t, all[len(all)-1].event(), "order.refunded")
		flash := getPage(t, srv.URL+refund.Location, auth)
		match(t, flash.HTML, `Refund done — order is now PARTIALLY_REFUNDED \(refunded 5\.00 ₼\)\.`)

		badAmount := postForm(t, srv.URL+"/admin/orders/"+id+"/refund", map[string]string{"csrf": csrf, "amount": "abc"}, auth)
		match(t, badAmount.Location, `kind=err&msg=Invalid\+amount\+%22abc%22$`)
		tooMuch := postForm(t, srv.URL+"/admin/orders/"+id+"/refund", map[string]string{"csrf": csrf, "amount": "100"}, auth)
		match(t, tooMuch.Location, `kind=err&msg=Refund\+amount\+10000\+exceeds`)
		nothing := postForm(t, srv.URL+"/admin/orders/"+other+"/resend", map[string]string{"csrf": csrf}, auth)
		match(t, nothing.Location, `kind=err&msg=Order\+has\+no\+final\+status`)

		missing := getPage(t, srv.URL+"/admin/orders/ord_nope", auth)
		eq(t, missing.Status, 404)
		match(t, missing.HTML, `Order not found`)

		merchants := getPage(t, srv.URL+"/admin/merchants", auth)
		match(t, merchants.HTML, `Other Shop`)
		match(t, merchants.HTML, `test••••••et`)
		noMatch(t, merchants.HTML, `test-secret`, "secrets are masked")
	})

	t.Run("deletes saved cards", func(t *testing.T) {
		id := srv.createOrder(rcv, map[string]any{"saveCard": true})
		srv.submitCard(id, "4111111111111111", map[string]string{"saveCard": "1"})
		token := srv.getOrder(id).JSON["card"].(map[string]any)["token"].(string)
		p := getPage(t, srv.URL+"/admin/tokens?q="+token[4:12], auth)
		match(t, p.HTML, token)
		csrf := regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindStringSubmatch(p.HTML)[1]
		del := postForm(t, srv.URL+"/admin/tokens/"+token+"/delete", map[string]string{"csrf": csrf}, auth)
		eq(t, del.Status, 303)
		eq(t, del.Location, "/admin/tokens?kind=ok&msg=Deleted+"+token)
		again := postForm(t, srv.URL+"/admin/tokens/"+token+"/delete", map[string]string{"csrf": csrf}, auth)
		eq(t, again.Location, "/admin/tokens?kind=err&msg=Token+not+found")
	})
}
