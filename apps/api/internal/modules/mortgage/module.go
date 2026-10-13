// Package mortgage: partner banks and mortgage leads (public form; admin list / status in the admin module).
package mortgage

import (
	"context"
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
)

// Bank is the MortgageBank DTO.
type Bank struct {
	Code                  string  `json:"code"`
	Name                  string  `json:"name"`
	LogoURL               *string `json:"logoUrl"`
	AnnualRate            float64 `json:"annualRate"`
	MaxTermYears          int     `json:"maxTermYears"`
	MinDownPaymentPercent int     `json:"minDownPaymentPercent"`
}

// Banks: partner banks (indicative AZN mortgage terms; leads are forwarded to the bank's mortgage desk).
var Banks = []Bank{
	{Code: "KAPITAL", Name: "Kapital Bank", AnnualRate: 8, MaxTermYears: 25, MinDownPaymentPercent: 15},
	{Code: "PASHA", Name: "PAŞA Bank", AnnualRate: 10.5, MaxTermYears: 20, MinDownPaymentPercent: 20},
	{Code: "ABB", Name: "ABB (Azərbaycan Beynəlxalq Bankı)", AnnualRate: 9, MaxTermYears: 25, MinDownPaymentPercent: 15},
	{Code: "RESPUBLIKA", Name: "Bank Respublika", AnnualRate: 11, MaxTermYears: 20, MinDownPaymentPercent: 20},
	{Code: "UNIBANK", Name: "Unibank", AnnualRate: 12, MaxTermYears: 15, MinDownPaymentPercent: 25},
}

// LeadStatuses are the admin-settable statuses.
var LeadStatuses = []string{"NEW", "SENT_TO_BANK", "CLOSED"}

// Lead is the MortgageLead DTO.
type Lead struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Phone       string  `json:"phone"`
	ListingID   *string `json:"listingId"`
	Price       int     `json:"price"`
	DownPayment int     `json:"downPayment"`
	TermYears   int     `json:"termYears"`
	BankCode    *string `json:"bankCode"`
	Status      string  `json:"status"`
	CreatedAt   string  `json:"createdAt"`
}

const leadColumns = `id, name, phone, listing_id, price, down_payment, term_years, bank_code, status, created_at`

func scanLead(row pgx.Row) (*Lead, error) {
	var l Lead
	var created time.Time
	if err := row.Scan(&l.ID, &l.Name, &l.Phone, &l.ListingID, &l.Price, &l.DownPayment, &l.TermYears, &l.BankCode, &l.Status, &created); err != nil {
		return nil, err
	}
	l.CreatedAt = httpx.ISO(created)
	return &l, nil
}

type Service struct{ d *app.Deps }

func NewService(d *app.Deps) *Service { return &Service{d: d} }

type Module struct {
	d   *app.Deps
	svc *Service
}

func New(d *app.Deps) *Module { return &Module{d: d, svc: NewService(d)} }

func (m *Module) Routes(r chi.Router) {
	r.Get("/mortgage/banks", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) { return Banks, nil }))
	r.Post("/mortgage/leads", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
		b, err := mkt.ReadBody(r)
		if err != nil {
			return nil, err
		}
		in := LeadInput{
			Name:        b.Str("name", mkt.S{Req: true, Trim: true, Min: 2, Max: 80}).V,
			Phone:       b.Str("phone", mkt.S{Req: true, Phone: true}).V,
			ListingID:   b.Str("listingId", mkt.S{Null: true, UUID: true}).Ptr(),
			Price:       b.Int("price", mkt.N{Req: true, Positive: true}).V,
			DownPayment: b.Int("downPayment", mkt.N{Req: true, Min: mkt.F(0)}).V,
			TermYears:   b.Int("termYears", mkt.N{Req: true, Min: mkt.F(1), Max: mkt.F(30)}).V,
			BankCode:    b.Str("bankCode", mkt.S{Null: true}).Ptr(),
		}
		if err := b.Err(); err != nil {
			return nil, err
		}
		var userID *string
		if u := auth.Current(r); u != nil {
			userID = &u.ID
		}
		id, err := m.svc.CreateLead(r.Context(), userID, in)
		if err != nil {
			return nil, err
		}
		return map[string]string{"id": id}, nil
	}))
}

type LeadInput struct {
	Name, Phone                   string
	ListingID, BankCode           *string
	Price, DownPayment, TermYears int
}

func (s *Service) CreateLead(ctx context.Context, userID *string, in LeadInput) (string, error) {
	if in.DownPayment >= in.Price {
		return "", httpx.BadRequest("VALIDATION_ERROR", "downPayment must be less than price")
	}
	if in.BankCode != nil && *in.BankCode != "" {
		ok := false
		for _, b := range Banks {
			ok = ok || b.Code == *in.BankCode
		}
		if !ok {
			return "", httpx.BadRequest("VALIDATION_ERROR", "Unknown bankCode")
		}
	}
	if in.ListingID != nil {
		var exists bool
		if err := s.d.Pool.QueryRow(ctx, `select exists(select 1 from listings where id = $1)`, *in.ListingID).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return "", httpx.NotFound("Listing")
		}
	}
	var id string
	err := s.d.Pool.QueryRow(ctx, `insert into mortgage_leads (user_id, name, phone, listing_id, price, down_payment, term_years, bank_code)
		values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, userID, in.Name, in.Phone, in.ListingID, in.Price, in.DownPayment, in.TermYears, in.BankCode).Scan(&id)
	return id, err
}

// List (admin) pages leads, newest first.
func (s *Service) List(ctx context.Context, status *string, p httpx.PageArgs) (httpx.Paginated[Lead], error) {
	where := sq.And{}
	if status != nil {
		where = append(where, sq.Eq{"status": *status})
	}
	sqlStr, args, err := sq.StatementBuilder.PlaceholderFormat(sq.Dollar).Select(leadColumns).From("mortgage_leads").Where(where).
		OrderBy("created_at desc").Limit(uint64(p.Limit)).Offset(uint64(p.Offset)).ToSql()
	if err != nil {
		return httpx.Paginated[Lead]{}, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[Lead]{}, err
	}
	defer rows.Close()
	items := []Lead{}
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return httpx.Paginated[Lead]{}, err
		}
		items = append(items, *l)
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[Lead]{}, err
	}
	var c int
	cnt, cargs, _ := sq.StatementBuilder.PlaceholderFormat(sq.Dollar).Select("count(*)::int").From("mortgage_leads").Where(where).ToSql()
	if err := s.d.Pool.QueryRow(ctx, cnt, cargs...).Scan(&c); err != nil {
		return httpx.Paginated[Lead]{}, err
	}
	return httpx.NewPage(items, c, p.Page, p.PageSize), nil
}

// SetStatus (admin).
func (s *Service) SetStatus(ctx context.Context, id, status string) (*Lead, error) {
	l, err := scanLead(s.d.Pool.QueryRow(ctx, `update mortgage_leads set status = $2 where id = $1 returning `+leadColumns, id, status))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Mortgage lead")
	}
	return l, err
}
