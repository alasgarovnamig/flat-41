// Package admin: back-office endpoints for the marketplace — listings moderation, users (incl. wallet adjustments),
// agencies, reports, banners, CMS pages, mortgage leads and the audit log. Money admin endpoints (payments,
// bookings, subscriptions, catalog, settings, revenue stats) live in their own modules; dashboard stats in stats.
package admin

import (
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/modules/agencies"
	"github.com/alasgarovnamig/evtap/api/internal/modules/content"
	"github.com/alasgarovnamig/evtap/api/internal/modules/listings"
	"github.com/alasgarovnamig/evtap/api/internal/modules/mortgage"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

type Module struct {
	d        *app.Deps
	svc      *Service
	agencies *agencies.Service
	content  *content.Service
	mortgage *mortgage.Service
}

func New(d *app.Deps) *Module {
	return &Module{d: d, svc: &Service{d: d, listings: listings.NewService(d)}, agencies: agencies.NewService(d),
		content: content.NewService(d), mortgage: mortgage.NewService(d)}
}

// h wraps an admin handler with the current user and client IP.
func h(fn func(r *http.Request, u *auth.User, ip *string) (any, error)) http.HandlerFunc {
	return httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return fn(r, auth.Current(r), mkt.ClientIP(r))
	})
}

func hs(status int, fn func(r *http.Request, u *auth.User, ip *string) (any, error)) http.HandlerFunc {
	return httpx.HS(status, func(w http.ResponseWriter, r *http.Request) (any, error) {
		return fn(r, auth.Current(r), mkt.ClientIP(r))
	})
}

func reason(r *http.Request) (string, error) {
	b, err := mkt.ReadBody(r)
	if err != nil {
		return "", err
	}
	v := b.Str("reason", mkt.S{Req: true, Trim: true, Min: 3, Max: 500})
	return v.V, b.Err()
}

func statusPage(r *http.Request, statuses []string) (*string, httpx.PageArgs, error) {
	p, err := httpx.Pagination(r, 20, 100)
	if err != nil {
		return nil, p, err
	}
	q := httpx.Q(r)
	st := mkt.QEnum(q, "status", statuses)
	return st, p, q.Err()
}

func (m *Module) Routes(r chi.Router) {
	s := m.svc
	admin := auth.Roles("ADMIN")
	r.Group(func(r chi.Router) {
		r.Use(auth.Roles("MODERATOR"))

		// ───────── Listings ─────────
		r.Get("/admin/listings", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			p, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			q := httpx.Q(r)
			lq := ListingQuery{
				Status:   mkt.QEnum(q, "status", shared.Enum.ListingStatuses),
				Q:        q.Str("q"),
				DealType: mkt.QEnum(q, "dealType", shared.Enum.DealTypes),
				OwnerID:  mkt.QUUID(q, "ownerId"),
				Page:     p,
			}
			if rep := q.Bool("reported"); rep != nil {
				lq.Reported = *rep
			}
			if err := q.Err(); err != nil {
				return nil, err
			}
			return s.ListListings(r.Context(), lq)
		}))
		r.Get("/admin/listings/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			return s.ListingDetail(r.Context(), id, u)
		}))
		r.Post("/admin/listings/{id}/approve", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			return s.Approve(r.Context(), id, u, ip)
		}))
		r.Post("/admin/listings/{id}/reject", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			rs, err := reason(r)
			if err != nil {
				return nil, err
			}
			return s.Reject(r.Context(), id, rs, u, ip)
		}))
		r.Post("/admin/listings/{id}/block", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			rs, err := reason(r)
			if err != nil {
				return nil, err
			}
			return s.Block(r.Context(), id, rs, u, ip)
		}))
		r.Patch("/admin/listings/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			in := listings.ParseInput(b, false, true)
			if err := b.Err(); err != nil {
				return nil, err
			}
			return s.UpdateListing(r.Context(), id, in, u, ip)
		}))
		r.With(admin).Post("/admin/listings/{id}/promote", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			code := b.Str("serviceCode", mkt.S{Req: true, Min: 1})
			if err := b.Err(); err != nil {
				return nil, err
			}
			return s.Promote(r.Context(), id, code.V, u, ip)
		}))

		// ───────── Users ─────────
		r.Get("/admin/users", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			p, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			q := httpx.Q(r)
			uq := UserQuery{
				Q:           q.Str("q"),
				Role:        mkt.QEnum(q, "role", shared.Enum.UserRoles),
				Status:      mkt.QEnum(q, "status", shared.Enum.UserStatuses),
				AccountType: mkt.QEnum(q, "accountType", []string{"INDIVIDUAL", "BUSINESS"}),
				Page:        p,
			}
			if err := q.Err(); err != nil {
				return nil, err
			}
			return s.ListUsers(r.Context(), uq)
		}))
		r.Get("/admin/users/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			return s.UserDetail(r.Context(), id)
		}))
		r.With(admin).Patch("/admin/users/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			in := UserUpdate{
				Role:   b.Str("role", mkt.S{Enum: shared.Enum.UserRoles}),
				Status: b.Str("status", mkt.S{Enum: shared.Enum.UserStatuses}),
				Name:   b.Str("name", mkt.S{Min: 2, Max: 80}),
				After:  map[string]any{},
			}
			if err := b.Err(); err != nil {
				return nil, err
			}
			for k, o := range map[string]mkt.Opt[string]{"role": in.Role, "status": in.Status, "name": in.Name} {
				if o.Ok() {
					in.After[k] = o.V
				}
			}
			return s.UpdateUser(r.Context(), id, in, u, ip)
		}))
		r.With(admin).Post("/admin/users/{id}/wallet-adjust", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			amount := b.Int("amount", mkt.N{Req: true})
			if amount.Ok() && amount.V == 0 {
				b.Add("amount", "Invalid input")
			}
			rs := b.Str("reason", mkt.S{Req: true, Trim: true, Min: 3, Max: 300})
			if err := b.Err(); err != nil {
				return nil, err
			}
			return s.WalletAdjust(r.Context(), id, amount.V, rs.V, u, ip)
		}))

		// ───────── Agencies ─────────
		r.Get("/admin/agencies", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			p, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			q := httpx.Q(r)
			lq := agencies.ListQuery{Q: mkt.QMax(q, "q", 100), Verified: q.Bool("verified"), Page: p.Page, PageSize: p.PageSize}
			if err := q.Err(); err != nil {
				return nil, err
			}
			return m.agencies.List(r.Context(), lq)
		}))
		r.Patch("/admin/agencies/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			verified := b.Bool("verified", true, false)
			if err := b.Err(); err != nil {
				return nil, err
			}
			a, err := m.agencies.SetVerified(r.Context(), id, verified.V)
			if err != nil {
				return nil, err
			}
			m.d.Audit.Log(r.Context(), &u.ID, "agency.verify", "agency", &id, map[string]any{"verified": verified.V}, ip)
			return a, nil
		}))

		// ───────── Reports ─────────
		r.Get("/admin/reports", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			st, p, err := statusPage(r, []string{"OPEN", "RESOLVED", "DISMISSED"})
			if err != nil {
				return nil, err
			}
			return s.Reports(r.Context(), st, p)
		}))
		r.Patch("/admin/reports/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			st := b.Str("status", mkt.S{Req: true, Enum: []string{"RESOLVED", "DISMISSED"}})
			if err := b.Err(); err != nil {
				return nil, err
			}
			return s.ResolveReport(r.Context(), id, st.V, u, ip)
		}))

		// ───────── Banners ─────────
		r.Get("/admin/banners", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			return m.content.AllBanners(r.Context())
		}))
		r.With(admin).Post("/admin/banners", hs(http.StatusCreated, func(r *http.Request, u *auth.User, ip *string) (any, error) {
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			in := content.ParseBanner(b, true)
			if err := b.Err(); err != nil {
				return nil, err
			}
			bn, err := m.content.CreateBanner(r.Context(), in)
			if err != nil {
				return nil, err
			}
			m.d.Audit.Log(r.Context(), &u.ID, "banner.create", "banner", &bn.ID, map[string]any{"title": bn.Title, "placement": bn.Placement}, ip)
			return bn, nil
		}))
		r.With(admin).Patch("/admin/banners/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			in := content.ParseBanner(b, false)
			if err := b.Err(); err != nil {
				return nil, err
			}
			bn, err := m.content.UpdateBanner(r.Context(), id, in)
			if err != nil {
				return nil, err
			}
			fields := b.KnownKeys("placement", "title", "imageUrl", "linkUrl", "active", "startsAt", "endsAt", "sortOrder")
			m.d.Audit.Log(r.Context(), &u.ID, "banner.update", "banner", &id, map[string]any{"fields": fields}, ip)
			return bn, nil
		}))
		r.With(admin).Delete("/admin/banners/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			if err := m.content.DeleteBanner(r.Context(), id); err != nil {
				return nil, err
			}
			m.d.Audit.Log(r.Context(), &u.ID, "banner.delete", "banner", &id, nil, ip)
			return httpx.OK, nil
		}))

		// ───────── CMS pages ─────────
		r.Get("/admin/pages", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			return m.content.Pages(r.Context())
		}))
		r.With(admin).Put("/admin/pages/{slug}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			slug, _ := url.PathUnescape(chi.URLParam(r, "slug"))
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			bodySlug := b.Str("slug", mkt.S{Re: content.SlugRe})
			title := b.Localized("title", true)
			body := b.Localized("body", true)
			if err := b.Err(); err != nil {
				return nil, err
			}
			if !content.SlugRe.MatchString(slug) || (bodySlug.Ok() && bodySlug.V != slug) {
				return nil, httpx.BadRequest("VALIDATION_ERROR", "slug mismatch or invalid")
			}
			p, err := m.content.UpsertPage(r.Context(), slug, title.V, body.V)
			if err != nil {
				return nil, err
			}
			m.d.Audit.Log(r.Context(), &u.ID, "page.upsert", "page", &slug, nil, ip)
			return p, nil
		}))
		r.With(admin).Delete("/admin/pages/{slug}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			slug, _ := url.PathUnescape(chi.URLParam(r, "slug"))
			if err := m.content.DeletePage(r.Context(), slug); err != nil {
				return nil, err
			}
			m.d.Audit.Log(r.Context(), &u.ID, "page.delete", "page", &slug, nil, ip)
			return httpx.OK, nil
		}))

		// ───────── Mortgage leads ─────────
		r.Get("/admin/mortgage-leads", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			st, p, err := statusPage(r, mortgage.LeadStatuses)
			if err != nil {
				return nil, err
			}
			return m.mortgage.List(r.Context(), st, p)
		}))
		r.Patch("/admin/mortgage-leads/{id}", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			st := b.Str("status", mkt.S{Req: true, Enum: mortgage.LeadStatuses})
			if err := b.Err(); err != nil {
				return nil, err
			}
			l, err := m.mortgage.SetStatus(r.Context(), id, st.V)
			if err != nil {
				return nil, err
			}
			m.d.Audit.Log(r.Context(), &u.ID, "mortgage_lead.update", "mortgage_lead", &id, map[string]any{"status": st.V}, ip)
			return l, nil
		}))

		// ───────── Audit log ─────────
		r.With(admin).Get("/admin/audit-logs", h(func(r *http.Request, u *auth.User, ip *string) (any, error) {
			p, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			q := httpx.Q(r)
			entity := mkt.QMax(q, "entity", 40)
			actor := mkt.QUUID(q, "actorId")
			if err := q.Err(); err != nil {
				return nil, err
			}
			return s.AuditLogs(r.Context(), entity, actor, p)
		}))
	})
}
