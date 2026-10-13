// Package wallet — user wallets and the money ledger (money workstream). Registers d.Wallet (app.WalletAPI).
//
//	GET /wallet               [auth] → Wallet
//	GET /wallet/transactions  [auth] query pagination → Paginated<WalletTransaction>
package wallet

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

type Module struct {
	d   *app.Deps
	svc *Service
}

// New constructs the wallet service and registers it as d.Wallet (constructed before every consumer).
func New(d *app.Deps) *Module {
	svc := NewService(d.Pool)
	d.Wallet = svc
	return &Module{d: d, svc: svc}
}

func (m *Module) Routes(r chi.Router) {
	r.With(auth.Required).Get("/wallet", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return m.svc.Get(r.Context(), nil, auth.Current(r).ID)
	}))
	r.With(auth.Required).Get("/wallet/transactions", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		pg, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		return m.svc.Transactions(r.Context(), auth.Current(r).ID, pg)
	}))
}
