// Package listings: search (filters, map, featured), detail, owner CRUD + status actions, availability, stats,
// reports, the expiry cron and app.ListingsAPI (listing fee / verification fulfilment for payments).
package listings

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

type Module struct {
	d   *app.Deps
	svc *Service
}

// New creates the module, registers the expiry cron and exposes the service as d.Listings.
func New(d *app.Deps) *Module {
	svc := NewService(d)
	d.Listings = svc
	d.Jobs.Every("listings.expiry", time.Hour, svc.RunExpiry)
	return &Module{d: d, svc: svc}
}

// Service exposes the listings service (admin, saved searches).
func (m *Module) Service() *Service { return m.svc }

func parseSearch(r *http.Request) (*SearchFilters, error) {
	q, errs := ParseSearch(QueryMap(r.URL.Query()))
	if errs != nil {
		return nil, httpx.ValidationError(errs)
	}
	return q, nil
}

func (m *Module) Routes(r chi.Router) {
	s := m.svc
	r.Get("/listings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q, err := parseSearch(r)
		if err != nil {
			return nil, err
		}
		return s.Search(r.Context(), q)
	}))
	r.Get("/listings/featured", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := httpx.Q(r)
		kind := "vip"
		if k := mkt.QEnum(q, "kind", []string{"vip", "premium"}); k != nil {
			kind = *k
		}
		deal := mkt.QEnum(q, "dealType", shared.Enum.DealTypes)
		city := q.Str("cityId")
		limit := 12
		if l := q.Int("limit"); l != nil {
			if *l < 1 || *l > 50 {
				q.Fail("limit: expected 1..50")
			} else {
				limit = *l
			}
		}
		if err := q.Err(); err != nil {
			return nil, err
		}
		return s.Featured(r.Context(), kind, deal, city, limit)
	}))
	r.Get("/listings/map", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q, err := parseSearch(r)
		if err != nil {
			return nil, err
		}
		return s.MapPoints(r.Context(), q)
	}))
	r.With(auth.Required).Get("/me/listings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		p, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		q := httpx.Q(r)
		status := mkt.QEnum(q, "status", shared.Enum.ListingStatuses)
		if err := q.Err(); err != nil {
			return nil, err
		}
		return s.MyListings(r.Context(), auth.Current(r).ID, status, p)
	}))
	r.Get("/listings/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.GetDetail(r.Context(), id, auth.Current(r), true)
	}))
	r.Post("/listings/{id}/phone", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.RevealPhone(r.Context(), id, auth.Current(r))
	}))
	r.Get("/listings/{id}/similar", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.Similar(r.Context(), id)
	}))
	r.Get("/listings/{id}/reviews", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		p, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		return s.Reviews(r.Context(), id, p)
	}))
	r.Get("/listings/{id}/availability", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		q := httpx.Q(r)
		from, to := q.Str("from"), q.Str("to")
		for name, v := range map[string]*string{"from": from, "to": to} {
			if v != nil && !shared.ISODateRe.MatchString(*v) {
				q.Fail(name + ": Expected YYYY-MM-DD")
			}
		}
		if err := q.Err(); err != nil {
			return nil, err
		}
		return s.GetAvailability(r.Context(), id, from, to)
	}))
	r.With(auth.Required).Put("/listings/{id}/availability", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		b, err := mkt.ReadBody(r)
		if err != nil {
			return nil, err
		}
		dates := b.StrArr("blockedDates", mkt.A{Req: true, Max: 366, Item: mkt.S{Re: shared.ISODateRe, ReMsg: "Expected YYYY-MM-DD"}})
		if err := b.Err(); err != nil {
			return nil, err
		}
		return s.SetAvailability(r.Context(), id, auth.Current(r), dates.V)
	}))
	r.With(auth.Required).Get("/listings/{id}/stats", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.Stats(r.Context(), id, auth.Current(r), 30)
	}))
	r.With(auth.Required).Post("/listings", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
		b, err := mkt.ReadBody(r)
		if err != nil {
			return nil, err
		}
		in := ParseInput(b, true, false)
		if err := b.Err(); err != nil {
			return nil, err
		}
		return s.Create(r.Context(), auth.Current(r), in)
	}))
	r.With(auth.Required).Patch("/listings/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		b, err := mkt.ReadBody(r)
		if err != nil {
			return nil, err
		}
		in := ParseInput(b, false, false)
		if err := b.Err(); err != nil {
			return nil, err
		}
		return s.Update(r.Context(), id, auth.Current(r), in)
	}))
	r.With(auth.Required).Post("/listings/{id}/actions", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		b, err := mkt.ReadBody(r)
		if err != nil {
			return nil, err
		}
		action := b.Str("action", mkt.S{Req: true, Enum: []string{"MARK_SOLD", "ARCHIVE", "RENEW", "RESTORE"}})
		if err := b.Err(); err != nil {
			return nil, err
		}
		return s.Action(r.Context(), id, auth.Current(r), action.V)
	}))
	r.With(auth.Required).Delete("/listings/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		if err := s.Remove(r.Context(), id, auth.Current(r)); err != nil {
			return nil, err
		}
		return httpx.OK, nil
	}))
	r.Post("/listings/{id}/report", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		b, err := mkt.ReadBody(r)
		if err != nil {
			return nil, err
		}
		reason := b.Str("reason", mkt.S{Req: true, Enum: shared.Enum.ReportReasons})
		comment := b.Str("comment", mkt.S{Max: 1000})
		if err := b.Err(); err != nil {
			return nil, err
		}
		if err := s.Report(r.Context(), id, auth.Current(r), reason.V, comment.Ptr()); err != nil {
			return nil, err
		}
		return httpx.OK, nil
	}))
}
