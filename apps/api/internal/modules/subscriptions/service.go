package subscriptions

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// MaxRenewalAttempts: after this many failed renewal attempts a PAST_DUE subscription expires.
const MaxRenewalAttempts = 3

const day = 24 * time.Hour

// AddPeriod is calendar-aware period arithmetic in UTC (Jan 31 + 1 month → Feb 28/29). Pure — exported for tests.
func AddPeriod(d time.Time, period string, n int) time.Time {
	t := d.UTC()
	months := n
	if period == "YEAR" {
		months = 12 * n
	}
	y, m, dd := t.Date()
	last := time.Date(y, m+time.Month(months)+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return time.Date(y, m+time.Month(months), min(dd, last), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
}

type planCredits struct{ bumps, vip, premium int }

func credits(p *shared.PlanDef) planCredits {
	if p == nil {
		return planCredits{}
	}
	return planCredits{p.MonthlyBumps, p.MonthlyVipCredits, p.MonthlyPremiumCredits}
}

func fmtDate(t time.Time) string { return t.UTC().Format("2006-01-02") }

// Service implements business subscriptions: fulfilment of SUBSCRIPTION payments, user endpoints and renewals.
type Service struct {
	pool     *pgxpool.Pool
	settings *settings.Service
	notify   *notify.Service
	payments *payments.Service
	running  atomic.Bool
}

func NewService(d *app.Deps) *Service {
	s := &Service{pool: d.Pool, settings: d.Settings, notify: d.Notify, payments: payments.Engine(d)}
	s.payments.RegisterHandler("SUBSCRIPTION", &payments.PurposeHandler{
		Fulfil: s.fulfil,
		Reverse: func(ctx context.Context, tx pgx.Tx, p *payments.Row, amount int, _ payments.RefundCtx) (payments.FulfilResult, error) {
			// Full refund of the payment that paid the current period → the subscription ends now.
			if p.RefundedAmount+amount < p.Amount {
				return payments.FulfilResult{}, nil
			}
			_, err := tx.Exec(ctx, `update subscriptions set status = 'EXPIRED', auto_renew = false, current_period_end = now(), updated_at = now()
				where last_payment_id = $1 and status in ('ACTIVE','CANCELLED','PAST_DUE')`, p.ID)
			return payments.FulfilResult{}, err
		},
	})
	return s
}

// ───────────────────────────── Fulfilment ─────────────────────────────

// fulfil (SUBSCRIPTION paid): renew / extend / create the subscription, grant plan credits, user becomes BUSINESS.
func (s *Service) fulfil(ctx context.Context, tx pgx.Tx, p *payments.Row) (payments.FulfilResult, error) {
	planCode := payments.MetaString(p.Metadata, "planCode")
	period := payments.MetaString(p.Metadata, "period")
	plan, err := s.settings.Plan(ctx, planCode)
	if err != nil {
		return payments.FulfilResult{}, err
	}
	now := time.Now()
	var agencyID *string
	if err := tx.QueryRow(ctx, `select agency_id from users where id = $1`, p.UserID).Scan(&agencyID); err != nil && !db.IsNoRows(err) {
		return payments.FulfilResult{}, err
	}
	var cardToken, cardMask *string
	if p.Method == "CARD" && p.CardToken != nil {
		cardToken, cardMask = p.CardToken, p.CardMask
	}
	c := credits(plan)

	if payments.MetaBool(p.Metadata, "renewal", false) && payments.MetaString(p.Metadata, "subscriptionId") != "" {
		sub, err := settings.ScanSubscription(tx.QueryRow(ctx, `select `+settings.SubscriptionColumns+` from subscriptions where id = $1 for update`,
			payments.MetaString(p.Metadata, "subscriptionId")))
		if db.IsNoRows(err) {
			return payments.FulfilResult{RefundReason: "Abunəlik tapılmadı"}, nil
		}
		if err != nil {
			return payments.FulfilResult{}, err
		}
		if sub.LastPaymentID != nil && *sub.LastPaymentID == p.ID {
			return payments.FulfilResult{}, nil // already applied
		}
		start := sub.CurrentPeriodEnd
		if sub.Status == "PAST_DUE" || sub.CurrentPeriodEnd.Before(now.Add(-day)) {
			start = now
		}
		end := AddPeriod(start, period, 1)
		_, err = tx.Exec(ctx, `update subscriptions set status = 'ACTIVE', current_period_start = $2, current_period_end = $3, bumps_left = $4,
			vip_credits_left = $5, premium_credits_left = $6, credits_reset_at = $2, renewal_attempts = 0, last_renewal_attempt_at = null,
			last_payment_id = $7, card_token = coalesce($8, card_token), card_mask = case when $8::text is null then card_mask else $9 end, updated_at = now()
			where id = $1`, sub.ID, start, end, c.bumps, c.vip, c.premium, p.ID, cardToken, cardMask)
		if err != nil {
			return payments.FulfilResult{}, err
		}
		name := planCode
		if plan != nil {
			name = plan.Name.Az
		}
		userID, subID := p.UserID, sub.ID
		return payments.FulfilResult{After: func(ctx context.Context) error {
			_, err := s.notify.Notify(ctx, userID, "SUBSCRIPTION_RENEWED", "Abunəlik yeniləndi",
				fmt.Sprintf("%s planı %s tarixinədək uzadıldı.", name, fmtDate(end)), map[string]any{"subscriptionId": subID})
			return err
		}}, nil
	}

	existing, err := settings.ScanSubscription(tx.QueryRow(ctx, `select `+settings.SubscriptionColumns+` from subscriptions
		where user_id = $1 and status in ('ACTIVE','CANCELLED','PAST_DUE') order by current_period_end desc limit 1 for update`, p.UserID))
	if db.IsNoRows(err) {
		existing, err = nil, nil
	}
	if err != nil {
		return payments.FulfilResult{}, err
	}
	autoRenew := payments.MetaBool(p.Metadata, "autoRenew", true)
	status := "CANCELLED"
	if autoRenew {
		status = "ACTIVE"
	}

	if existing != nil && existing.PlanCode == planCode && existing.Period == period && existing.Status != "PAST_DUE" && existing.CurrentPeriodEnd.After(now) {
		// Same plan bought again → extend the period and add one period of credits.
		end := AddPeriod(existing.CurrentPeriodEnd, period, 1)
		_, err = tx.Exec(ctx, `update subscriptions set status = $2, auto_renew = $3, current_period_end = $4, last_payment_id = $5,
			card_token = coalesce($6, card_token), card_mask = case when $6::text is null then card_mask else $7 end,
			bumps_left = bumps_left + $8, vip_credits_left = vip_credits_left + $9, premium_credits_left = premium_credits_left + $10, updated_at = now()
			where id = $1`, existing.ID, status, autoRenew, end, p.ID, cardToken, cardMask, c.bumps, c.vip, c.premium)
		if err != nil {
			return payments.FulfilResult{}, err
		}
	} else {
		// New plan (or plan change): the previous subscription ends now (no proration in the MVP).
		if existing != nil {
			if _, err := tx.Exec(ctx, `update subscriptions set status = 'EXPIRED', auto_renew = false, current_period_end = $2, updated_at = now() where id = $1`,
				existing.ID, now); err != nil {
				return payments.FulfilResult{}, err
			}
		}
		_, err = tx.Exec(ctx, `insert into subscriptions (user_id, agency_id, plan_code, period, status, auto_renew, current_period_start,
			current_period_end, bumps_left, vip_credits_left, premium_credits_left, credits_reset_at, card_token, card_mask, last_payment_id)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$7,$12,$13,$14)`,
			p.UserID, agencyID, planCode, period, status, autoRenew, now, AddPeriod(now, period, 1), c.bumps, c.vip, c.premium, cardToken, cardMask, p.ID)
		if err != nil {
			return payments.FulfilResult{}, err
		}
	}
	_, err = tx.Exec(ctx, `update users set account_type = 'BUSINESS', updated_at = now() where id = $1`, p.UserID)
	return payments.FulfilResult{}, err
}

// ───────────────────────────── User endpoints ─────────────────────────────

func (s *Service) current(ctx context.Context, userID string) (*settings.SubscriptionRow, error) {
	sub, err := settings.ScanSubscription(s.pool.QueryRow(ctx, `select `+settings.SubscriptionColumns+` from subscriptions
		where user_id = $1 and status in ('ACTIVE','CANCELLED','PAST_DUE') order by current_period_end desc limit 1`, userID))
	if db.IsNoRows(err) {
		return nil, nil
	}
	return sub, err
}

// Me returns the own subscription, or the agency's one for agency members (nil when none).
func (s *Service) Me(ctx context.Context, userID string) (*settings.Subscription, error) {
	sub, err := s.current(ctx, userID)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		var agencyID *string
		if err := s.pool.QueryRow(ctx, `select agency_id from users where id = $1`, userID).Scan(&agencyID); err != nil && !db.IsNoRows(err) {
			return nil, err
		}
		if agencyID != nil {
			if sub, err = s.settings.ActiveSubscription(ctx, s.pool, userID, agencyID); err != nil {
				return nil, err
			}
		}
	}
	if sub == nil {
		return nil, nil
	}
	return s.settings.SubscriptionDTO(ctx, s.pool, sub)
}

// Cancel turns auto-renew off (stays active until the period end).
func (s *Service) Cancel(ctx context.Context, userID string) (*settings.Subscription, error) {
	sub, err := s.current(ctx, userID)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return nil, httpx.NotFound("Subscription")
	}
	status := sub.Status
	if status == "ACTIVE" {
		status = "CANCELLED"
	}
	u, err := settings.ScanSubscription(s.pool.QueryRow(ctx, `update subscriptions set auto_renew = false, status = $2, updated_at = now() where id = $1 returning `+
		settings.SubscriptionColumns, sub.ID, status))
	if err != nil {
		return nil, err
	}
	return s.settings.SubscriptionDTO(ctx, s.pool, u)
}

// Resume turns auto-renew back on.
func (s *Service) Resume(ctx context.Context, userID string) (*settings.Subscription, error) {
	sub, err := s.current(ctx, userID)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return nil, httpx.NotFound("Subscription")
	}
	if sub.Status == "CANCELLED" && !sub.CurrentPeriodEnd.After(time.Now()) {
		return nil, httpx.E(http.StatusConflict, "SUBSCRIPTION_ENDED", "Subscription period has ended")
	}
	status := sub.Status
	if status == "CANCELLED" {
		status = "ACTIVE"
	}
	u, err := settings.ScanSubscription(s.pool.QueryRow(ctx, `update subscriptions set auto_renew = true, status = $2, updated_at = now() where id = $1 returning `+
		settings.SubscriptionColumns, sub.ID, status))
	if err != nil {
		return nil, err
	}
	return s.settings.SubscriptionDTO(ctx, s.pool, u)
}

type adminUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Phone *string `json:"phone"`
	Email *string `json:"email"`
}

type adminAgency struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Slug     string  `json:"slug"`
	LogoURL  *string `json:"logoUrl"`
	Type     string  `json:"type"`
	Verified bool    `json:"verified"`
}

type adminSubscription struct {
	settings.Subscription
	User            adminUser    `json:"user"`
	Agency          *adminAgency `json:"agency"`
	RenewalAttempts int          `json:"renewalAttempts"`
	CreatedAt       string       `json:"createdAt"`
}

const subColumnsAs = `s.id, s.user_id, s.agency_id, s.plan_code, s.period, s.status, s.auto_renew, s.current_period_start, s.current_period_end,
	s.bumps_left, s.vip_credits_left, s.premium_credits_left, s.card_token, s.card_mask, s.renewal_attempts, s.last_payment_id, s.created_at`

// AdminList implements GET /admin/subscriptions.
func (s *Service) AdminList(ctx context.Context, status *string, pg httpx.PageArgs) (httpx.Paginated[adminSubscription], error) {
	rows, err := s.pool.Query(ctx, `select `+subColumnsAs+`, u.id, u.name, u.phone, u.email, a.id, a.name, a.slug, a.logo_url, a.type, a.verified
		from subscriptions s join users u on u.id = s.user_id left join agencies a on a.id = s.agency_id
		where ($1::text is null or s.status = $1) order by s.created_at desc limit $2 offset $3`, status, pg.Limit, pg.Offset)
	if err != nil {
		return httpx.Paginated[adminSubscription]{}, err
	}
	type rec struct {
		sub   *settings.SubscriptionRow
		user  adminUser
		agID  *string
		agNm  *string
		agSl  *string
		agLg  *string
		agTy  *string
		agVer *bool
	}
	var recs []rec
	for rows.Next() {
		var r rec
		var sr settings.SubscriptionRow
		if err := rows.Scan(&sr.ID, &sr.UserID, &sr.AgencyID, &sr.PlanCode, &sr.Period, &sr.Status, &sr.AutoRenew, &sr.CurrentPeriodStart, &sr.CurrentPeriodEnd,
			&sr.BumpsLeft, &sr.VipCreditsLeft, &sr.PremiumCreditsLeft, &sr.CardToken, &sr.CardMask, &sr.RenewalAttempts, &sr.LastPaymentID, &sr.CreatedAt,
			&r.user.ID, &r.user.Name, &r.user.Phone, &r.user.Email, &r.agID, &r.agNm, &r.agSl, &r.agLg, &r.agTy, &r.agVer); err != nil {
			rows.Close()
			return httpx.Paginated[adminSubscription]{}, err
		}
		r.sub = &sr
		recs = append(recs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return httpx.Paginated[adminSubscription]{}, err
	}
	items := make([]adminSubscription, 0, len(recs))
	for _, r := range recs {
		dto, err := s.settings.SubscriptionDTO(ctx, s.pool, r.sub)
		if err != nil {
			return httpx.Paginated[adminSubscription]{}, err
		}
		it := adminSubscription{Subscription: *dto, User: r.user, RenewalAttempts: r.sub.RenewalAttempts, CreatedAt: httpx.ISO(r.sub.CreatedAt)}
		if r.agID != nil {
			it.Agency = &adminAgency{ID: *r.agID, Name: *r.agNm, Slug: *r.agSl, LogoURL: r.agLg, Type: *r.agTy, Verified: *r.agVer}
		}
		items = append(items, it)
	}
	var total int
	if err := s.pool.QueryRow(ctx, `select count(*) from subscriptions where ($1::text is null or status = $1)`, status).Scan(&total); err != nil {
		return httpx.Paginated[adminSubscription]{}, err
	}
	return httpx.NewPage(items, total, pg.Page, pg.PageSize), nil
}

// ───────────────────────────── Cron ─────────────────────────────

// RenewalStats is the result of ProcessRenewals.
type RenewalStats struct{ Expired, Renewed, Failed int }

// ProcessRenewals (hourly): (1) non-renewing subscriptions past their end → EXPIRED; (2) auto-renew at period end —
// saved card token (or wallet when no token) → extend + reset credits + SUBSCRIPTION_RENEWED; failure → PAST_DUE,
// retried once a day, EXPIRED after 3 failed attempts; (3) yearly plans get their monthly credits reset every month.
func (s *Service) ProcessRenewals(ctx context.Context, now time.Time) (RenewalStats, error) {
	var st RenewalStats
	if !s.running.CompareAndSwap(false, true) {
		return st, nil
	}
	defer s.running.Store(false)

	rows, err := s.pool.Query(ctx, `update subscriptions set status = 'EXPIRED', updated_at = now()
		where status in ('ACTIVE','CANCELLED','PAST_DUE') and auto_renew = false and current_period_end <= $1 returning `+settings.SubscriptionColumns, now)
	if err != nil {
		return st, err
	}
	var ended []*settings.SubscriptionRow
	for rows.Next() {
		sub, err := settings.ScanSubscription(rows)
		if err != nil {
			rows.Close()
			return st, err
		}
		ended = append(ended, sub)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return st, err
	}
	for _, sub := range ended {
		st.Expired++
		s.onExpired(ctx, sub)
	}

	ids, err := s.ids(ctx, `select id from subscriptions where status in ('ACTIVE','PAST_DUE') and auto_renew = true and current_period_end <= $1
		and (last_renewal_attempt_at is null or last_renewal_attempt_at <= $2) limit 500`, now, now.Add(-day+5*time.Minute))
	if err != nil {
		return st, err
	}
	for _, id := range ids {
		r, err := s.Renew(ctx, id, now)
		if err != nil {
			slog.Error("subscription renewal", "subscriptionId", id, "err", err)
			continue
		}
		if r == "RENEWED" {
			st.Renewed++
		} else if r != "" {
			st.Failed++
		}
	}

	rows, err = s.pool.Query(ctx, `select id, plan_code, coalesce(credits_reset_at, current_period_start) from subscriptions
		where status in ('ACTIVE','CANCELLED') and period = 'YEAR' and current_period_end > $1`, now)
	if err != nil {
		return st, err
	}
	type yearly struct {
		id, plan string
		last     time.Time
	}
	var ys []yearly
	for rows.Next() {
		var y yearly
		if err := rows.Scan(&y.id, &y.plan, &y.last); err != nil {
			rows.Close()
			return st, err
		}
		ys = append(ys, y)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return st, err
	}
	for _, y := range ys {
		next := AddPeriod(y.last, "MONTH", 1)
		if next.After(now) {
			continue
		}
		plan, err := s.settings.Plan(ctx, y.plan)
		if err != nil {
			return st, err
		}
		c := credits(plan)
		if _, err := s.pool.Exec(ctx, `update subscriptions set bumps_left = $2, vip_credits_left = $3, premium_credits_left = $4, credits_reset_at = $5,
			updated_at = now() where id = $1`, y.id, c.bumps, c.vip, c.premium, next); err != nil {
			return st, err
		}
	}
	return st, nil
}

func (s *Service) ids(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// Renew makes one renewal attempt. Returns RENEWED / PAST_DUE / EXPIRED, or "" when the subscription was not due.
func (s *Service) Renew(ctx context.Context, subscriptionID string, now time.Time) (string, error) {
	// Claim the attempt (row lock, skip if another worker holds it).
	var sub *settings.SubscriptionRow
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		row, err := settings.ScanSubscription(tx.QueryRow(ctx, `select `+settings.SubscriptionColumns+` from subscriptions where id = $1 for update skip locked`, subscriptionID))
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if (row.Status != "ACTIVE" && row.Status != "PAST_DUE") || !row.AutoRenew || row.CurrentPeriodEnd.After(now) {
			return nil
		}
		sub, err = settings.ScanSubscription(tx.QueryRow(ctx, `update subscriptions set last_renewal_attempt_at = $2, renewal_attempts = $3, updated_at = now()
			where id = $1 returning `+settings.SubscriptionColumns, row.ID, now, row.RenewalAttempts+1))
		return err
	})
	if err != nil || sub == nil {
		return "", err
	}

	plan, err := s.settings.Plan(ctx, sub.PlanCode)
	if err != nil {
		return "", err
	}
	failure := "Plan artıq mövcud deyil"
	if plan != nil && plan.Active {
		amount := shared.PlanPrice(*plan, sub.Period)
		description := plan.Name.Az + " abunəliyinin yenilənməsi"
		base := payments.StartInput{
			UserID: sub.UserID, Purpose: "SUBSCRIPTION", Amount: amount, Description: description,
			Items:    []payments.Item{{Code: plan.Code + "_" + sub.Period, Name: description, Amount: amount}},
			Metadata: map[string]any{"planCode": plan.Code, "period": sub.Period, "autoRenew": true, "renewal": true, "subscriptionId": sub.ID},
		}
		var perr error
		if sub.CardToken != nil {
			p, err := s.payments.ChargeSavedCard(ctx, base, *sub.CardToken)
			if err == nil && p.Status == "SUCCEEDED" {
				return "RENEWED", nil
			}
			perr = err
			if err == nil {
				failure = "Kartdan ödəniş alınmadı"
				if p.FailureReason != nil {
					failure = *p.FailureReason
				}
			}
		} else {
			base.Method = "WALLET"
			if _, err := s.payments.StartPayment(ctx, base); err == nil {
				return "RENEWED", nil
			} else {
				perr = err
			}
		}
		if perr != nil {
			var ae *httpx.AppError
			if errors.As(perr, &ae) && ae.Code == "INSUFFICIENT_FUNDS" {
				failure = "Balansda kifayət qədər vəsait yoxdur"
			} else if errors.As(perr, &ae) {
				failure = fmt.Sprint(ae.Message)
			} else {
				failure = perr.Error()
			}
			if sub.CardToken == nil {
				if _, err := s.notify.Notify(ctx, sub.UserID, "PAYMENT_FAILED", "Abunəlik yenilənmədi",
					fmt.Sprintf("%s: %s. Balansınızı artırın.", description, failure), map[string]any{"subscriptionId": sub.ID}); err != nil {
					slog.Error("notify", "err", err)
				}
			}
		}
	}

	expire := sub.RenewalAttempts >= MaxRenewalAttempts || plan == nil || !plan.Active
	status := "PAST_DUE"
	if expire {
		status = "EXPIRED"
	}
	u, err := settings.ScanSubscription(s.pool.QueryRow(ctx, `update subscriptions set status = $2, updated_at = now()
		where id = $1 and status in ('ACTIVE','PAST_DUE') and current_period_end <= $3 returning `+settings.SubscriptionColumns, sub.ID, status, now))
	if db.IsNoRows(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	slog.Warn("subscription renewal failed", "subscriptionId", sub.ID, "attempt", sub.RenewalAttempts, "reason", failure)
	if expire {
		s.onExpired(ctx, u)
	}
	return status, nil
}

func (s *Service) onExpired(ctx context.Context, sub *settings.SubscriptionRow) {
	wallet.RunEffects(ctx, []wallet.Effect{
		func(ctx context.Context) error {
			_, err := s.notify.Notify(ctx, sub.UserID, "SUBSCRIPTION_EXPIRED", "Abunəliyin müddəti bitdi",
				"Biznes abunəliyinizin müddəti başa çatdı. Üstünlüklərdən istifadəni davam etdirmək üçün abunəliyi yeniləyin.", map[string]any{"subscriptionId": sub.ID})
			return err
		},
		func(ctx context.Context) error {
			// Back to INDIVIDUAL unless the user still has another active subscription or belongs to an agency.
			var agencyID *string
			if err := s.pool.QueryRow(ctx, `select agency_id from users where id = $1`, sub.UserID).Scan(&agencyID); err != nil && !db.IsNoRows(err) {
				return err
			}
			if agencyID != nil {
				return nil
			}
			active, err := s.settings.ActiveSubscription(ctx, s.pool, sub.UserID, nil)
			if err != nil || active != nil {
				return err
			}
			_, err = s.pool.Exec(ctx, `update users set account_type = 'INDIVIDUAL', updated_at = now() where id = $1`, sub.UserID)
			return err
		},
	})
}
