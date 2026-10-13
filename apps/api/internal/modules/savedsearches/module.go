// Package savedsearches: saved listing searches + the 15-minute matcher that counts / notifies new matches.
package savedsearches

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/modules/listings"
)

// MaxPerUser caps saved searches per user.
const MaxPerUser = 30

// ignoredKeys: paging / sorting keys are irrelevant for matching.
var ignoredKeys = map[string]bool{"page": true, "pageSize": true, "sort": true, "bbox": true}

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// SavedSearch DTO.
type SavedSearch struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Query      map[string]any `json:"query"`
	Notify     bool           `json:"notify"`
	NewMatches int            `json:"newMatches"`
	CreatedAt  string         `json:"createdAt"`
}

const columns = `id, name, query, notify, new_matches, created_at`

func scan(row pgx.Row) (*SavedSearch, error) {
	var s SavedSearch
	var created time.Time
	if err := row.Scan(&s.ID, &s.Name, &s.Query, &s.Notify, &s.NewMatches, &created); err != nil {
		return nil, err
	}
	if s.Query == nil {
		s.Query = map[string]any{}
	}
	s.CreatedAt = httpx.ISO(created)
	return &s, nil
}

type Module struct {
	d        *app.Deps
	listings *listings.Service
}

func New(d *app.Deps) *Module {
	m := &Module{d: d, listings: listings.NewService(d)}
	d.Jobs.Every("saved-searches.matcher", 15*time.Minute, func(ctx context.Context) error {
		n, err := m.Match(ctx, time.Now())
		if n > 0 {
			slog.Info("saved searches notified", "count", n)
		}
		return err
	})
	return m
}

func (m *Module) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(auth.Required)
		r.Get("/saved-searches", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			return m.List(r.Context(), auth.Current(r).ID)
		}))
		r.Post("/saved-searches", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			name := b.Str("name", mkt.S{Req: true, Trim: true, Min: 1, Max: 80})
			query := b.Record("query", true)
			notify := b.Bool("notify", false, false)
			if err := b.Err(); err != nil {
				return nil, err
			}
			n := true
			if notify.Ok() {
				n = notify.V
			}
			return m.Create(r.Context(), auth.Current(r).ID, name.V, query.V, n)
		}))
		r.Patch("/saved-searches/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			b, err := mkt.ReadBody(r)
			if err != nil {
				return nil, err
			}
			name := b.Str("name", mkt.S{Trim: true, Min: 1, Max: 80})
			notify := b.Bool("notify", false, false)
			if err := b.Err(); err != nil {
				return nil, err
			}
			return m.Update(r.Context(), auth.Current(r).ID, id, name.Ptr(), notify.Ptr())
		}))
		r.Delete("/saved-searches/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := mkt.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			tag, err := m.d.Pool.Exec(r.Context(), `delete from saved_searches where id = $1 and user_id = $2`, id, auth.Current(r).ID)
			if err != nil {
				return nil, err
			}
			if tag.RowsAffected() == 0 {
				return nil, httpx.NotFound("Saved search")
			}
			return httpx.OK, nil
		}))
	})
}

// List returns saved searches; the returned newMatches are then marked as seen (reset to 0).
func (m *Module) List(ctx context.Context, userID string) ([]SavedSearch, error) {
	rows, err := m.d.Pool.Query(ctx, `select `+columns+` from saved_searches where user_id = $1 order by created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	out := []SavedSearch{}
	unseen := false
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		unseen = unseen || s.NewMatches > 0
		out = append(out, *s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if unseen {
		if _, err := m.d.Pool.Exec(ctx, `update saved_searches set new_matches = 0 where user_id = $1 and new_matches > 0`, userID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (m *Module) Create(ctx context.Context, userID, name string, query map[string]any, notify bool) (*SavedSearch, error) {
	if _, errs := listings.ParseSearch(query); errs != nil {
		return nil, httpx.BadRequest("VALIDATION_ERROR", "query is not a valid listing search")
	}
	var c int
	if err := m.d.Pool.QueryRow(ctx, `select count(*)::int from saved_searches where user_id = $1`, userID).Scan(&c); err != nil {
		return nil, err
	}
	if c >= MaxPerUser {
		return nil, httpx.BadRequest("LIMIT_REACHED", fmt.Sprintf("Max %d saved searches", MaxPerUser))
	}
	clean := map[string]any{}
	for k, v := range query {
		if ignoredKeys[k] || v == nil || v == "" {
			continue
		}
		clean[k] = v
	}
	return scan(m.d.Pool.QueryRow(ctx, `insert into saved_searches (user_id, name, query, notify) values ($1,$2,$3,$4) returning `+columns,
		userID, name, clean, notify))
}

// Update renames / toggles notifications of the caller's saved search.
func (m *Module) Update(ctx context.Context, userID, id string, name *string, notify *bool) (*SavedSearch, error) {
	set := map[string]any{}
	if name != nil {
		set["name"] = *name
	}
	if notify != nil {
		set["notify"] = *notify
	}
	var row pgx.Row
	if len(set) == 0 {
		row = m.d.Pool.QueryRow(ctx, `select `+columns+` from saved_searches where id = $1 and user_id = $2`, id, userID)
	} else {
		sqlStr, args, err := psql.Update("saved_searches").SetMap(set).Where(sq.Eq{"id": id, "user_id": userID}).Suffix("returning " + columns).ToSql()
		if err != nil {
			return nil, err
		}
		row = m.d.Pool.QueryRow(ctx, sqlStr, args...)
	}
	s, err := scan(row)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Saved search")
	}
	return s, err
}

// Match counts listings published since lastCheckedAt that match each saved search; returns how many were notified.
func (m *Module) Match(ctx context.Context, now time.Time) (int, error) {
	type item struct {
		id, userID, name string
		query            map[string]any
		notify           bool
		lastChecked      time.Time
	}
	rows, err := m.d.Pool.Query(ctx, `select s.id, s.user_id, s.name, s.query, s.notify, s.last_checked_at
		from saved_searches s join users u on u.id = s.user_id where u.status = 'ACTIVE'`)
	if err != nil {
		return 0, err
	}
	var list []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.userID, &it.name, &it.query, &it.notify, &it.lastChecked); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	notified := 0
	for _, s := range list {
		count := 0
		if q, errs := listings.ParseSearch(s.query); errs == nil {
			if count, err = m.listings.CountNewMatches(ctx, q, s.lastChecked, now, s.userID); err != nil {
				return notified, err
			}
		}
		if _, err := m.d.Pool.Exec(ctx, `update saved_searches set last_checked_at = $2, new_matches = new_matches + $3 where id = $1`, s.id, now, count); err != nil {
			return notified, err
		}
		if count > 0 && s.notify {
			query := s.query
			if query == nil {
				query = map[string]any{}
			}
			if _, err := m.d.Notify.Notify(ctx, s.userID, "SAVED_SEARCH_MATCH", "Yeni elanlar",
				fmt.Sprintf(`"%s" axtarışınıza uyğun %d yeni elan var.`, s.name, count),
				map[string]any{"savedSearchId": s.id, "count": count, "query": query}); err != nil {
				return notified, err
			}
			notified++
		}
	}
	return notified, nil
}
