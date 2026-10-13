// Package payments — payment engine, checkout, bank webhooks / returns and admin payment endpoints (money workstream).
//
//	POST /checkout                       [auth]   body CheckoutInput → CheckoutResponse (201)
//	GET  /payments                       [auth]   query pagination → Paginated<Payment>
//	GET  /payments/:id                   [auth]   → Payment
//	POST /payments/webhook/:provider     [bank]   signed callback (X-Signature HMAC-SHA256 over `${ts}.${rawBody}`) → { ok: true }
//	GET  /payments/return/:provider      [bank redirect] query { paymentId } → 302 to the client returnUrl?paymentId=..&status=..
//	GET  /admin/payments                 [admin]  query AdminPaymentQuery → Paginated<Payment & { userName }>
//	GET  /admin/payments/:id             [admin]  → Payment & { user, providerData, metadata, fulfilledAt }
//	POST /admin/payments/:id/refund      [ADMIN]  body { amount?, reason? } → Payment
//	GET  /admin/stats/revenue            [admin]  query { days?=30 } → TimeseriesPoint[]
//
// Job: payments.reconcile (10 min). Subscriptions and bookings get the shared engine with Engine(d) and register
// their purpose handlers.
package payments

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments/providers"
)

type Module struct {
	d   *app.Deps
	Svc *Service
}

func New(d *app.Deps) *Module {
	svc := Engine(d)
	d.Jobs.Every("payments.reconcile", 10*time.Minute, func(ctx context.Context) error {
		_, err := svc.Reconcile(ctx, time.Now())
		return err
	})
	return &Module{d: d, Svc: svc}
}

func (m *Module) Routes(r chi.Router) {
	s := m.Svc
	r.With(auth.Required).Post("/checkout", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
		var b CheckoutBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return s.Checkout(r.Context(), auth.Current(r).ID, &b)
	}))
	r.With(auth.Required).Get("/payments", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		pg, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		return s.List(r.Context(), auth.Current(r).ID, pg)
	}))
	r.With(auth.Required).Get("/payments/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.GetOwn(r.Context(), auth.Current(r).ID, id)
	}))

	// Signed bank callback (docs/MOCKBANK.md → Webhooks). The raw body is verified before it is parsed.
	r.Post("/payments/webhook/{provider}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		if chi.URLParam(r, "provider") != s.Provider.Name() {
			return nil, httpx.E(http.StatusNotFound, "NOT_FOUND", "Unknown payment provider")
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		if err != nil {
			return nil, httpx.BadRequest("VALIDATION_ERROR", "cannot read body")
		}
		ev, err := s.Provider.VerifyWebhook(r.Header, raw)
		if err != nil {
			var ise *providers.InvalidSignatureError
			if errors.As(err, &ise) {
				slog.Warn("rejected webhook", "reason", ise.Msg)
				return nil, httpx.E(http.StatusUnauthorized, "INVALID_SIGNATURE", "Invalid webhook signature")
			}
			return nil, httpx.BadRequest("VALIDATION_ERROR", err.Error())
		}
		if _, err := s.ApplyProviderOrder(r.Context(), ev.Order); err != nil {
			return nil, err // 500 → the bank retries
		}
		return httpx.OK, nil
	}))

	// Browser comes back from the bank → finalise → 302 to the client returnUrl?paymentId=..&status=..
	r.Get("/payments/return/{provider}", func(w http.ResponseWriter, r *http.Request) {
		paymentID := r.URL.Query().Get("paymentId")
		p, err := s.HandleReturn(r.Context(), chi.URLParam(r, "provider"), paymentID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		target := BuildClientReturn(s.cfg, nil, paymentID, "FAILED")
		if p != nil {
			target = BuildClientReturn(s.cfg, p.ReturnURL, p.ID, p.Status)
		}
		w.Header().Set("Location", target)
		w.WriteHeader(http.StatusFound)
	})

	// ── admin ──
	r.With(auth.Roles("MODERATOR")).Get("/admin/payments", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return s.adminList(r)
	}))
	r.With(auth.Roles("MODERATOR")).Get("/admin/payments/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.adminGet(r.Context(), id)
	}))
	r.With(auth.Roles("ADMIN")).Post("/admin/payments/{id}/refund", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.adminRefund(r, id)
	}))
	r.With(auth.Roles("MODERATOR")).Get("/admin/stats/revenue", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := httpx.Q(r)
		days := 30
		if v := q.Int("days"); v != nil {
			days = *v
			if days < 1 || days > 366 {
				q.Fail("days: expected 1..366")
			}
		}
		if err := q.Err(); err != nil {
			return nil, err
		}
		return s.Revenue(r.Context(), days, time.Now())
	}))
}
