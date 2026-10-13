// Package promotions — paid listing promotions (money workstream). Registers d.Promotions (app.PromotionsAPI).
//
//	POST /listings/:id/apply-credit  [owner] body { credit: BUMP|VIP_7|PREMIUM_7 } → MyListing (spends subscription credits)
//
// Jobs: promotions.expire (10 min), promotions.auto-bump (hourly).
package promotions

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

// New constructs the promotions service, registers it as d.Promotions and schedules its jobs.
func New(d *app.Deps) *Module {
	svc := NewService(d)
	d.Promotions = svc
	d.Jobs.Every("promotions.expire", 10*time.Minute, func(ctx context.Context) error {
		_, err := svc.ExpirePromotions(ctx, time.Now())
		return err
	})
	d.Jobs.Every("promotions.auto-bump", time.Hour, func(ctx context.Context) error {
		_, err := svc.AutoBump(ctx, time.Now())
		return err
	})
	return &Module{d: d, Svc: svc}
}

type applyCreditBody struct {
	Credit string `json:"credit" validate:"required,oneof=BUMP VIP_7 PREMIUM_7"`
}

// Routes: lives under /listings but belongs to the money workstream (registered as a single route, no /listings mount).
func (m *Module) Routes(r chi.Router) {
	r.With(auth.Required).Post("/listings/{id}/apply-credit", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		var b applyCreditBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return m.Svc.ApplyCredit(r.Context(), auth.Current(r).ID, id, b.Credit)
	}))
}
