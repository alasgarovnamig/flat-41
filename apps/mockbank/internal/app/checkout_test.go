package app

import (
	"fmt"
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/alasgarovnamig/evtap/mockbank/internal/sig"
)

func TestHostedCheckout(t *testing.T) {
	srv := startTestServer(t, serverOpts{})
	rcv := startReceiver(t)
	reset := func() { rcv.setRespond(func(received, int) int { return 200 }) }

	t.Run("renders the card form with merchant, amount, test cards and localisation", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, map[string]any{"language": "az", "saveCard": true})
		p := getPage(t, srv.URL+"/checkout/"+id)
		eq(t, p.Status, 200)
		eq(t, p.Header.Get("Content-Type"), "text/html; charset=utf-8")
		eq(t, p.Header.Get("Cache-Control"), "no-store")
		match(t, p.HTML, `<html lang="az">`)
		match(t, p.HTML, `EvTap`)
		match(t, p.HTML, `15\.00 ₼`)
		match(t, p.HTML, `Kartın nömrəsi`)
		match(t, p.HTML, `name="saveCard"`)
		match(t, p.HTML, `4111 1111 1111 1111`, "test-cards table shown outside production")
		match(t, p.HTML, `TEST REJİMİ`)
		match(t, p.HTML, `<script type="application/json" id="i18n">\{"numberInvalid":`)
		match(t, p.HTML, `function luhn\(p\)\{if\(!/\^\\d\{12,19\}\$/\.test\(p\)\)`)

		ru := getPage(t, srv.URL+"/checkout/"+id+"?lang=ru")
		match(t, ru.HTML, `Номер карты`)
		match(t, ru.HTML, `action="/checkout/[^"]+/pay\?lang=ru"`)
		match(t, ru.HTML, `<a href="/checkout/`+id+`\?lang=ru" class="on" hreflang="ru">RU</a>`)
		en := getPage(t, srv.URL+"/checkout/"+id+"?lang=en")
		match(t, en.HTML, `Card number`)
		match(t, en.HTML, `Pay 15\.00 ₼`)

		noSave := srv.createOrder(rcv, map[string]any{"language": "ru"})
		p2 := getPage(t, srv.URL+"/checkout/"+noSave)
		noMatch(t, p2.HTML, `name="saveCard"`)
		match(t, p2.HTML, `Номер карты`)

		missing := getPage(t, srv.URL+"/checkout/ord_nope")
		eq(t, missing.Status, 404)
		match(t, missing.HTML, `Ödəniş tapılmadı`)
	})

	t.Run("hides the test cards in production", func(t *testing.T) {
		prod := startTestServer(t, serverOpts{isProd: true})
		id := prod.createOrder(nil, nil)
		p := getPage(t, prod.URL+"/checkout/"+id)
		eq(t, p.Status, 200)
		noMatch(t, p.HTML, `4111 1111 1111 1111`)
		noMatch(t, p.HTML, `TEST MODE`)
		prod.submitCard(id, "5555555555554444", nil)
		acs := getPage(t, prod.URL+"/checkout/"+id+"/3ds")
		noMatch(t, acs.HTML, `Test OTP`)
	})

	t.Run("approves 4111… frictionless, sends a signed webhook, then redirects to returnUrl", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		res := srv.submitCard(id, "4111 1111 1111 1111", nil)
		eq(t, res.Status, 303)
		eq(t, res.Location, "/checkout/"+id)

		// The webhook is POSTed before the browser is sent back.
		hooks := rcv.hooksFor(id)
		if len(hooks) != 1 {
			t.Fatalf("webhook delivered before the redirect, got %d", len(hooks))
		}
		hook := hooks[0]
		eq(t, hook.event(), "order.approved")
		eq(t, hook.Headers.Get("X-Merchant-Id"), merchantID)
		eq(t, hook.Headers.Get("Content-Type"), "application/json")
		eq(t, hook.Headers.Get("User-Agent"), "MockBank-Webhooks/1.0")
		ts := hook.Headers.Get("X-Timestamp")
		tsMS, _ := strconv.ParseInt(ts, 10, 64)
		if math.Abs(float64(time.Now().UnixMilli()-tsMS)) >= 60_000 {
			t.Fatalf("timestamp %s", ts)
		}
		eq(t, hook.Headers.Get("X-Signature"), sig.Sign(merchantSecret, ts, hook.Body))
		match(t, hook.Body, `^\{"event":"order\.approved","order":\{"orderId":"`+id+`",`)
		order := hook.order()
		eq(t, order["status"], any("APPROVED"))
		card := order["card"].(map[string]any)
		eq(t, card["mask"], any("411111******1111"))
		eq(t, card["brand"], any("VISA"))
		eq(t, card["token"], nil)
		match(t, order["rrn"].(string), `^\d{12}$`)
		match(t, order["approvalCode"].(string), `^[A-Z0-9]{6}$`)
		if order["paidAt"] == nil {
			t.Fatal("paidAt missing")
		}

		result := getPage(t, srv.URL+"/checkout/"+id)
		eq(t, result.Status, 200)
		match(t, result.HTML, `Payment successful`)
		match(t, result.HTML, `http-equiv="refresh" content="3;url=/checkout/`+id+`/return"`)
		match(t, result.HTML, `href="/checkout/`+id+`/return"`)

		back := getPage(t, srv.URL+"/checkout/"+id+"/return")
		eq(t, back.Status, 302)
		eq(t, back.Location, fmt.Sprintf("https://evtap.test/api/v1/payments/return/mockbank?paymentId=p1&orderId=%s&merchantOrderId=%s&status=APPROVED", id, order["merchantOrderId"]))

		eq(t, srv.getOrder(id).str("status"), "APPROVED")

		// The page can't be paid twice.
		again := postForm(t, srv.URL+"/checkout/"+id+"/pay", map[string]string{"nonce": "x", "number": "4111111111111111"})
		eq(t, again.Status, 303)
		eq(t, len(rcv.hooksFor(id)), 1)
	})

	t.Run(`approves 4242… frictionless and uses "?" when returnUrl has no query`, func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, map[string]any{"returnUrl": "https://shop.test/done"})
		srv.submitCard(id, "4242424242424242", nil)
		back := getPage(t, srv.URL+"/checkout/"+id+"/return")
		match(t, back.Location, `^https://shop\.test/done\?orderId=ord_[0-9a-f]+&merchantOrderId=[^&]+&status=APPROVED$`)
	})

	t.Run("keeps the fragment and encodes merchantOrderId like URLSearchParams", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, map[string]any{"returnUrl": "evtap://payment/result#top", "merchantOrderId": "a b*~é/" + uuid()[:8]})
		srv.submitCard(id, "4111111111111111", nil)
		back := getPage(t, srv.URL+"/checkout/"+id+"/return")
		match(t, back.Location, `^evtap://payment/result\?orderId=ord_[0-9a-f]+&merchantOrderId=a\+b\*%7E%C3%A9%2F[0-9a-f]{8}&status=APPROVED#top$`)
	})

	t.Run("runs 3-D Secure for 5555… and approves with OTP 111111, saving the card when asked", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, map[string]any{"saveCard": true, "customer": map[string]any{"id": "u1", "phone": "+994501234567"}})
		res := srv.submitCard(id, "5555555555554444", map[string]string{"saveCard": "1"})
		eq(t, res.Status, 303)
		eq(t, res.Location, "/checkout/"+id+"/3ds")

		mid := srv.getOrder(id)
		eq(t, mid.str("status"), "PROCESSING")
		eq(t, len(rcv.hooksFor(id)), 0)

		// The card page now forwards to the ACS page.
		fwd := getPage(t, srv.URL+"/checkout/"+id)
		eq(t, fwd.Status, 303)
		eq(t, fwd.Location, "/checkout/"+id+"/3ds")

		acs := getPage(t, srv.URL+"/checkout/"+id+"/3ds")
		match(t, acs.HTML, `Mock Bank 3-D Secure`)
		match(t, acs.HTML, `Test OTP: 111111`)
		match(t, acs.HTML, `\+994 \*\* \*\*\* 45 67`)
		match(t, acs.HTML, `5555 55\*\* \*\*\*\* 4444`)

		resend := postForm(t, srv.URL+"/checkout/"+id+"/3ds/resend", map[string]string{"nonce": extractNonce(t, acs.HTML)})
		eq(t, resend.Status, 200)
		match(t, resend.HTML, `A new code has been sent to your phone\.`)

		ok := srv.submitOTP(id, "111111")
		eq(t, ok.Status, 303)
		eq(t, ok.Location, "/checkout/"+id)
		order := srv.getOrder(id)
		eq(t, order.str("status"), "APPROVED")
		card := order.JSON["card"].(map[string]any)
		eq(t, card["brand"], any("MASTERCARD"))
		eq(t, card["mask"], any("555555******4444"))
		match(t, card["token"].(string), `^tok_[0-9a-f]{32}$`)
		hooks := rcv.hooksFor(id)
		eq(t, len(hooks), 1)
		eq(t, hooks[0].event(), "order.approved")
		eq(t, hooks[0].order()["card"].(map[string]any)["token"], card["token"])

		var customerID string
		if err := srv.App.DB.QueryRow(t.Context(), `SELECT customer_id FROM card_tokens WHERE token = $1`, card["token"]).Scan(&customerID); err != nil {
			t.Fatal(err)
		}
		eq(t, customerID, "u1")
	})

	t.Run("does not save the card when the customer unticks the box", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, map[string]any{"saveCard": true})
		srv.submitCard(id, "4111111111111111", nil)
		order := srv.getOrder(id)
		eq(t, order.str("status"), "APPROVED")
		eq(t, order.JSON["card"].(map[string]any)["token"], nil)
	})

	t.Run("ignores saveCard when the merchant did not offer it", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "4111111111111111", map[string]string{"saveCard": "1"})
		eq(t, srv.getOrder(id).JSON["card"].(map[string]any)["token"], nil)
	})

	t.Run("sends unknown Luhn-valid cards through 3-D Secure (4000…3220 too)", func(t *testing.T) {
		reset()
		for _, pan := range []string{"4000000000003220", "4012888888881881"} {
			id := srv.createOrder(rcv, nil)
			res := srv.submitCard(id, pan, nil)
			eq(t, res.Location, "/checkout/"+id+"/3ds", pan)
			srv.submitOTP(id, "111111")
			eq(t, srv.getOrder(id).str("status"), "APPROVED", pan)
		}
	})

	t.Run("declines the decline test cards with the right codes", func(t *testing.T) {
		reset()
		cases := []struct{ pan, code, reason string }{
			{"4000000000000002", "DO_NOT_HONOR", "Do not honor"},
			{"4000000000009995", "INSUFFICIENT_FUNDS", "Insufficient funds"},
			{"4000000000000069", "EXPIRED_CARD", "Expired card"},
			{"4000000000000119", "PROCESSING_ERROR", "Processing error, please try again later"},
		}
		for _, c := range cases {
			id := srv.createOrder(rcv, nil)
			res := srv.submitCard(id, c.pan, nil)
			eq(t, res.Location, "/checkout/"+id)
			order := srv.getOrder(id)
			eq(t, order.str("status"), "DECLINED", c.pan)
			eq(t, order.str("declineCode"), c.code, c.pan)
			eq(t, order.str("declineReason"), c.reason, c.pan)
			eq(t, order.JSON["rrn"], nil)
			hooks := rcv.hooksFor(id)
			eq(t, len(hooks), 1)
			eq(t, hooks[0].event(), "order.declined")
			eq(t, hooks[0].order()["declineCode"], any(c.code))

			p := getPage(t, srv.URL+"/checkout/"+id)
			match(t, p.HTML, `Payment declined`)
			back := getPage(t, srv.URL+"/checkout/"+id+"/return")
			match(t, back.Location, `&status=DECLINED$`)
		}
	})

	t.Run("declines with 3DS_FAILED after 3 wrong OTPs", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "5555555555554444", nil)
		first := srv.submitOTP(id, "000000")
		eq(t, first.Status, 422)
		match(t, first.HTML, `Attempts left: 2`)
		second := srv.submitOTP(id, "123456")
		match(t, second.HTML, `Attempts left: 1`)
		eq(t, len(rcv.hooksFor(id)), 0)
		third := srv.submitOTP(id, "999999")
		eq(t, third.Status, 303)
		order := srv.getOrder(id)
		eq(t, order.str("status"), "DECLINED")
		eq(t, order.str("declineCode"), "3DS_FAILED")
		eq(t, order.str("declineReason"), "3-D Secure authentication failed")
		eq(t, rcv.hooksFor(id)[0].event(), "order.declined")
		result := getPage(t, srv.URL+"/checkout/"+id)
		match(t, result.HTML, `3-D Secure authentication failed\.`)
	})

	t.Run("re-renders the form for invalid input instead of declining", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		bad := srv.submitCard(id, "4111111111111112", map[string]string{"expiry": "01/20", "cvv": "12", "holder": ""})
		eq(t, bad.Status, 422)
		match(t, bad.HTML, `Enter a valid card number`)
		match(t, bad.HTML, `This card has expired`)
		match(t, bad.HTML, `Enter the 3-digit security code`)
		match(t, bad.HTML, `Enter the name as shown on the card`)
		match(t, bad.HTML, `Please check the highlighted fields\.`)
		match(t, bad.HTML, `value="4111111111111112"`)
		noMatch(t, bad.HTML, `name="cvv"[^>]*value=`, "CVV is never echoed back")
		order := srv.getOrder(id)
		eq(t, order.str("status"), "CREATED")
		eq(t, order.JSON["card"], nil)
	})

	t.Run("rejects a form post with a wrong nonce", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		res := postForm(t, srv.URL+"/checkout/"+id+"/pay", map[string]string{
			"nonce": "forged", "number": "4111111111111111", "expiry": "12/40", "cvv": "123", "holder": "A B",
		})
		eq(t, res.Status, 403)
		match(t, res.HTML, `This form is out of date`)
		eq(t, srv.getOrder(id).str("status"), "CREATED")
	})

	t.Run("Cancel button → CANCELLED, webhook, 302 back with status=CANCELLED", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		p := getPage(t, srv.URL+"/checkout/"+id)
		res := postForm(t, srv.URL+"/checkout/"+id+"/cancel", map[string]string{"nonce": extractNonce(t, p.HTML)})
		eq(t, res.Status, 302)
		match(t, res.Location, `^https://evtap\.test/.*\?paymentId=p1&orderId=ord_\w+&merchantOrderId=.+&status=CANCELLED$`)
		hooks := rcv.hooksFor(id)
		eq(t, len(hooks), 1, "webhook sent before the redirect")
		eq(t, hooks[0].event(), "order.cancelled")
	})

	t.Run("cancelling the 3-D Secure step declines with 3DS_FAILED", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "5555555555554444", nil)
		acs := getPage(t, srv.URL+"/checkout/"+id+"/3ds")
		res := postForm(t, srv.URL+"/checkout/"+id+"/3ds/cancel", map[string]string{"nonce": extractNonce(t, acs.HTML)})
		eq(t, res.Status, 303)
		order := srv.getOrder(id)
		eq(t, order.str("status"), "DECLINED")
		eq(t, order.str("declineCode"), "3DS_FAILED")
		eq(t, order.str("declineReason"), "Authentication cancelled by cardholder")
	})

	t.Run("keeps ?lang= across posts and redirects", func(t *testing.T) {
		reset()
		id := srv.createOrder(rcv, nil)
		p := getPage(t, srv.URL+"/checkout/"+id+"?lang=az")
		res := postForm(t, srv.URL+"/checkout/"+id+"/pay?lang=az", map[string]string{
			"nonce": extractNonce(t, p.HTML), "number": "5555555555554444", "expiry": futureExpiry(), "cvv": "123", "holder": "Ali Veli",
		})
		eq(t, res.Location, "/checkout/"+id+"/3ds?lang=az")
		acs := getPage(t, srv.URL+res.Location)
		match(t, acs.HTML, `Alışın təsdiqi`)
		match(t, acs.HTML, `action="/checkout/`+id+`/3ds\?lang=az"`)
		wrong := postForm(t, srv.URL+"/checkout/"+id+"/3ds?lang=ru", map[string]string{"nonce": extractNonce(t, acs.HTML), "otp": "1"})
		match(t, wrong.HTML, `Неверный пароль\. Осталось попыток: 2`)
	})

	t.Run("checkout JSON-only orders (charge-token) are not browsable", func(t *testing.T) {
		p := getPage(t, srv.URL+"/checkout/")
		eq(t, p.Status, 404)
	})
}
