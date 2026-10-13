package admin

import (
	"context"
	"fmt"
	"net/http"
	"time"

	sq "github.com/Masterminds/squirrel"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/modules/listings"
)

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

type Service struct {
	d        *app.Deps
	listings *listings.Service
}

func unavailable(what string) error {
	return httpx.E(http.StatusServiceUnavailable, "PAYMENT_PROVIDER_UNAVAILABLE", what+" service is not available")
}

// ───────── Listings moderation ─────────

type ListingQuery struct {
	Status, Q, DealType, OwnerID *string
	Reported                     bool
	Page                         httpx.PageArgs
}

func (s *Service) ListListings(ctx context.Context, q ListingQuery) (httpx.Paginated[listings.AdminListing], error) {
	where := sq.And{}
	if q.Status != nil {
		where = append(where, sq.Eq{"listings.status": *q.Status})
	}
	if q.DealType != nil {
		where = append(where, sq.Eq{"listings.deal_type": *q.DealType})
	}
	if q.OwnerID != nil {
		where = append(where, sq.Eq{"listings.owner_id": *q.OwnerID})
	}
	if q.Reported {
		where = append(where, sq.Expr("exists (select 1 from listing_reports r where r.listing_id = listings.id and r.status = 'OPEN')"))
	}
	if q.Q != nil {
		like := "%" + mkt.EscapeLike(*q.Q) + "%"
		where = append(where, sq.Expr(`(listings.id::text = ? or listings.title ilike ? or coalesce(listings.address, '') ilike ? or listings.contact_phone ilike ?)`,
			*q.Q, like, like, like))
	}
	// Moderation queue: oldest first; everything else newest first.
	order := "listings.created_at desc"
	if q.Status != nil && *q.Status == "PENDING" {
		order = "listings.updated_at asc"
	}
	sqlStr, args, err := psql.Select(listings.AdminColumns).From("listings").Where(where).OrderBy(order).
		Limit(uint64(q.Page.Limit)).Offset(uint64(q.Page.Offset)).ToSql()
	if err != nil {
		return httpx.Paginated[listings.AdminListing]{}, err
	}
	items, err := s.queryAdminListings(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[listings.AdminListing]{}, err
	}
	cnt, cargs, _ := psql.Select("count(*)::int").From("listings").Where(where).ToSql()
	var total int
	if err := s.d.Pool.QueryRow(ctx, cnt, cargs...).Scan(&total); err != nil {
		return httpx.Paginated[listings.AdminListing]{}, err
	}
	return httpx.NewPage(items, total, q.Page.Page, q.Page.PageSize), nil
}

func (s *Service) queryAdminListings(ctx context.Context, sqlStr string, args ...any) ([]listings.AdminListing, error) {
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []listings.AdminListing{}
	for rows.Next() {
		l, err := listings.ScanAdmin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l.Admin())
	}
	return out, rows.Err()
}

func (s *Service) AdminListing(ctx context.Context, id string) (*listings.AdminListing, error) {
	l, err := listings.ScanAdmin(s.d.Pool.QueryRow(ctx, `select `+listings.AdminColumns+` from listings where listings.id = $1`, id))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Listing")
	} else if err != nil {
		return nil, err
	}
	a := l.Admin()
	return &a, nil
}

// ListingDetail is ListingDetail & { reports, ownerPhone }.
type ListingDetail struct {
	*listings.Detail
	Reports    []Report `json:"reports"`
	OwnerPhone *string  `json:"ownerPhone"`
}

func (s *Service) ListingDetail(ctx context.Context, id string, admin *auth.User) (*ListingDetail, error) {
	d, err := s.listings.GetDetail(ctx, id, admin, false)
	if err != nil {
		return nil, err
	}
	out := &ListingDetail{Detail: d, Reports: []Report{}}
	rows, err := s.d.Pool.Query(ctx, `select `+reportColumns+` from listing_reports r where r.listing_id = $1 order by r.created_at desc`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		rp, err := scanReport(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out.Reports = append(out.Reports, *rp)
	}
	rows.Close()
	if err := s.d.Pool.QueryRow(ctx, `select phone from users where id = $1`, d.Owner.ID).Scan(&out.OwnerPhone); err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	return out, nil
}

type listingBrief struct{ status, ownerID, title string }

func (s *Service) brief(ctx context.Context, id string) (*listingBrief, error) {
	var b listingBrief
	err := s.d.Pool.QueryRow(ctx, `select status, owner_id, title from listings where id = $1`, id).Scan(&b.status, &b.ownerID, &b.title)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Listing")
	}
	return &b, err
}

func (s *Service) Approve(ctx context.Context, id string, actor *auth.User, ip *string) (*listings.AdminListing, error) {
	b, err := s.brief(ctx, id)
	if err != nil {
		return nil, err
	}
	if b.status == "DRAFT" {
		return nil, httpx.BadRequest("LISTING_NOT_PAID", "Listing fee is not paid yet")
	}
	if b.status != "PENDING" && b.status != "REJECTED" && b.status != "BLOCKED" {
		return nil, httpx.BadRequest("INVALID_STATUS_TRANSITION", fmt.Sprintf("Cannot approve a %s listing", b.status))
	}
	st, err := s.d.Settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if _, err := s.d.Pool.Exec(ctx, `update listings set status = 'ACTIVE', published_at = $2, bumped_at = $2, expires_at = $3,
		rejection_reason = null, updated_at = now() where id = $1`, id, now, mkt.AddDays(now, st.ListingLifetimeDays)); err != nil {
		return nil, err
	}
	s.d.Audit.Log(ctx, &actor.ID, "listing.approve", "listing", &id, map[string]any{"from": b.status}, ip)
	if _, err := s.d.Notify.Notify(ctx, b.ownerID, "LISTING_APPROVED", "Elanınız təsdiqləndi",
		fmt.Sprintf(`"%s" elanı yoxlanıldı və saytda dərc olundu.`, b.title), map[string]any{"listingId": id}); err != nil {
		return nil, err
	}
	return s.AdminListing(ctx, id)
}

func (s *Service) Reject(ctx context.Context, id, reason string, actor *auth.User, ip *string) (*listings.AdminListing, error) {
	b, err := s.brief(ctx, id)
	if err != nil {
		return nil, err
	}
	if b.status != "PENDING" && b.status != "ACTIVE" {
		return nil, httpx.BadRequest("INVALID_STATUS_TRANSITION", fmt.Sprintf("Cannot reject a %s listing", b.status))
	}
	if _, err := s.d.Pool.Exec(ctx, `update listings set status = 'REJECTED', rejection_reason = $2, updated_at = now() where id = $1`, id, reason); err != nil {
		return nil, err
	}
	s.d.Audit.Log(ctx, &actor.ID, "listing.reject", "listing", &id, map[string]any{"reason": reason, "from": b.status}, ip)
	if _, err := s.d.Notify.Notify(ctx, b.ownerID, "LISTING_REJECTED", "Elanınız rədd edildi",
		fmt.Sprintf(`"%s" elanı dərc olunmadı. Səbəb: %s`, b.title, reason), map[string]any{"listingId": id, "reason": reason}); err != nil {
		return nil, err
	}
	return s.AdminListing(ctx, id)
}

func (s *Service) Block(ctx context.Context, id, reason string, actor *auth.User, ip *string) (*listings.AdminListing, error) {
	b, err := s.brief(ctx, id)
	if err != nil {
		return nil, err
	}
	if b.status == "BLOCKED" {
		return nil, httpx.BadRequest("INVALID_STATUS_TRANSITION", "Listing is already blocked")
	}
	if _, err := s.d.Pool.Exec(ctx, `update listings set status = 'BLOCKED', rejection_reason = $2, updated_at = now() where id = $1`, id, reason); err != nil {
		return nil, err
	}
	s.d.Audit.Log(ctx, &actor.ID, "listing.block", "listing", &id, map[string]any{"reason": reason, "from": b.status}, ip)
	if _, err := s.d.Notify.Notify(ctx, b.ownerID, "LISTING_REJECTED", "Elanınız bloklandı",
		fmt.Sprintf(`"%s" elanı qaydaların pozulmasına görə bloklandı. Səbəb: %s`, b.title, reason),
		map[string]any{"listingId": id, "reason": reason, "blocked": true}); err != nil {
		return nil, err
	}
	return s.AdminListing(ctx, id)
}

func (s *Service) UpdateListing(ctx context.Context, id string, in *listings.Input, actor *auth.User, ip *string) (*listings.AdminListing, error) {
	row, err := listings.ScanRow(s.d.Pool.QueryRow(ctx, `select `+listings.Columns+` from listings where listings.id = $1`, id))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Listing")
	} else if err != nil {
		return nil, err
	}
	if err := s.listings.ApplyUpdate(ctx, row, in, []string{row.OwnerID, actor.ID}); err != nil {
		return nil, err
	}
	s.d.Audit.Log(ctx, &actor.ID, "listing.update", "listing", &id, map[string]any{"fields": in.Keys}, ip)
	return s.AdminListing(ctx, id)
}

func (s *Service) Promote(ctx context.Context, id, serviceCode string, actor *auth.User, ip *string) (*listings.AdminListing, error) {
	b, err := s.brief(ctx, id)
	if err != nil {
		return nil, err
	}
	if b.status != "ACTIVE" {
		return nil, httpx.Conflict("LISTING_NOT_ACTIVE", "Only active listings can be promoted")
	}
	svc, err := s.d.Settings.Service(ctx, serviceCode)
	if err != nil {
		return nil, err
	}
	if svc == nil || svc.PromotionType == nil {
		return nil, httpx.BadRequest("INVALID_SERVICE", "Unknown promotion service "+serviceCode)
	}
	if s.d.Promotions == nil {
		return nil, unavailable("Promotions")
	}
	if err := s.d.Promotions.Apply(ctx, s.d.Pool, id, svc.Code, "ADMIN", nil); err != nil {
		return nil, err
	}
	s.d.Audit.Log(ctx, &actor.ID, "listing.promote", "listing", &id, map[string]any{"serviceCode": serviceCode}, ip)
	return s.AdminListing(ctx, id)
}

// ───────── Users ─────────

type UserQuery struct {
	Q, Role, Status, AccountType *string
	Page                         httpx.PageArgs
}

func (s *Service) ListUsers(ctx context.Context, q UserQuery) (httpx.Paginated[AdminUser], error) {
	where := sq.And{}
	if q.Role != nil {
		where = append(where, sq.Eq{"role": *q.Role})
	}
	if q.Status != nil {
		where = append(where, sq.Eq{"status": *q.Status})
	}
	if q.AccountType != nil {
		where = append(where, sq.Eq{"account_type": *q.AccountType})
	}
	if q.Q != nil {
		like := "%" + mkt.EscapeLike(*q.Q) + "%"
		where = append(where, sq.Expr(`(users.id::text = ? or users.name ilike ? or coalesce(users.email, '') ilike ? or coalesce(users.phone, '') ilike ?)`,
			*q.Q, like, like, like))
	}
	sqlStr, args, err := psql.Select(auth.UserColumns, adminUserExtras).From("users").Where(where).OrderBy("created_at desc").
		Limit(uint64(q.Page.Limit)).Offset(uint64(q.Page.Offset)).ToSql()
	if err != nil {
		return httpx.Paginated[AdminUser]{}, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[AdminUser]{}, err
	}
	items := []AdminUser{}
	for rows.Next() {
		u, err := scanAdminUser(rows)
		if err != nil {
			rows.Close()
			return httpx.Paginated[AdminUser]{}, err
		}
		items = append(items, *u)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return httpx.Paginated[AdminUser]{}, err
	}
	cnt, cargs, _ := psql.Select("count(*)::int").From("users").Where(where).ToSql()
	var total int
	if err := s.d.Pool.QueryRow(ctx, cnt, cargs...).Scan(&total); err != nil {
		return httpx.Paginated[AdminUser]{}, err
	}
	return httpx.NewPage(items, total, q.Page.Page, q.Page.PageSize), nil
}

func (s *Service) AdminUser(ctx context.Context, id string) (*AdminUser, error) {
	u, err := scanAdminUser(s.d.Pool.QueryRow(ctx, `select `+auth.UserColumns+`, `+adminUserExtras+` from users where id = $1`, id))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("User")
	}
	return u, err
}

// UserDetail is AdminUser & { listings, payments, walletTransactions }.
type UserDetail struct {
	*AdminUser
	Listings           []listings.AdminListing `json:"listings"`
	Payments           []Payment               `json:"payments"`
	WalletTransactions []WalletTx              `json:"walletTransactions"`
}

func (s *Service) UserDetail(ctx context.Context, id string) (*UserDetail, error) {
	u, err := s.AdminUser(ctx, id)
	if err != nil {
		return nil, err
	}
	out := &UserDetail{AdminUser: u, Payments: []Payment{}, WalletTransactions: []WalletTx{}}
	if out.Listings, err = s.queryAdminListings(ctx, `select `+listings.AdminColumns+` from listings where listings.owner_id = $1
		order by listings.created_at desc limit 100`, id); err != nil {
		return nil, err
	}
	rows, err := s.d.Pool.Query(ctx, `select `+paymentColumns+` from payments where user_id = $1 order by created_at desc limit 100`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		p, err := scanPayment(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out.Payments = append(out.Payments, *p)
	}
	rows.Close()
	rows, err = s.d.Pool.Query(ctx, `select id, type, amount, balance_after, description, payment_id, created_at from wallet_transactions
		where user_id = $1 order by created_at desc limit 100`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t WalletTx
		var created time.Time
		if err := rows.Scan(&t.ID, &t.Type, &t.Amount, &t.BalanceAfter, &t.Description, &t.PaymentID, &created); err != nil {
			return nil, err
		}
		t.CreatedAt = httpx.ISO(created)
		out.WalletTransactions = append(out.WalletTransactions, t)
	}
	return out, rows.Err()
}

type UserUpdate struct {
	Role, Status, Name mkt.Opt[string]
	After              map[string]any
}

func (s *Service) UpdateUser(ctx context.Context, id string, in UserUpdate, actor *auth.User, ip *string) (*AdminUser, error) {
	var role, status, name string
	err := s.d.Pool.QueryRow(ctx, `select role, status, name from users where id = $1`, id).Scan(&role, &status, &name)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("User")
	} else if err != nil {
		return nil, err
	}
	roleChange := in.Role.Ok() && in.Role.V != role
	deactivate := in.Status.Ok() && in.Status.V != "ACTIVE"
	if id == actor.ID && (roleChange || deactivate) {
		return nil, httpx.E(http.StatusForbidden, "CANNOT_MODIFY_SELF", "You cannot change your own role or status")
	}
	set := map[string]any{}
	if in.Role.Ok() {
		set["role"] = in.Role.V
	}
	if in.Status.Ok() {
		set["status"] = in.Status.V
	}
	if in.Name.Ok() {
		set["name"] = in.Name.V
	}
	if len(set) > 0 {
		set["updated_at"] = sq.Expr("now()")
		sqlStr, args, err := psql.Update("users").SetMap(set).Where(sq.Eq{"id": id}).ToSql()
		if err != nil {
			return nil, err
		}
		if _, err := s.d.Pool.Exec(ctx, sqlStr, args...); err != nil {
			return nil, err
		}
	}
	// Role / status changes take effect on the next login: kill refresh sessions.
	if roleChange || deactivate {
		if _, err := s.d.Pool.Exec(ctx, `update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, id); err != nil {
			return nil, err
		}
	}
	s.d.Audit.Log(ctx, &actor.ID, "user.update", "user", &id, map[string]any{
		"before": map[string]any{"role": role, "status": status, "name": name}, "after": in.After}, ip)
	return s.AdminUser(ctx, id)
}

func (s *Service) WalletAdjust(ctx context.Context, id string, amount int, reason string, actor *auth.User, ip *string) (*Wallet, error) {
	var exists bool
	if err := s.d.Pool.QueryRow(ctx, `select exists(select 1 from users where id = $1)`, id).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, httpx.NotFound("User")
	}
	if s.d.Wallet == nil {
		return nil, unavailable("Wallet")
	}
	actorID := actor.ID
	if amount > 0 {
		err := s.d.Wallet.Credit(ctx, s.d.Pool, id, amount, "ADJUSTMENT", reason, app.WalletOpts{ActorID: &actorID})
		if err != nil {
			return nil, err
		}
	} else {
		err := s.d.Wallet.Debit(ctx, s.d.Pool, id, -amount, reason, app.WalletOpts{ActorID: &actorID, TxType: "ADJUSTMENT", Source: "REAL_ONLY"})
		if err != nil {
			return nil, err
		}
	}
	s.d.Audit.Log(ctx, &actor.ID, "wallet.adjust", "user", &id, map[string]any{"amount": amount, "reason": reason}, ip)
	if _, err := s.d.Pool.Exec(ctx, `insert into wallets (user_id) values ($1) on conflict do nothing`, id); err != nil {
		return nil, err
	}
	var w Wallet
	err := s.d.Pool.QueryRow(ctx, `select balance, bonus_balance, currency from wallets where user_id = $1`, id).Scan(&w.Balance, &w.BonusBalance, &w.Currency)
	return &w, err
}

// ───────── Reports ─────────

func (s *Service) Reports(ctx context.Context, status *string, p httpx.PageArgs) (httpx.Paginated[Report], error) {
	where := sq.And{}
	if status != nil {
		where = append(where, sq.Eq{"r.status": *status})
	}
	sqlStr, args, err := psql.Select(reportColumns).From("listing_reports r").Where(where).OrderBy("r.created_at desc").
		Limit(uint64(p.Limit)).Offset(uint64(p.Offset)).ToSql()
	if err != nil {
		return httpx.Paginated[Report]{}, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[Report]{}, err
	}
	items := []Report{}
	for rows.Next() {
		rp, err := scanReport(rows)
		if err != nil {
			rows.Close()
			return httpx.Paginated[Report]{}, err
		}
		items = append(items, *rp)
	}
	rows.Close()
	cnt, cargs, _ := psql.Select("count(*)::int").From("listing_reports r").Where(where).ToSql()
	var total int
	if err := s.d.Pool.QueryRow(ctx, cnt, cargs...).Scan(&total); err != nil {
		return httpx.Paginated[Report]{}, err
	}
	return httpx.NewPage(items, total, p.Page, p.PageSize), nil
}

func (s *Service) ResolveReport(ctx context.Context, id, status string, actor *auth.User, ip *string) (*Report, error) {
	tag, err := s.d.Pool.Exec(ctx, `update listing_reports set status = $2, resolved_by_id = $3, resolved_at = now() where id = $1`, id, status, actor.ID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, httpx.NotFound("Report")
	}
	s.d.Audit.Log(ctx, &actor.ID, "report."+lower(status), "report", &id, map[string]any{}, ip)
	return scanReport(s.d.Pool.QueryRow(ctx, `select `+reportColumns+` from listing_reports r where r.id = $1`, id))
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// ───────── Audit log ─────────

func (s *Service) AuditLogs(ctx context.Context, entity, actorID *string, p httpx.PageArgs) (httpx.Paginated[AuditLog], error) {
	where := sq.And{}
	if entity != nil {
		where = append(where, sq.Eq{"a.entity": *entity})
	}
	if actorID != nil {
		where = append(where, sq.Eq{"a.actor_id": *actorID})
	}
	sqlStr, args, err := psql.Select("a.id, a.actor_id, u.name, a.action, a.entity, a.entity_id, a.data, a.ip, a.created_at").
		From("audit_logs a").LeftJoin("users u on u.id = a.actor_id").Where(where).OrderBy("a.created_at desc").
		Limit(uint64(p.Limit)).Offset(uint64(p.Offset)).ToSql()
	if err != nil {
		return httpx.Paginated[AuditLog]{}, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[AuditLog]{}, err
	}
	items := []AuditLog{}
	err = func() error {
		defer rows.Close()
		for rows.Next() {
			var a AuditLog
			var actorID, actorName *string
			var created time.Time
			if err := rows.Scan(&a.ID, &actorID, &actorName, &a.Action, &a.Entity, &a.EntityID, &a.Data, &a.IP, &created); err != nil {
				return err
			}
			if actorID != nil {
				name := ""
				if actorName != nil {
					name = *actorName
				}
				a.Actor = &NamedRef{ID: *actorID, Name: name}
			}
			if a.Data == nil {
				a.Data = map[string]any{}
			}
			a.CreatedAt = httpx.ISO(created)
			items = append(items, a)
		}
		return rows.Err()
	}()
	if err != nil {
		return httpx.Paginated[AuditLog]{}, err
	}
	cnt, cargs, _ := psql.Select("count(*)::int").From("audit_logs a").Where(where).ToSql()
	var total int
	if err := s.d.Pool.QueryRow(ctx, cnt, cargs...).Scan(&total); err != nil {
		return httpx.Paginated[AuditLog]{}, err
	}
	return httpx.NewPage(items, total, p.Page, p.PageSize), nil
}
