package agencies

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// DefaultMaxAgents: agents allowed without an active subscription (= the owner alone).
const DefaultMaxAgents = 1

// Row is a row of the agencies table.
type Row struct {
	ID          string
	OwnerID     string
	Name        string
	Slug        string
	Type        string
	Description *string
	LogoURL     *string
	Phone       *string
	Email       *string
	Website     *string
	Address     *string
	CityID      *string
	Verified    bool
	CreatedAt   time.Time
}

// Columns selects every Row field (qualified with "agencies.") in Scan order.
const Columns = `agencies.id, agencies.owner_id, agencies.name, agencies.slug, agencies.type, agencies.description, agencies.logo_url,
	agencies.phone, agencies.email, agencies.website, agencies.address, agencies.city_id, agencies.verified, agencies.created_at`

// activeCount is the correlated "ACTIVE listings of the agency" subquery.
const activeCount = `(select count(*)::int from listings l where l.agency_id = agencies.id and l.status = 'ACTIVE')`

func Scan(row pgx.Row, extra ...any) (*Row, error) {
	var a Row
	dest := []any{&a.ID, &a.OwnerID, &a.Name, &a.Slug, &a.Type, &a.Description, &a.LogoURL, &a.Phone, &a.Email, &a.Website, &a.Address,
		&a.CityID, &a.Verified, &a.CreatedAt}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, err
	}
	return &a, nil
}

// Summary is the AgencySummary DTO.
type Summary struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Slug     string  `json:"slug"`
	LogoURL  *string `json:"logoUrl"`
	Type     string  `json:"type"`
	Verified bool    `json:"verified"`
}

// Agency is the Agency DTO.
type Agency struct {
	Summary
	Description    *string `json:"description"`
	Phone          *string `json:"phone"`
	Email          *string `json:"email"`
	Website        *string `json:"website"`
	Address        *string `json:"address"`
	CityID         *string `json:"cityId"`
	OwnerID        string  `json:"ownerId"`
	ActiveListings int     `json:"activeListings"`
	CreatedAt      string  `json:"createdAt"`
}

// Member is the AgencyMember DTO.
type Member struct {
	UserID         string  `json:"userId"`
	Name           string  `json:"name"`
	Phone          *string `json:"phone"`
	Email          *string `json:"email"`
	AvatarURL      *string `json:"avatarUrl"`
	Role           string  `json:"role"`
	ActiveListings int     `json:"activeListings"`
	JoinedAt       string  `json:"joinedAt"`
}

func (a *Row) Summary() Summary {
	return Summary{ID: a.ID, Name: a.Name, Slug: a.Slug, LogoURL: a.LogoURL, Type: a.Type, Verified: a.Verified}
}

func (a *Row) DTO(active int) Agency {
	return Agency{Summary: a.Summary(), Description: a.Description, Phone: a.Phone, Email: a.Email, Website: a.Website, Address: a.Address,
		CityID: a.CityID, OwnerID: a.OwnerID, ActiveListings: active, CreatedAt: httpx.ISO(a.CreatedAt)}
}

// SummaryByID returns the agency summary or nil when it does not exist.
func SummaryByID(ctx context.Context, q db.Querier, id string) (*Summary, error) {
	a, err := Scan(q.QueryRow(ctx, `select `+Columns+` from agencies where id = $1`, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s := a.Summary()
	return &s, nil
}

type Service struct{ d *app.Deps }

func NewService(d *app.Deps) *Service { return &Service{d: d} }

// ListQuery: public list (type, cityId, q) and admin list (q, verified).
type ListQuery struct {
	Type, CityID, Q *string
	Verified        *bool
	Page, PageSize  int
}

func (s *Service) List(ctx context.Context, q ListQuery) (httpx.Paginated[Agency], error) {
	where := sq.And{}
	if q.Type != nil {
		where = append(where, sq.Eq{"agencies.type": *q.Type})
	}
	if q.CityID != nil {
		where = append(where, sq.Eq{"agencies.city_id": *q.CityID})
	}
	if q.Verified != nil {
		where = append(where, sq.Eq{"agencies.verified": *q.Verified})
	}
	if q.Q != nil {
		where = append(where, sq.Expr("agencies.name ILIKE ?", "%"+mkt.EscapeLike(*q.Q)+"%"))
	}
	sel := psql.Select(Columns, activeCount+" as active").From("agencies").Where(where).
		OrderBy("agencies.verified DESC", activeCount+" DESC", "agencies.name ASC").
		Limit(uint64(q.PageSize)).Offset(uint64((q.Page - 1) * q.PageSize))
	sqlStr, args, err := sel.ToSql()
	if err != nil {
		return httpx.Paginated[Agency]{}, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[Agency]{}, err
	}
	defer rows.Close()
	items := []Agency{}
	for rows.Next() {
		var active int
		a, err := Scan(rows, &active)
		if err != nil {
			return httpx.Paginated[Agency]{}, err
		}
		items = append(items, a.DTO(active))
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[Agency]{}, err
	}
	cnt, args, err := psql.Select("count(*)::int").From("agencies").Where(where).ToSql()
	if err != nil {
		return httpx.Paginated[Agency]{}, err
	}
	var total int
	if err := s.d.Pool.QueryRow(ctx, cnt, args...).Scan(&total); err != nil {
		return httpx.Paginated[Agency]{}, err
	}
	return httpx.NewPage(items, total, q.Page, q.PageSize), nil
}

func (s *Service) toDTO(ctx context.Context, a *Row) (*Agency, error) {
	var c int
	if err := s.d.Pool.QueryRow(ctx, `select count(*)::int from listings where agency_id = $1 and status = 'ACTIVE'`, a.ID).Scan(&c); err != nil {
		return nil, err
	}
	dto := a.DTO(c)
	return &dto, nil
}

func (s *Service) BySlug(ctx context.Context, slug string) (*Agency, error) {
	a, err := Scan(s.d.Pool.QueryRow(ctx, `select `+Columns+` from agencies where slug = $1`, slug))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Agency")
	} else if err != nil {
		return nil, err
	}
	return s.toDTO(ctx, a)
}

func (s *Service) uniqueSlug(ctx context.Context, name string) (string, error) {
	base := shared.Slugify(name)
	if base == "" {
		base = "agency"
	}
	rows, err := s.d.Pool.Query(ctx, `select slug from agencies where slug = $1 or slug like $2`, base, base+"-%")
	if err != nil {
		return "", err
	}
	taken := map[string]bool{}
	for rows.Next() {
		var sl string
		if err := rows.Scan(&sl); err != nil {
			rows.Close()
			return "", err
		}
		taken[sl] = true
	}
	rows.Close()
	if !taken[base] {
		return base, nil
	}
	for i := 2; ; i++ {
		if c := fmt.Sprintf("%s-%d", base, i); !taken[c] {
			return c, nil
		}
	}
}

// Input is the AgencyInput body (all fields optional for PATCH).
type Input struct {
	Name, Type                                                   mkt.Opt[string]
	Description, Phone, Email, Website, Address, CityID, LogoURL mkt.Opt[string]
}

// ParseInput validates agencySchema (partial when patch=true).
func ParseInput(b *mkt.Body, patch bool) Input {
	req := !patch
	return Input{
		Name:        b.Str("name", mkt.S{Req: req, Trim: true, Min: 2, Max: 120}),
		Type:        b.Str("type", mkt.S{Req: req, Enum: []string{"AGENCY", "DEVELOPER"}}),
		Description: b.Str("description", mkt.S{Null: true, Max: 5000}),
		Phone:       b.Str("phone", mkt.S{Null: true, Phone: true}),
		Email:       b.Str("email", mkt.S{Null: true, Email: true}),
		Website:     b.Str("website", mkt.S{Null: true, URL: true}),
		Address:     b.Str("address", mkt.S{Null: true, Max: 200}),
		CityID:      b.Str("cityId", mkt.S{Null: true}),
		LogoURL:     b.Str("logoUrl", mkt.S{Null: true, URL: true}),
	}
}

func (s *Service) Create(ctx context.Context, userID string, in Input) (*Agency, error) {
	var agencyID, phone, email *string
	err := s.d.Pool.QueryRow(ctx, `select agency_id, phone, email from users where id = $1`, userID).Scan(&agencyID, &phone, &email)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("User")
	} else if err != nil {
		return nil, err
	}
	if agencyID != nil {
		return nil, httpx.Conflict("ALREADY_IN_AGENCY", "You already belong to an agency")
	}
	slug, err := s.uniqueSlug(ctx, in.Name.V)
	if err != nil {
		return nil, err
	}
	if p := in.Phone.Ptr(); p != nil {
		phone = p
	}
	if e := in.Email.Ptr(); e != nil {
		email = e
	}
	var a *Row
	err = db.WithTx(ctx, s.d.Pool, func(tx pgx.Tx) error {
		var e error
		a, e = Scan(tx.QueryRow(ctx, `insert into agencies (owner_id, name, slug, type, description, logo_url, phone, email, website, address, city_id)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning `+Columns,
			userID, in.Name.V, slug, in.Type.V, in.Description.Ptr(), in.LogoURL.Ptr(), phone, email, in.Website.Ptr(), in.Address.Ptr(), in.CityID.Ptr()))
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `insert into agency_members (agency_id, user_id, role) values ($1,$2,'OWNER')`, a.ID, userID); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `update users set account_type = 'BUSINESS', agency_id = $2, updated_at = now() where id = $1`, userID, a.ID); e != nil {
			return e
		}
		// The owner's live listings now appear under the agency.
		_, e = tx.Exec(ctx, `update listings set agency_id = $2, updated_at = now() where owner_id = $1 and status in ('DRAFT','PENDING','ACTIVE','EXPIRED')`, userID, a.ID)
		return e
	})
	if err != nil {
		return nil, err
	}
	return s.toDTO(ctx, a)
}

// MyAgency returns the caller's agency (any member) or 404 NO_AGENCY.
func (s *Service) MyAgency(ctx context.Context, userID string) (*Row, string, error) {
	var role string
	a, err := Scan(s.d.Pool.QueryRow(ctx, `select `+Columns+`, m.role from agency_members m join agencies on agencies.id = m.agency_id
		where m.user_id = $1 limit 1`, userID), &role)
	if db.IsNoRows(err) {
		return nil, "", httpx.E(http.StatusNotFound, "NO_AGENCY", "You are not a member of an agency")
	}
	return a, role, err
}

func (s *Service) ownedAgency(ctx context.Context, userID string) (*Row, error) {
	a, role, err := s.MyAgency(ctx, userID)
	if err != nil {
		return nil, err
	}
	if a.OwnerID != userID && role != "OWNER" {
		return nil, httpx.Forbidden("Only the agency owner can do this")
	}
	return a, nil
}

func (s *Service) GetMine(ctx context.Context, userID string) (*Agency, error) {
	a, _, err := s.MyAgency(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.toDTO(ctx, a)
}

func (s *Service) UpdateMine(ctx context.Context, userID string, in Input) (*Agency, error) {
	a, err := s.ownedAgency(ctx, userID)
	if err != nil {
		return nil, err
	}
	set := map[string]any{}
	add := func(col string, o mkt.Opt[string]) {
		if o.Present {
			set[col] = o.Ptr()
		}
	}
	if in.Name.Ok() {
		set["name"] = in.Name.V
	}
	if in.Type.Ok() {
		set["type"] = in.Type.V
	}
	add("description", in.Description)
	add("phone", in.Phone)
	add("email", in.Email)
	add("website", in.Website)
	add("address", in.Address)
	add("city_id", in.CityID)
	add("logo_url", in.LogoURL)
	if len(set) == 0 {
		return s.toDTO(ctx, a)
	}
	set["updated_at"] = sq.Expr("now()")
	sqlStr, args, err := psql.Update("agencies").SetMap(set).Where(sq.Eq{"id": a.ID}).Suffix("returning " + Columns).ToSql()
	if err != nil {
		return nil, err
	}
	row, err := Scan(s.d.Pool.QueryRow(ctx, sqlStr, args...))
	if err != nil {
		return nil, err
	}
	return s.toDTO(ctx, row)
}

func (s *Service) Members(ctx context.Context, userID string) ([]Member, error) {
	a, err := s.ownedAgency(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.memberList(ctx, a.ID)
}

func (s *Service) memberList(ctx context.Context, agencyID string) ([]Member, error) {
	rows, err := s.d.Pool.Query(ctx, `select u.id, u.name, u.phone, u.email, u.avatar_url, m.role,
			(select count(*)::int from listings l where l.owner_id = u.id and l.status = 'ACTIVE'), m.created_at
		from agency_members m join users u on u.id = m.user_id where m.agency_id = $1
		order by case when m.role = 'OWNER' then 0 else 1 end, m.created_at asc`, agencyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		var joined time.Time
		if err := rows.Scan(&m.UserID, &m.Name, &m.Phone, &m.Email, &m.AvatarURL, &m.Role, &m.ActiveListings, &joined); err != nil {
			return nil, err
		}
		m.JoinedAt = httpx.ISO(joined)
		out = append(out, m)
	}
	return out, rows.Err()
}

// MaxAgents: plan.maxAgents of the owner's / agency's active subscription, else DefaultMaxAgents.
func (s *Service) MaxAgents(ctx context.Context, ownerID, agencyID string) (int, error) {
	sub, err := s.d.Settings.ActiveSubscription(ctx, s.d.Pool, ownerID, &agencyID)
	if err != nil || sub == nil {
		return DefaultMaxAgents, err
	}
	plan, err := s.d.Settings.Plan(ctx, sub.PlanCode)
	if err != nil || plan == nil {
		return DefaultMaxAgents, err
	}
	return plan.MaxAgents, nil
}

func normalizeLogin(login string) string {
	if strings.Contains(login, "@") {
		return strings.ToLower(strings.TrimSpace(login))
	}
	v := strings.NewReplacer(" ", "", "\t", "", "\n", "", "(", "", ")", "", "-", "").Replace(login)
	if len(v) == 10 && strings.HasPrefix(v, "0") && isDigits(v[1:]) {
		v = "+994" + v[1:]
	}
	return v
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}

func (s *Service) AddMember(ctx context.Context, userID, login string) (*Member, error) {
	a, err := s.ownedAgency(ctx, userID)
	if err != nil {
		return nil, err
	}
	norm := normalizeLogin(login)
	var targetID, status string
	var targetAgency *string
	err = s.d.Pool.QueryRow(ctx, `select id, status, agency_id from users where email = $1 or phone = $1 limit 1`, norm).Scan(&targetID, &status, &targetAgency)
	if db.IsNoRows(err) || (err == nil && status != "ACTIVE") {
		return nil, httpx.E(http.StatusNotFound, "USER_NOT_FOUND", "No active user with this phone or email")
	} else if err != nil {
		return nil, err
	}
	if targetAgency != nil && *targetAgency == a.ID {
		return nil, httpx.Conflict("ALREADY_MEMBER", "User is already a member")
	}
	if targetAgency != nil {
		return nil, httpx.Conflict("ALREADY_IN_AGENCY", "User belongs to another agency")
	}
	var c int
	if err := s.d.Pool.QueryRow(ctx, `select count(*)::int from agency_members where agency_id = $1`, a.ID).Scan(&c); err != nil {
		return nil, err
	}
	maxAgents, err := s.MaxAgents(ctx, a.OwnerID, a.ID)
	if err != nil {
		return nil, err
	}
	if c >= maxAgents {
		return nil, httpx.E(http.StatusForbidden, "AGENT_LIMIT_REACHED", fmt.Sprintf("Your plan allows %d member(s). Upgrade the subscription to add more agents.", maxAgents))
	}
	err = db.WithTx(ctx, s.d.Pool, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `insert into agency_members (agency_id, user_id, role) values ($1,$2,'AGENT')`, a.ID, targetID); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `update users set agency_id = $2, account_type = 'BUSINESS', updated_at = now() where id = $1`, targetID, a.ID); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, `update listings set agency_id = $2, updated_at = now() where owner_id = $1 and status in ('DRAFT','PENDING','ACTIVE','EXPIRED')`, targetID, a.ID)
		return e
	})
	if err != nil {
		return nil, err
	}
	members, err := s.memberList(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	for i := range members {
		if members[i].UserID == targetID {
			return &members[i], nil
		}
	}
	return nil, httpx.NotFound("Member")
}

func (s *Service) RemoveMember(ctx context.Context, userID, memberID string) error {
	a, err := s.ownedAgency(ctx, userID)
	if err != nil {
		return err
	}
	if memberID == a.OwnerID {
		return httpx.BadRequest("CANNOT_REMOVE_OWNER", "The agency owner cannot be removed")
	}
	deleted := false
	err = db.WithTx(ctx, s.d.Pool, func(tx pgx.Tx) error {
		tag, e := tx.Exec(ctx, `delete from agency_members where agency_id = $1 and user_id = $2`, a.ID, memberID)
		if e != nil || tag.RowsAffected() == 0 {
			return e
		}
		deleted = true
		if _, e = tx.Exec(ctx, `update users set agency_id = null, account_type = 'INDIVIDUAL', updated_at = now() where id = $1`, memberID); e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `update listings set agency_id = null, updated_at = now() where owner_id = $1 and agency_id = $2`, memberID, a.ID)
		return e
	})
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.NotFound("Member")
	}
	return nil
}

// Point is a TimeseriesPoint of the agency stats.
type Point struct {
	Date       string `json:"date"`
	Value      int    `json:"value"`
	Views      int    `json:"views"`
	PhoneViews int    `json:"phoneViews"`
	Messages   int    `json:"messages"`
}

type Stats struct {
	Views      int     `json:"views"`
	PhoneViews int     `json:"phoneViews"`
	Messages   int     `json:"messages"`
	Listings   int     `json:"listings"`
	Daily      []Point `json:"daily"`
}

func (s *Service) Stats(ctx context.Context, userID string, days int) (*Stats, error) {
	a, _, err := s.MyAgency(ctx, userID)
	if err != nil {
		return nil, err
	}
	since := mkt.YMD(mkt.AddDays(time.Now(), -(days - 1)))
	rows, err := s.d.Pool.Query(ctx, `
		select to_char(d, 'YYYY-MM-DD') as date,
			coalesce((select sum(s.views) from listing_daily_stats s join listings l on l.id = s.listing_id where l.agency_id = $1 and s.date = d::date), 0)::int,
			coalesce((select sum(s.phone_views) from listing_daily_stats s join listings l on l.id = s.listing_id where l.agency_id = $1 and s.date = d::date), 0)::int,
			(select count(*) from messages m join conversations c on c.id = m.conversation_id join listings l on l.id = c.listing_id
				where l.agency_id = $1 and m.sender_id <> c.seller_id and m.created_at >= d and m.created_at < d + interval '1 day')::int
		from generate_series($2::date, current_date, interval '1 day') d
		order by d`, a.ID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Stats{Daily: []Point{}}
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.Date, &p.Views, &p.PhoneViews, &p.Messages); err != nil {
			return nil, err
		}
		p.Value = p.Views
		out.Views += p.Views
		out.PhoneViews += p.PhoneViews
		out.Messages += p.Messages
		out.Daily = append(out.Daily, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.d.Pool.QueryRow(ctx, `select count(*)::int from listings where agency_id = $1 and status = 'ACTIVE'`, a.ID).Scan(&out.Listings); err != nil {
		return nil, err
	}
	return out, nil
}

// SetVerified (admin) toggles the verified badge.
func (s *Service) SetVerified(ctx context.Context, id string, verified bool) (*Agency, error) {
	a, err := Scan(s.d.Pool.QueryRow(ctx, `update agencies set verified = $2, updated_at = now() where id = $1 returning `+Columns, id, verified))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Agency")
	} else if err != nil {
		return nil, err
	}
	return s.toDTO(ctx, a)
}
