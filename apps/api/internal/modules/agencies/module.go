// Package agencies: public agency directory, agency creation (user → BUSINESS + OWNER), members (limited by the
// plan's maxAgents) and agency stats. Admin verification lives in the admin module (uses Service.SetVerified).
package agencies

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
)

type Module struct {
	d   *app.Deps
	svc *Service
}

func New(d *app.Deps) *Module { return &Module{d: d, svc: NewService(d)} }

func (m *Module) Routes(r chi.Router) {
	{
		r.Get("/agencies", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			p, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			q := httpx.Q(r)
			lq := ListQuery{
				Type:   mkt.QEnum(q, "type", []string{"AGENCY", "DEVELOPER"}),
				CityID: q.Str("cityId"),
				Q:      mkt.QMax(q, "q", 100),
				Page:   p.Page, PageSize: p.PageSize,
			}
			if err := q.Err(); err != nil {
				return nil, err
			}
			return m.svc.List(r.Context(), lq)
		}))
		r.With(auth.Required).Post("/agencies", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			in := ParseInput(b, false)
			if err := b.Err(); err != nil {
				return nil, err
			}
			return m.svc.Create(r.Context(), auth.Current(r).ID, in)
		}))
		r.Group(func(r chi.Router) {
			r.Use(auth.Required)
			r.Get("/agencies/me", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
				return m.svc.GetMine(r.Context(), auth.Current(r).ID)
			}))
			r.Patch("/agencies/me", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
				b, err := mkt.ReadBody(r)
				if err != nil {
					return nil, err
				}
				in := ParseInput(b, true)
				if err := b.Err(); err != nil {
					return nil, err
				}
				return m.svc.UpdateMine(r.Context(), auth.Current(r).ID, in)
			}))
			r.Get("/agencies/me/members", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
				return m.svc.Members(r.Context(), auth.Current(r).ID)
			}))
			r.Post("/agencies/me/members", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
				b, err := mkt.ReadBody(r)
				if err != nil {
					return nil, err
				}
				login := b.Str("login", mkt.S{Req: true, Trim: true, Min: 3})
				if err := b.Err(); err != nil {
					return nil, err
				}
				return m.svc.AddMember(r.Context(), auth.Current(r).ID, login.V)
			}))
			r.Delete("/agencies/me/members/{userId}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
				id, err := mkt.UUIDParam(r, "userId")
				if err != nil {
					return nil, err
				}
				if err := m.svc.RemoveMember(r.Context(), auth.Current(r).ID, id); err != nil {
					return nil, err
				}
				return httpx.OK, nil
			}))
			r.Get("/agencies/me/stats", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
				q := httpx.Q(r)
				days := mkt.QDays(q)
				if err := q.Err(); err != nil {
					return nil, err
				}
				return m.svc.Stats(r.Context(), auth.Current(r).ID, days)
			}))
		})
		r.Get("/agencies/{slug}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			return m.svc.BySlug(r.Context(), chi.URLParam(r, "slug"))
		}))
	}
}
