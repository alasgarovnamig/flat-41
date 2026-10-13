// Package subscriptions — business subscriptions (money workstream).
//
//	GET  /subscriptions/me         [auth]  → Subscription | null
//	POST /subscriptions/me/cancel  [auth]  → Subscription (autoRenew=false, stays active until period end)
//	POST /subscriptions/me/resume  [auth]  → Subscription (autoRenew=true)
//	GET  /admin/subscriptions      [admin] query { status?, page, pageSize } → Paginated<Subscription & { user, agency }>
//
// Job: subscriptions.renewal (hourly). Registers the SUBSCRIPTION purpose handler on the payment engine.
package subscriptions

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

type Module struct {
	d   *app.Deps
	Svc *Service
}

func New(d *app.Deps) *Module {
	svc := NewService(d)
	d.Jobs.Every("subscriptions.renewal", time.Hour, func(ctx context.Context) error {
		_, err := svc.ProcessRenewals(ctx, time.Now())
		return err
	})
	return &Module{d: d, Svc: svc}
}

func (m *Module) Routes(r chi.Router) {
	r.With(auth.Required).Get("/subscriptions/me", func(w http.ResponseWriter, r *http.Request) {
		sub, err := m.Svc.Me(r.Context(), auth.Current(r).ID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if sub == nil {
			httpx.JSON(w, http.StatusOK, nil) // explicit JSON null (Subscription | null)
			return
		}
		httpx.JSON(w, http.StatusOK, sub)
	})
	r.With(auth.Required).Post("/subscriptions/me/cancel", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return m.Svc.Cancel(r.Context(), auth.Current(r).ID)
	}))
	r.With(auth.Required).Post("/subscriptions/me/resume", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return m.Svc.Resume(r.Context(), auth.Current(r).ID)
	}))
	r.With(auth.Roles("MODERATOR")).Get("/admin/subscriptions", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		pg, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		q := httpx.Q(r)
		status := q.Str("status")
		if status != nil {
			switch *status {
			case "ACTIVE", "CANCELLED", "EXPIRED", "PAST_DUE":
			default:
				q.Fail("status: Invalid option: expected one of ACTIVE|CANCELLED|EXPIRED|PAST_DUE")
			}
		}
		if err := q.Err(); err != nil {
			return nil, err
		}
		return m.Svc.AdminList(r.Context(), status, pg)
	}))
}
