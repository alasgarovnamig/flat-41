// Package subscriptions — TODO: implemented by the owning workstream (see docs/ARCHITECTURE.md → API module ownership).
package subscriptions

import (
	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
)

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module { return &Module{d: d} }

func (m *Module) Routes(r chi.Router) {}
