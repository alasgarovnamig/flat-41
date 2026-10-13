// Package stats: admin dashboard KPIs (GET /admin/stats/overview) and marketplace time series (listings, users).
// The revenue series (GET /admin/stats/revenue) belongs to the payments module.
package stats

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

const (
	// net revenue of a payment row (succeeded or partially refunded)
	net = `case when status in ('SUCCEEDED','PARTIALLY_REFUNDED') then amount - refunded_amount else 0 end`
	// recognised revenue: excludes WALLET_TOPUP (customer balance is a liability until spent)
	rev    = `case when status in ('SUCCEEDED','PARTIALLY_REFUNDED') and purpose <> 'WALLET_TOPUP' then amount - refunded_amount else 0 end`
	paidAt = `coalesce(paid_at, created_at)`
)

type Overview struct {
	Users struct {
		Total    int `json:"total"`
		NewToday int `json:"newToday"`
		New30d   int `json:"new30d"`
		Business int `json:"business"`
	} `json:"users"`
	Listings struct {
		Active   int `json:"active"`
		Pending  int `json:"pending"`
		Total    int `json:"total"`
		NewToday int `json:"newToday"`
	} `json:"listings"`
	Revenue struct {
		Today        int            `json:"today"`
		Last30d      int            `json:"last30d"`
		Total        int            `json:"total"`
		ByPurpose30d map[string]int `json:"byPurpose30d"`
	} `json:"revenue"`
	Payments struct {
		Succeeded30d int `json:"succeeded30d"`
		Failed30d    int `json:"failed30d"`
	} `json:"payments"`
	Bookings struct {
		Confirmed int `json:"confirmed"`
		Upcoming  int `json:"upcoming"`
		Gmv30d    int `json:"gmv30d"`
	} `json:"bookings"`
	Subscriptions struct {
		Active int `json:"active"`
		Mrr    int `json:"mrr"`
	} `json:"subscriptions"`
	Reports struct {
		Open int `json:"open"`
	} `json:"reports"`
}

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module { return &Module{d: d} }

func (m *Module) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(auth.Roles("MODERATOR"))
		r.Get("/admin/stats/overview", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			return m.Overview(r.Context())
		}))
		r.Get("/admin/stats/listings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			q := httpx.Q(r)
			days := mkt.QDays(q)
			if err := q.Err(); err != nil {
				return nil, err
			}
			return m.Listings(r.Context(), days)
		}))
		r.Get("/admin/stats/users", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			q := httpx.Q(r)
			days := mkt.QDays(q)
			if err := q.Err(); err != nil {
				return nil, err
			}
			return m.Users(r.Context(), days)
		}))
	})
}

func (m *Module) Overview(ctx context.Context) (*Overview, error) {
	o := &Overview{}
	p := m.d.Pool
	if err := p.QueryRow(ctx, `select count(*) filter (where status <> 'DELETED')::int,
			count(*) filter (where created_at >= date_trunc('day', now()))::int,
			count(*) filter (where created_at >= now() - interval '30 days')::int,
			count(*) filter (where account_type = 'BUSINESS' and status <> 'DELETED')::int
		from users`).Scan(&o.Users.Total, &o.Users.NewToday, &o.Users.New30d, &o.Users.Business); err != nil {
		return nil, err
	}
	if err := p.QueryRow(ctx, `select count(*) filter (where status = 'ACTIVE')::int, count(*) filter (where status = 'PENDING')::int,
			count(*)::int, count(*) filter (where created_at >= date_trunc('day', now()))::int
		from listings`).Scan(&o.Listings.Active, &o.Listings.Pending, &o.Listings.Total, &o.Listings.NewToday); err != nil {
		return nil, err
	}
	if err := p.QueryRow(ctx, `select coalesce(sum(`+rev+`) filter (where `+paidAt+` >= date_trunc('day', now())), 0)::int,
			coalesce(sum(`+rev+`) filter (where `+paidAt+` >= now() - interval '30 days'), 0)::int,
			coalesce(sum(`+rev+`), 0)::int,
			count(*) filter (where status in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') and created_at >= now() - interval '30 days')::int,
			count(*) filter (where status = 'FAILED' and created_at >= now() - interval '30 days')::int
		from payments`).Scan(&o.Revenue.Today, &o.Revenue.Last30d, &o.Revenue.Total, &o.Payments.Succeeded30d, &o.Payments.Failed30d); err != nil {
		return nil, err
	}
	o.Revenue.ByPurpose30d = map[string]int{}
	for _, pp := range shared.Enum.PaymentPurposes {
		o.Revenue.ByPurpose30d[pp] = 0
	}
	rows, err := p.Query(ctx, `select purpose, coalesce(sum(`+net+`), 0)::int from payments where `+paidAt+` >= now() - interval '30 days' group by purpose`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var purpose string
		var amount int
		if err := rows.Scan(&purpose, &amount); err != nil {
			rows.Close()
			return nil, err
		}
		if _, ok := o.Revenue.ByPurpose30d[purpose]; ok {
			o.Revenue.ByPurpose30d[purpose] = amount
		}
	}
	rows.Close()
	if err := p.QueryRow(ctx, `select count(*) filter (where status = 'CONFIRMED')::int,
			count(*) filter (where status = 'CONFIRMED' and check_in >= current_date)::int,
			coalesce(sum(total) filter (where status in ('CONFIRMED','COMPLETED') and created_at >= now() - interval '30 days'), 0)::int
		from bookings`).Scan(&o.Bookings.Confirmed, &o.Bookings.Upcoming, &o.Bookings.Gmv30d); err != nil {
		return nil, err
	}
	if err := p.QueryRow(ctx, `select count(*)::int,
			coalesce(sum(case when s.period = 'YEAR' then p.price_yearly / 12.0 else p.price_monthly end), 0)::int
		from subscriptions s join plans p on p.code = s.plan_code
		where s.status in ('ACTIVE','CANCELLED') and s.current_period_end > now()`).Scan(&o.Subscriptions.Active, &o.Subscriptions.Mrr); err != nil {
		return nil, err
	}
	if err := p.QueryRow(ctx, `select count(*)::int from listing_reports where status = 'OPEN'`).Scan(&o.Reports.Open); err != nil {
		return nil, err
	}
	return o, nil
}

// ListingsPoint: value = created, plus published / rejected (rejections dated by updatedAt).
type ListingsPoint struct {
	Date      string `json:"date"`
	Value     int    `json:"value"`
	Created   int    `json:"created"`
	Published int    `json:"published"`
	Rejected  int    `json:"rejected"`
}

func (m *Module) Listings(ctx context.Context, days int) ([]ListingsPoint, error) {
	rows, err := m.d.Pool.Query(ctx, `
		with d as (select generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date as day)
		select to_char(d.day, 'YYYY-MM-DD'),
			(select count(*) from listings l where l.created_at >= d.day and l.created_at < d.day + 1)::int,
			(select count(*) from listings l where l.published_at >= d.day and l.published_at < d.day + 1)::int,
			(select count(*) from listings l where l.status = 'REJECTED' and l.updated_at >= d.day and l.updated_at < d.day + 1)::int
		from d order by d.day`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ListingsPoint{}
	for rows.Next() {
		var p ListingsPoint
		if err := rows.Scan(&p.Date, &p.Created, &p.Published, &p.Rejected); err != nil {
			return nil, err
		}
		p.Value = p.Created
		out = append(out, p)
	}
	return out, rows.Err()
}

type Point struct {
	Date  string `json:"date"`
	Value int    `json:"value"`
}

func (m *Module) Users(ctx context.Context, days int) ([]Point, error) {
	rows, err := m.d.Pool.Query(ctx, `
		with d as (select generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date as day)
		select to_char(d.day, 'YYYY-MM-DD'), (select count(*) from users u where u.created_at >= d.day and u.created_at < d.day + 1)::int
		from d order by d.day`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Point{}
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.Date, &p.Value); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
