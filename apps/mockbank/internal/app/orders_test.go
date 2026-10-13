package app

import (
	"encoding/json"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"sync"
	"testing"
	"time"
)

func TestMerchantAPIOrders(t *testing.T) {
	srv := startTestServer(t, serverOpts{})
	rcv := startReceiver(t)

	t.Run("creates an order (201 { orderId, status, paymentUrl, expiresAt })", func(t *testing.T) {
		body := srv.orderBody(rcv, nil)
		res := srv.api("POST", "/orders", body)
		eq(t, res.Status, 201)
		match(t, res.str("orderId"), `^ord_[0-9a-f]{24}$`)
		eq(t, res.str("status"), "CREATED")
		eq(t, res.str("paymentUrl"), srv.URL+"/checkout/"+res.str("orderId"))
		exp, err := time.Parse(time.RFC3339Nano, res.str("expiresAt"))
		if err != nil {
			t.Fatal(err)
		}
		match(t, res.str("expiresAt"), `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`)
		ttl := time.Until(exp)
		if ttl <= 29*time.Minute || ttl > 30*time.Minute {
			t.Fatalf("expiresAt ~30 min ahead (got %s)", ttl)
		}
		keys := make([]string, 0)
		for k := range res.JSON {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		eq(t, len(keys), 4)
		if !reflect.DeepEqual(keys, []string{"expiresAt", "orderId", "paymentUrl", "status"}) {
			t.Fatalf("keys %v", keys)
		}
		// exact field order of the create response
		match(t, res.Raw, `^\{"orderId":"ord_[0-9a-f]+","status":"CREATED","paymentUrl":"[^"]+","expiresAt":"[^"]+"\}$`)

		get := srv.getOrder(res.str("orderId"))
		eq(t, get.Status, 200)
		want := map[string]any{
			"orderId":         res.str("orderId"),
			"merchantOrderId": body["merchantOrderId"],
			"amount":          float64(1500),
			"currency":        "AZN",
			"description":     "VIP (7 gün)",
			"status":          "CREATED",
			"refundedAmount":  float64(0),
			"card":            nil,
			"declineCode":     nil,
			"declineReason":   nil,
			"rrn":             nil,
			"approvalCode":    nil,
			"refunds":         []any{},
			"createdAt":       get.JSON["createdAt"],
			"updatedAt":       get.JSON["updatedAt"],
			"paidAt":          nil,
			"expiresAt":       res.str("expiresAt"),
		}
		if !reflect.DeepEqual(get.JSON, want) {
			t.Fatalf("order JSON\n got %#v\nwant %#v", get.JSON, want)
		}
		// Field order and formatting are byte-compatible with the Node implementation.
		match(t, get.Raw, `^\{"orderId":"ord_[0-9a-f]+","merchantOrderId":"[^"]+","amount":1500,"currency":"AZN","description":"VIP \(7 gün\)","status":"CREATED","refundedAmount":0,"card":null,"declineCode":null,"declineReason":null,"rrn":null,"approvalCode":null,"refunds":\[\],"createdAt":"[^"]+Z","updatedAt":"[^"]+Z","paidAt":null,"expiresAt":"[^"]+Z"\}$`)
	})

	t.Run("is idempotent on merchantOrderId", func(t *testing.T) {
		body := srv.orderBody(rcv, nil)
		first := srv.api("POST", "/orders", body)
		changed := map[string]any{}
		for k, v := range body {
			changed[k] = v
		}
		changed["amount"] = 999
		second := srv.api("POST", "/orders", changed)
		eq(t, first.Status, 201)
		eq(t, second.Status, 201)
		eq(t, second.str("orderId"), first.str("orderId"))
		var wg sync.WaitGroup
		results := make([]apiResult, 3)
		for i := range results {
			wg.Add(1)
			go func(i int) { defer wg.Done(); results[i] = srv.api("POST", "/orders", body) }(i)
		}
		wg.Wait()
		for _, p := range results {
			eq(t, p.str("orderId"), first.str("orderId"))
		}
		get := srv.getOrder(first.str("orderId"))
		eq(t, get.num("amount"), float64(1500), "the original order is returned unchanged")

		// Concurrent first-time creation also yields a single order.
		fresh := srv.orderBody(rcv, nil)
		racing := make([]apiResult, 4)
		for i := range racing {
			wg.Add(1)
			go func(i int) { defer wg.Done(); racing[i] = srv.api("POST", "/orders", fresh) }(i)
		}
		wg.Wait()
		ids := map[string]bool{}
		for _, r := range racing {
			eq(t, r.Status, 201)
			ids[r.str("orderId")] = true
		}
		eq(t, len(ids), 1)
	})

	t.Run("validates input", func(t *testing.T) {
		cases := []map[string]any{
			{"amount": 0},
			{"amount": -5},
			{"amount": 10.5},
			{"amount": "1500"},
			{"amount": nil},
			{"currency": "RUB"},
			{"returnUrl": "not a url"},
			{"returnUrl": "javascript:alert(1)"},
			{"callbackUrl": "ftp://example.com/x"},
			{"callbackUrl": "evtap://payment/result"},
			{"merchantOrderId": ""},
			{"merchantOrderId": "   "},
			{"language": "de"},
			{"saveCard": "yes"},
			{"customer": "u1"},
			{"description": 42},
		}
		for _, extra := range cases {
			res := srv.api("POST", "/orders", srv.orderBody(rcv, extra))
			eq(t, res.Status, 400, extra)
			eq(t, res.str("error"), "VALIDATION_ERROR", extra)
		}
		for _, raw := range []any{[]any{1}, "x", 5} {
			res := srv.api("POST", "/orders", raw)
			eq(t, res.Status, 400)
			eq(t, res.str("message"), "body must be a JSON object")
		}
		empty := srv.api("POST", "/orders", nil)
		eq(t, empty.Status, 400)
		eq(t, empty.str("message"), "body must be a JSON object")

		multi := srv.api("POST", "/orders", map[string]any{"amount": 0})
		eq(t, multi.str("message"), "amount must be a positive integer (minor units); currency must be one of AZN, USD, EUR, GEL; merchantOrderId is required; returnUrl must be a valid absolute URL; callbackUrl must be a valid http(s) URL")
		details, _ := multi.JSON["details"].([]any)
		eq(t, len(details), 5)

		ok := srv.api("POST", "/orders", srv.orderBody(rcv, map[string]any{"returnUrl": "evtap://payment/result", "currency": "GEL", "saveCard": true, "amount": 1500.0}))
		eq(t, ok.Status, 201)
	})

	t.Run("returns 404 for unknown orders", func(t *testing.T) {
		res := srv.api("GET", "/orders/ord_doesnotexist", nil)
		eq(t, res.Status, 404)
		eq(t, res.Raw, `{"error":"ORDER_NOT_FOUND","message":"Order not found"}`)
	})

	t.Run("cancels only CREATED orders and sends order.cancelled", func(t *testing.T) {
		id := srv.api("POST", "/orders", srv.orderBody(rcv, nil)).str("orderId")
		cancel := srv.api("POST", "/orders/"+id+"/cancel", nil)
		eq(t, cancel.Status, 200)
		eq(t, cancel.str("status"), "CANCELLED")

		again := srv.api("POST", "/orders/"+id+"/cancel", nil)
		eq(t, again.Status, 409)
		eq(t, again.str("error"), "NOT_CANCELLABLE")

		waitFor(t, 5*time.Second, "cancel webhook", func() bool { return len(rcv.hooksFor(id)) > 0 })
		hook := rcv.hooksFor(id)[0]
		eq(t, hook.event(), "order.cancelled")
		eq(t, hook.order()["status"], any("CANCELLED"))

		refund := srv.api("POST", "/orders/"+id+"/refund", map[string]any{})
		eq(t, refund.Status, 409)
	})

	t.Run("DELETE /tokens/:cardToken answers { ok: true }", func(t *testing.T) {
		res := srv.api("DELETE", "/tokens/tok_unknown", nil)
		eq(t, res.Status, 200)
		eq(t, res.Raw, `{"ok":true}`)
	})

	t.Run("GET /health", func(t *testing.T) {
		res := getPage(t, srv.URL+"/health")
		eq(t, res.Status, 200)
		var body map[string]any
		_ = json.Unmarshal([]byte(res.HTML), &body)
		eq(t, body["status"], any("ok"))
		eq(t, body["db"], any("ok"))
		match(t, res.HTML, `^\{"status":"ok","service":"mockbank","db":"ok","time":"[^"]+"\}$`)
	})

	t.Run("unknown routes → 404 NOT_FOUND, security headers", func(t *testing.T) {
		res := getPage(t, srv.URL+"/nope")
		eq(t, res.Status, 404)
		eq(t, res.HTML, `{"error":"NOT_FOUND"}`)
		eq(t, res.Header.Get("X-Content-Type-Options"), "nosniff")
		eq(t, res.Header.Get("Referrer-Policy"), "same-origin")
		head, _ := http.NewRequest(http.MethodHead, srv.URL+"/health/", nil)
		eq(t, do(t, head).Status, 200, "HEAD on GET routes, trailing slash ignored")
		root := getPage(t, srv.URL+"/")
		eq(t, root.HTML, `{"service":"mockbank","checkout":"/checkout/:orderId","admin":"/admin","health":"/health","api":"/api/v1"}`)
	})

	t.Run("never stores a PAN or CVV", func(t *testing.T) {
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "4111 1111 1111 1111", map[string]string{"cvv": "987"})
		var dump string
		err := srv.App.DB.QueryRow(t.Context(), `SELECT
			(SELECT coalesce(string_agg(o::text, ' '), '') FROM orders o) ||
			(SELECT coalesce(string_agg(e::text, ' '), '') FROM events e) ||
			(SELECT coalesce(string_agg(w::text, ' '), '') FROM webhooks w) ||
			(SELECT coalesce(string_agg(d::text, ' '), '') FROM webhook_deliveries d)`).Scan(&dump)
		if err != nil {
			t.Fatal(err)
		}
		noMatch(t, dump, `4111111111111111|4111 1111 1111 1111`)
		noMatch(t, dump, `[^0-9a-f]`+regexp.QuoteMeta(`987`)+`[^0-9a-f]`)
	})
}
