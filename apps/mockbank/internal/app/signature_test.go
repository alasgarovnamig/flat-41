package app

import (
	"net/http"
	"testing"
	"time"
)

func TestMerchantRequestSignatures(t *testing.T) {
	srv := startTestServer(t, serverOpts{})
	orderID := srv.createOrder(nil, nil)

	t.Run("accepts a correctly signed GET (empty raw body) and POST", func(t *testing.T) {
		get := srv.getOrder(orderID)
		eq(t, get.Status, 200)
		eq(t, get.str("orderId"), orderID)
		post := srv.api("POST", "/orders", srv.orderBody(nil, nil))
		eq(t, post.Status, 201)
	})

	t.Run("rejects a bad signature with 401 INVALID_SIGNATURE", func(t *testing.T) {
		wrong := srv.api("GET", "/orders/"+orderID, nil, apiOpts{secret: "nope"})
		eq(t, wrong.Status, 401)
		eq(t, wrong.str("error"), "INVALID_SIGNATURE")

		tampered := srv.api("POST", "/orders", srv.orderBody(nil, nil), apiOpts{tamper: true})
		eq(t, tampered.Status, 401)
		eq(t, tampered.str("error"), "INVALID_SIGNATURE")
	})

	t.Run("rejects unknown merchants and missing headers", func(t *testing.T) {
		unknown := srv.api("GET", "/orders/"+orderID, nil, apiOpts{merchantID: "ghost"})
		eq(t, unknown.Status, 401)
		eq(t, unknown.str("error"), "INVALID_SIGNATURE")

		res := getPage(t, srv.URL+"/api/v1/orders/"+orderID)
		eq(t, res.Status, 401)
		eq(t, res.HTML, `{"error":"INVALID_SIGNATURE","message":"Invalid merchant signature"}`)
		eq(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")

		// Unknown endpoints are only revealed to signed requests.
		eq(t, getPage(t, srv.URL+"/api/v1/nope").Status, 401)
		nope := srv.api("GET", "/nope", nil)
		eq(t, nope.Status, 404)
		eq(t, nope.str("error"), "NOT_FOUND")
	})

	t.Run("rejects timestamps older than 5 minutes (and accepts slightly old ones)", func(t *testing.T) {
		expired := srv.api("GET", "/orders/"+orderID, nil, apiOpts{timestamp: time.Now().Add(-5*time.Minute - 5*time.Second)})
		eq(t, expired.Status, 401)
		eq(t, expired.str("error"), "INVALID_SIGNATURE")
		future := srv.api("GET", "/orders/"+orderID, nil, apiOpts{timestamp: time.Now().Add(5*time.Minute + 5*time.Second)})
		eq(t, future.Status, 401)

		fresh := srv.api("GET", "/orders/"+orderID, nil, apiOpts{timestamp: time.Now().Add(-4 * time.Minute)})
		eq(t, fresh.Status, 200)
	})

	t.Run("accepts an uppercase hex signature", func(t *testing.T) {
		req, _ := http.NewRequest("GET", srv.URL+"/api/v1/orders/"+orderID, nil)
		ts := time.Now()
		setSigned(req, ts, true)
		eq(t, do(t, req).Status, 200)
	})

	t.Run("does not expose another merchant's orders", func(t *testing.T) {
		res := srv.api("GET", "/orders/"+orderID, nil, apiOpts{merchantID: "other", secret: "other-secret"})
		eq(t, res.Status, 404)
		eq(t, res.str("error"), "ORDER_NOT_FOUND")
	})

	t.Run("signed but malformed JSON → 400 VALIDATION_ERROR", func(t *testing.T) {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1/orders", stringsReader("{nope"))
		signRaw(req, "{nope")
		res := do(t, req)
		eq(t, res.Status, 400)
		eq(t, res.HTML, `{"error":"VALIDATION_ERROR","message":"body must be valid JSON","details":["body must be valid JSON"]}`)
	})
}
