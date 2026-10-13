// Package favorites: the user's favourite listings (cards), ids for quick "heart" state, add / remove.
package favorites

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/modules/listings"
)

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module { return &Module{d: d} }

func (m *Module) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(auth.Required)
		r.Get("/favorites", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			p, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			return m.List(r.Context(), auth.Current(r).ID, p)
		}))
		r.Get("/favorites/ids", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			return m.IDs(r.Context(), auth.Current(r).ID)
		}))
		r.Post("/favorites/{listingId}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := mkt.UUIDParam(r, "listingId")
			if err != nil {
				return nil, err
			}
			if err := m.Add(r.Context(), auth.Current(r).ID, id); err != nil {
				return nil, err
			}
			return httpx.OK, nil
		}))
		r.Delete("/favorites/{listingId}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := mkt.UUIDParam(r, "listingId")
			if err != nil {
				return nil, err
			}
			if err := m.Remove(r.Context(), auth.Current(r).ID, id); err != nil {
				return nil, err
			}
			return httpx.OK, nil
		}))
	})
}

func (m *Module) List(ctx context.Context, userID string, p httpx.PageArgs) (httpx.Paginated[listings.Card], error) {
	rows, err := m.d.Pool.Query(ctx, `select `+listings.CardColumns+` from favorites f join listings on listings.id = f.listing_id
		where f.user_id = $1 order by f.created_at desc limit $2 offset $3`, userID, p.Limit, p.Offset)
	if err != nil {
		return httpx.Paginated[listings.Card]{}, err
	}
	defer rows.Close()
	items := []listings.Card{}
	for rows.Next() {
		l, err := listings.ScanCard(rows)
		if err != nil {
			return httpx.Paginated[listings.Card]{}, err
		}
		items = append(items, l.Card())
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[listings.Card]{}, err
	}
	var c int
	if err := m.d.Pool.QueryRow(ctx, `select count(*)::int from favorites where user_id = $1`, userID).Scan(&c); err != nil {
		return httpx.Paginated[listings.Card]{}, err
	}
	return httpx.NewPage(items, c, p.Page, p.PageSize), nil
}

func (m *Module) IDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := m.d.Pool.Query(ctx, `select listing_id from favorites where user_id = $1 order by created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (m *Module) Add(ctx context.Context, userID, listingID string) error {
	var exists bool
	if err := m.d.Pool.QueryRow(ctx, `select exists(select 1 from listings where id = $1)`, listingID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return httpx.NotFound("Listing")
	}
	return db.WithTx(ctx, m.d.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `insert into favorites (user_id, listing_id) values ($1,$2) on conflict do nothing`, userID, listingID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		_, err = tx.Exec(ctx, `update listings set favorites_count = favorites_count + 1, updated_at = now() where id = $1`, listingID)
		return err
	})
}

func (m *Module) Remove(ctx context.Context, userID, listingID string) error {
	return db.WithTx(ctx, m.d.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `delete from favorites where user_id = $1 and listing_id = $2`, userID, listingID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		_, err = tx.Exec(ctx, `update listings set favorites_count = greatest(favorites_count - 1, 0), updated_at = now() where id = $1`, listingID)
		return err
	})
}
