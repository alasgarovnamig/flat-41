package app

import (
	"reflect"
	"regexp"
	"sort"
	"testing"
	"time"
)

func TestRefundsAndSavedCardCharges(t *testing.T) {
	srv := startTestServer(t, serverOpts{})
	rcv := startReceiver(t)

	paidOrder := func(extra map[string]any) string {
		id := srv.createOrder(rcv, extra)
		fields := map[string]string{}
		if extra["saveCard"] == true {
			fields["saveCard"] = "1"
		}
		srv.submitCard(id, "4111111111111111", fields)
		return id
	}

	t.Run("refunds partially, then the remainder, then refuses with 409", func(t *testing.T) {
		id := paidOrder(nil)

		notPaid := srv.createOrder(rcv, nil)
		eq(t, srv.api("POST", "/orders/"+notPaid+"/refund", map[string]any{}).Status, 409)

		partial := srv.api("POST", "/orders/"+id+"/refund", map[string]any{"amount": 500, "reason": "partial"})
		eq(t, partial.Status, 200)
		eq(t, partial.str("status"), "PARTIALLY_REFUNDED")
		eq(t, partial.num("refundedAmount"), float64(500))
		refunds := partial.JSON["refunds"].([]any)
		eq(t, len(refunds), 1)
		r0 := refunds[0].(map[string]any)
		match(t, r0["id"].(string), `^rf_[0-9a-f]{24}$`)
		eq(t, r0["amount"], any(float64(500)))
		eq(t, r0["reason"], any("partial"))
		match(t, partial.Raw, `"refunds":\[\{"id":"rf_[0-9a-f]+","amount":500,"reason":"partial","createdAt":"[^"]+Z"\}\]`)

		tooMuch := srv.api("POST", "/orders/"+id+"/refund", map[string]any{"amount": 1001})
		eq(t, tooMuch.Status, 409)
		eq(t, tooMuch.str("message"), "Refund amount 1001 exceeds the refundable remainder 1000")
		invalid := srv.api("POST", "/orders/"+id+"/refund", map[string]any{"amount": -1})
		eq(t, invalid.Status, 400)

		rest := srv.api("POST", "/orders/"+id+"/refund", map[string]any{}) // default = remaining
		eq(t, rest.Status, 200)
		eq(t, rest.str("status"), "REFUNDED")
		eq(t, rest.num("refundedAmount"), float64(1500))
		var amounts []float64
		for _, r := range rest.JSON["refunds"].([]any) {
			amounts = append(amounts, r.(map[string]any)["amount"].(float64))
		}
		if !reflect.DeepEqual(amounts, []float64{500, 1000}) {
			t.Fatalf("refund amounts %v", amounts)
		}

		again := srv.api("POST", "/orders/"+id+"/refund", map[string]any{"amount": 1})
		eq(t, again.Status, 409)
		eq(t, again.str("error"), "NOT_REFUNDABLE")

		var events []string
		waitFor(t, 5*time.Second, "3 webhooks", func() bool {
			events = nil
			for _, h := range rcv.hooksFor(id) {
				events = append(events, h.event()+":"+h.order()["status"].(string))
			}
			return len(events) == 3
		})
		sort.Strings(events)
		if !reflect.DeepEqual(events, []string{"order.approved:APPROVED", "order.refunded:PARTIALLY_REFUNDED", "order.refunded:REFUNDED"}) {
			t.Fatalf("events %v", events)
		}
	})

	t.Run("full refund without amount on a fresh order", func(t *testing.T) {
		id := paidOrder(nil)
		res := srv.api("POST", "/orders/"+id+"/refund", nil)
		eq(t, res.Status, 200)
		eq(t, res.str("status"), "REFUNDED")
		eq(t, res.num("refundedAmount"), float64(1500))
		eq(t, res.JSON["refunds"].([]any)[0].(map[string]any)["reason"], nil)
		// The result page of a refunded order says so (no auto-redirect).
		p := getPage(t, srv.URL+"/checkout/"+id)
		match(t, p.HTML, `Payment refunded`)
		noMatch(t, p.HTML, `http-equiv="refresh"`)
	})

	t.Run("does not refund another merchant's order", func(t *testing.T) {
		id := paidOrder(nil)
		res := srv.api("POST", "/orders/"+id+"/refund", nil, apiOpts{merchantID: "other", secret: "other-secret"})
		eq(t, res.Status, 404)
	})

	t.Run("charges a saved card token (APPROVED), idempotently", func(t *testing.T) {
		id := paidOrder(map[string]any{"saveCard": true, "customer": map[string]any{"id": "user-1"}})
		token := srv.getOrder(id).JSON["card"].(map[string]any)["token"].(string)
		match(t, token, `^tok_`)

		moid := uuid()
		body := map[string]any{"amount": 2900, "currency": "AZN", "merchantOrderId": moid, "description": "Agency PRO renewal", "cardToken": token, "callbackUrl": rcv.URL}
		charge := srv.api("POST", "/orders/charge-token", body)
		eq(t, charge.Status, 200)
		eq(t, charge.str("status"), "APPROVED")
		eq(t, charge.num("amount"), float64(2900))
		eq(t, charge.str("merchantOrderId"), moid)
		card := charge.JSON["card"].(map[string]any)
		if !reflect.DeepEqual(card, map[string]any{"mask": "411111******1111", "brand": "VISA", "token": token}) {
			t.Fatalf("card %v", card)
		}
		match(t, charge.str("rrn"), `^\d{12}$`)
		if charge.JSON["paidAt"] == nil {
			t.Fatal("paidAt missing")
		}

		replay := srv.api("POST", "/orders/charge-token", body)
		eq(t, replay.str("orderId"), charge.str("orderId"))

		waitFor(t, 5*time.Second, "charge webhook", func() bool { return len(rcv.hooksFor(charge.str("orderId"))) > 0 })
		eq(t, rcv.hooksFor(charge.str("orderId"))[0].event(), "order.approved")

		// A token charge can be refunded like any other order.
		refund := srv.api("POST", "/orders/"+charge.str("orderId")+"/refund", map[string]any{"amount": 900})
		eq(t, refund.str("status"), "PARTIALLY_REFUNDED")

		// Token orders have no hosted page.
		eq(t, getPage(t, srv.URL+"/checkout/"+charge.str("orderId")).Status, 404)
	})

	t.Run("declines token charges with INSUFFICIENT_FUNDS when forced in the bank admin, TOKEN_INVALID when deleted", func(t *testing.T) {
		id := paidOrder(map[string]any{"saveCard": true})
		token := srv.getOrder(id).JSON["card"].(map[string]any)["token"].(string)

		// Toggle the flag through the admin UI (basic auth + CSRF token from the page).
		p := getPage(t, srv.URL+"/admin/tokens", adminAuth("admin", "admin"))
		eq(t, p.Status, 200)
		match(t, p.HTML, regexp.QuoteMeta(token))
		csrf := regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindStringSubmatch(p.HTML)[1]
		toggle := postForm(t, srv.URL+"/admin/tokens/"+token+"/insufficient", map[string]string{"csrf": csrf, "value": "1"}, adminAuth("admin", "admin"))
		eq(t, toggle.Status, 303)
		match(t, toggle.Location, `^/admin/tokens\?kind=ok&msg=Insufficient\+funds\+enabled\+for\+tok_`)
		after := getPage(t, srv.URL+toggle.Location, adminAuth("admin", "admin"))
		match(t, after.HTML, `ON — turn off`)
		match(t, after.HTML, `class="flash ok"`)

		declined := srv.api("POST", "/orders/charge-token", map[string]any{
			"amount": 2900, "currency": "AZN", "merchantOrderId": uuid(), "description": "renewal", "cardToken": token,
		})
		eq(t, declined.Status, 200)
		eq(t, declined.str("status"), "DECLINED")
		eq(t, declined.str("declineCode"), "INSUFFICIENT_FUNDS")
		eq(t, declined.JSON["rrn"], nil)
		eq(t, declined.JSON["paidAt"], nil)

		del := srv.api("DELETE", "/tokens/"+token, nil)
		eq(t, del.Raw, `{"ok":true}`)
		invalid := srv.api("POST", "/orders/charge-token", map[string]any{
			"amount": 2900, "currency": "AZN", "merchantOrderId": uuid(), "description": "renewal", "cardToken": token,
		})
		eq(t, invalid.str("status"), "DECLINED")
		eq(t, invalid.str("declineCode"), "TOKEN_INVALID")
		eq(t, invalid.str("declineReason"), "Card token is invalid or has been deleted")
		eq(t, invalid.JSON["card"], nil)
	})

	t.Run("does not let a merchant charge another merchant's token", func(t *testing.T) {
		id := srv.createOrder(rcv, map[string]any{"saveCard": true})
		srv.submitCard(id, "5555555555554444", map[string]string{"saveCard": "1"})
		srv.submitOTP(id, "111111")
		token := srv.getOrder(id).JSON["card"].(map[string]any)["token"].(string)
		res := srv.api("POST", "/orders/charge-token",
			map[string]any{"amount": 100, "currency": "USD", "merchantOrderId": "x-1", "description": "x", "cardToken": token},
			apiOpts{merchantID: "other", secret: "other-secret"})
		eq(t, res.str("declineCode"), "TOKEN_INVALID")
		// …and the other merchant cannot delete it either.
		srv.api("DELETE", "/tokens/"+token, nil, apiOpts{merchantID: "other", secret: "other-secret"})
		again := srv.api("POST", "/orders/charge-token",
			map[string]any{"amount": 100, "currency": "USD", "merchantOrderId": uuid(), "cardToken": token})
		eq(t, again.str("status"), "APPROVED")
	})

	t.Run("validates charge-token input", func(t *testing.T) {
		res := srv.api("POST", "/orders/charge-token", map[string]any{"amount": 1, "currency": "AZN", "merchantOrderId": uuid()})
		eq(t, res.Status, 400)
		eq(t, res.str("message"), "cardToken is required")
		bad := srv.api("POST", "/orders/charge-token", map[string]any{"amount": 1, "currency": "AZN", "merchantOrderId": uuid(), "cardToken": "t", "callbackUrl": "nope"})
		eq(t, bad.str("message"), "callbackUrl must be a valid http(s) URL")
	})
}
