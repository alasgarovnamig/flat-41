// Package locations: GET /locations — static reference data (countries, cities, districts, metro stations).
package locations

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module { return &Module{d: d} }

func (m *Module) Routes(r chi.Router) {
	r.Get("/locations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		httpx.JSON(w, http.StatusOK, shared.Loc)
	})
}
