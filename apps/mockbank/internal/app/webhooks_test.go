package app

import (
	"context"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/sig"
)

func TestWebhookDeliveryAndRetries(t *testing.T) {
	srv := startTestServer(t, serverOpts{scale: 0.002}) // 5 s → 10 ms, 30 s → 60 ms, 2 min → 240 ms …
	rcv := startReceiver(t)

	t.Run("uses the documented back-off schedule (initial + 6 retries)", func(t *testing.T) {
		want := []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour, 6 * time.Hour}
		if !reflect.DeepEqual(RetryDelays, want) {
			t.Fatalf("RetryDelays = %v", RetryDelays)
		}
		eq(t, MaxAttempts, 7)
		eq(t, formatDelay(5000), "5 s")
		eq(t, formatDelay(120000), "2 min")
		eq(t, formatDelay(21600000), "6 h")
		eq(t, formatDelay(10), "10 ms")
	})

	t.Run("retries when the merchant answers 500 and logs every attempt", func(t *testing.T) {
		rcv.setRespond(func(_ received, i int) int {
			if i < 2 {
				return 500
			}
			return 200
		})
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "4111111111111111", nil)

		waitFor(t, 10*time.Second, "third delivery attempt", func() bool { return len(rcv.hooksFor(id)) >= 3 })
		hooks := rcv.hooksFor(id)
		for _, h := range hooks {
			// Each attempt is freshly signed and carries the same body.
			eq(t, h.Headers.Get("X-Signature"), sig.Sign(merchantSecret, h.Headers.Get("X-Timestamp"), h.Body))
			eq(t, h.Body, hooks[0].Body)
			eq(t, h.event(), "order.approved")
		}

		var whs []Webhook
		var ds []Delivery
		waitFor(t, 5*time.Second, "DELIVERED", func() bool {
			w, d, err := srv.App.Webhooks.ListForOrder(context.Background(), id)
			if err != nil {
				t.Fatal(err)
			}
			whs, ds = w, d
			return len(w) > 0 && w[0].Status == WebhookDelivered
		})
		eq(t, whs[0].Attempts, 3)
		got := make([][2]int, 0)
		for _, d := range ds {
			got = append(got, [2]int{d.Attempt, *d.ResponseStatus})
		}
		sort.Slice(got, func(i, j int) bool { return got[i][0] < got[j][0] })
		if !reflect.DeepEqual(got, [][2]int{{1, 500}, {2, 500}, {3, 200}}) {
			t.Fatalf("deliveries %v", got)
		}
		eq(t, *ds[0].ResponseBody, `{"ok":true}`)
		time.Sleep(150 * time.Millisecond)
		eq(t, len(rcv.hooksFor(id)), 3, "no further attempts after success")

		timeline, _ := srv.App.Orders.Timeline(context.Background(), id)
		types := map[string]int{}
		for _, e := range timeline {
			types[e.Type]++
		}
		eq(t, types["WEBHOOK_RETRY"], 2)
		eq(t, types["WEBHOOK_DELIVERED"], 1)
	})

	t.Run("logs network errors and gives up after the last retry", func(t *testing.T) {
		id := srv.createOrder(nil, map[string]any{"callbackUrl": "http://127.0.0.1:9/unreachable"})
		// Compress the schedule further for this case.
		srv.App.Webhooks.SetRetryScale(0.0000005)
		defer srv.App.Webhooks.SetRetryScale(0.002)
		srv.submitCard(id, "4111111111111111", nil)
		var whs []Webhook
		var ds []Delivery
		waitFor(t, 15*time.Second, "webhook to fail permanently", func() bool {
			w, d, err := srv.App.Webhooks.ListForOrder(context.Background(), id)
			if err != nil {
				t.Fatal(err)
			}
			whs, ds = w, d
			return len(w) > 0 && w[0].Status == WebhookFailed
		})
		eq(t, whs[0].Attempts, MaxAttempts)
		eq(t, len(ds), MaxAttempts)
		for _, d := range ds {
			if d.ResponseStatus != nil || d.Error == nil || *d.Error == "" {
				t.Fatalf("delivery %+v", d)
			}
		}
		timeline, _ := srv.App.Orders.Timeline(context.Background(), id)
		found := false
		for _, e := range timeline {
			found = found || e.Type == "WEBHOOK_FAILED"
		}
		if !found {
			t.Fatal("WEBHOOK_FAILED missing from timeline")
		}
	})

	t.Run("does not follow redirects (3xx is a failed attempt)", func(t *testing.T) {
		rcv.setRespond(func(received, int) int { return 302 })
		id := srv.createOrder(rcv, nil)
		srv.submitCard(id, "4111111111111111", nil)
		w, d, _ := srv.App.Webhooks.ListForOrder(context.Background(), id)
		eq(t, w[0].Status, WebhookPending)
		eq(t, *d[0].ResponseStatus, 302)
		rcv.setRespond(func(received, int) int { return 200 })
		waitFor(t, 5*time.Second, "retry", func() bool {
			w, _, _ := srv.App.Webhooks.ListForOrder(context.Background(), id)
			return w[0].Status == WebhookDelivered
		})
	})

	t.Run("pending retries survive a restart (DB-backed scheduler)", func(t *testing.T) {
		rcv.setRespond(func(received, int) int { return 503 })
		id := srv.createOrder(rcv, nil)
		srv.App.Webhooks.SetRetryScale(1) // next retry in 5 s
		srv.submitCard(id, "4111111111111111", nil)
		eq(t, len(rcv.hooksFor(id)), 1)

		// Real restart on the same database; meanwhile the retry became due.
		schema, dbURL := srv.Schema, srv.DBURL
		srv.Close()
		pool, err := pgxpool.New(context.Background(), dbURL)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(context.Background(), `UPDATE webhooks SET next_attempt_at = now() WHERE order_id = $1`, id); err != nil {
			t.Fatal(err)
		}
		pool.Close()
		rcv.setRespond(func(received, int) int { return 200 })
		srv2 := startTestServer(t, serverOpts{scale: 0.002, schema: schema})

		waitFor(t, 5*time.Second, "retry after restart", func() bool { return len(rcv.hooksFor(id)) == 2 })
		var whs []Webhook
		waitFor(t, 5*time.Second, "DELIVERED", func() bool {
			w, _, _ := srv2.App.Webhooks.ListForOrder(context.Background(), id)
			whs = w
			return len(w) > 0 && w[0].Status == WebhookDelivered
		})
		eq(t, whs[0].Attempts, 2)
	})
}
