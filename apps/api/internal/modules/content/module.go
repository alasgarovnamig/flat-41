// Package content: banners (ad slots, impressions / clicks) and CMS pages (Markdown bodies, az/ru/en).
// Admin CRUD lives in the admin module and uses Service.
package content

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// SlugRe validates CMS page slugs.
var SlugRe = regexp.MustCompile(`^[a-z0-9-]+$`)

// Banner DTO.
type Banner struct {
	ID          string  `json:"id"`
	Placement   string  `json:"placement"`
	Title       string  `json:"title"`
	ImageURL    string  `json:"imageUrl"`
	LinkURL     string  `json:"linkUrl"`
	Active      bool    `json:"active"`
	StartsAt    *string `json:"startsAt"`
	EndsAt      *string `json:"endsAt"`
	Impressions int     `json:"impressions"`
	Clicks      int     `json:"clicks"`
	SortOrder   int     `json:"sortOrder"`
}

const bannerColumns = `id, placement, title, image_url, link_url, active, starts_at, ends_at, impressions, clicks, sort_order`

func scanBanner(row pgx.Row) (*Banner, error) {
	var b Banner
	var starts, ends *time.Time
	if err := row.Scan(&b.ID, &b.Placement, &b.Title, &b.ImageURL, &b.LinkURL, &b.Active, &starts, &ends, &b.Impressions, &b.Clicks, &b.SortOrder); err != nil {
		return nil, err
	}
	b.StartsAt, b.EndsAt = httpx.ISOPtr(starts), httpx.ISOPtr(ends)
	return &b, nil
}

// Page is the CmsPage DTO (body is Markdown).
type Page struct {
	Slug      string           `json:"slug"`
	Title     shared.Localized `json:"title"`
	Body      shared.Localized `json:"body"`
	UpdatedAt string           `json:"updatedAt"`
}

// PageSummary is an item of GET /pages.
type PageSummary struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

func scanPage(row pgx.Row) (*Page, error) {
	var p Page
	var updated time.Time
	if err := row.Scan(&p.Slug, &p.Title, &p.Body, &updated); err != nil {
		return nil, err
	}
	p.UpdatedAt = httpx.ISO(updated)
	return &p, nil
}

type Service struct{ d *app.Deps }

func NewService(d *app.Deps) *Service { return &Service{d: d} }

type Module struct {
	d   *app.Deps
	svc *Service
}

func New(d *app.Deps) *Module { return &Module{d: d, svc: NewService(d)} }

func (m *Module) Routes(r chi.Router) {
	r.Get("/banners", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := httpx.Q(r)
		placement := mkt.QEnum(q, "placement", shared.Enum.BannerPlacements)
		if err := q.Err(); err != nil {
			return nil, err
		}
		return m.svc.ActiveBanners(r.Context(), placement)
	}))
	r.Post("/banners/{id}/click", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		tag, err := m.d.Pool.Exec(r.Context(), `update banners set clicks = clicks + 1 where id = $1`, id)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, httpx.NotFound("Banner")
		}
		return httpx.OK, nil
	}))
	r.Get("/pages", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := httpx.Q(r)
		locale := "az"
		if l := mkt.QEnum(q, "locale", shared.Enum.Locales); l != nil {
			locale = *l
		}
		if err := q.Err(); err != nil {
			return nil, err
		}
		pages, err := m.svc.Pages(r.Context())
		if err != nil {
			return nil, err
		}
		out := make([]PageSummary, 0, len(pages))
		for _, p := range pages {
			out = append(out, PageSummary{Slug: p.Slug, Title: p.Title.In(locale)})
		}
		return out, nil
	}))
	r.Get("/pages/{slug}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		slug, err := url.PathUnescape(chi.URLParam(r, "slug"))
		if err != nil {
			return nil, httpx.NotFound("Page")
		}
		return m.svc.Page(r.Context(), slug)
	}))
}

// ActiveBanners: active banners of a placement within their date window; counts one impression each.
func (s *Service) ActiveBanners(ctx context.Context, placement *string) ([]Banner, error) {
	now := time.Now()
	where := sq.And{sq.Eq{"active": true},
		sq.Or{sq.Eq{"starts_at": nil}, sq.LtOrEq{"starts_at": now}},
		sq.Or{sq.Eq{"ends_at": nil}, sq.Gt{"ends_at": now}}}
	if placement != nil {
		where = append(where, sq.Eq{"placement": *placement})
	}
	sqlStr, args, err := psql.Select(bannerColumns).From("banners").Where(where).OrderBy("sort_order asc", "created_at desc").ToSql()
	if err != nil {
		return nil, err
	}
	list, err := s.queryBanners(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	if len(list) > 0 {
		ids := make([]string, len(list))
		for i := range list {
			ids[i] = list[i].ID
			list[i].Impressions++
		}
		if _, err := s.d.Pool.Exec(ctx, `update banners set impressions = impressions + 1 where id = any($1::uuid[])`, ids); err != nil {
			return nil, err
		}
	}
	return list, nil
}

func (s *Service) queryBanners(ctx context.Context, sqlStr string, args ...any) ([]Banner, error) {
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Banner{}
	for rows.Next() {
		b, err := scanBanner(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// AllBanners (admin): every banner by placement, sortOrder.
func (s *Service) AllBanners(ctx context.Context) ([]Banner, error) {
	return s.queryBanners(ctx, `select `+bannerColumns+` from banners order by placement asc, sort_order asc`)
}

// BannerInput is a validated bannerSchema (create) / bannerSchema.partial() (update) body.
type BannerInput struct{ set map[string]any }

// ParseBanner validates a banner body. Create applies defaults (active=true, sortOrder=0).
func ParseBanner(b *mkt.Body, create bool) BannerInput {
	set := map[string]any{}
	if o := b.Str("placement", mkt.S{Req: create, Enum: shared.Enum.BannerPlacements}); o.Ok() {
		set["placement"] = o.V
	}
	if o := b.Str("title", mkt.S{Req: create, Min: 1, Max: 120}); o.Ok() {
		set["title"] = o.V
	}
	if o := b.Str("imageUrl", mkt.S{Req: create, URL: true}); o.Ok() {
		set["image_url"] = o.V
	}
	if o := b.Str("linkUrl", mkt.S{Req: create, URL: true}); o.Ok() {
		set["link_url"] = o.V
	}
	if o := b.Bool("active", false, false); o.Ok() {
		set["active"] = o.V
	} else if create {
		set["active"] = true
	}
	for _, k := range []struct{ key, col string }{{"startsAt", "starts_at"}, {"endsAt", "ends_at"}} {
		o := b.Str(k.key, mkt.S{Null: true, DateTime: true})
		if o.Present {
			if o.Null {
				set[k.col] = nil
			} else if t, err := time.Parse(time.RFC3339Nano, o.V); err == nil {
				set[k.col] = t
			} else if t, err := time.Parse("2006-01-02T15:04Z", o.V); err == nil {
				set[k.col] = t
			} else {
				b.Add(k.key, "Invalid ISO datetime")
			}
		}
	}
	if o := b.Int("sortOrder", mkt.N{}); o.Ok() {
		set["sort_order"] = o.V
	} else if create {
		set["sort_order"] = 0
	}
	return BannerInput{set: set}
}

func (s *Service) CreateBanner(ctx context.Context, in BannerInput) (*Banner, error) {
	sqlStr, args, err := psql.Insert("banners").SetMap(in.set).Suffix("returning " + bannerColumns).ToSql()
	if err != nil {
		return nil, err
	}
	return scanBanner(s.d.Pool.QueryRow(ctx, sqlStr, args...))
}

func (s *Service) UpdateBanner(ctx context.Context, id string, in BannerInput) (*Banner, error) {
	var row pgx.Row
	if len(in.set) == 0 {
		row = s.d.Pool.QueryRow(ctx, `select `+bannerColumns+` from banners where id = $1`, id)
	} else {
		sqlStr, args, err := psql.Update("banners").SetMap(in.set).Where(sq.Eq{"id": id}).Suffix("returning " + bannerColumns).ToSql()
		if err != nil {
			return nil, err
		}
		row = s.d.Pool.QueryRow(ctx, sqlStr, args...)
	}
	b, err := scanBanner(row)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Banner")
	}
	return b, err
}

func (s *Service) DeleteBanner(ctx context.Context, id string) error {
	tag, err := s.d.Pool.Exec(ctx, `delete from banners where id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Banner")
	}
	return nil
}

func (s *Service) Page(ctx context.Context, slug string) (*Page, error) {
	p, err := scanPage(s.d.Pool.QueryRow(ctx, `select slug, title, body, updated_at from cms_pages where slug = $1`, slug))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Page")
	}
	return p, err
}

func (s *Service) Pages(ctx context.Context) ([]Page, error) {
	rows, err := s.d.Pool.Query(ctx, `select slug, title, body, updated_at from cms_pages order by slug asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Page{}
	for rows.Next() {
		p, err := scanPage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (s *Service) UpsertPage(ctx context.Context, slug string, title, body shared.Localized) (*Page, error) {
	return scanPage(s.d.Pool.QueryRow(ctx, `insert into cms_pages (slug, title, body) values ($1,$2,$3)
		on conflict (slug) do update set title = excluded.title, body = excluded.body, updated_at = now()
		returning slug, title, body, updated_at`, slug, title, body))
}

func (s *Service) DeletePage(ctx context.Context, slug string) error {
	tag, err := s.d.Pool.Exec(ctx, `delete from cms_pages where slug = $1`, slug)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Page")
	}
	return nil
}
