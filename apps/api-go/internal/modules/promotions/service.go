package promotions

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
)

// Promotion sources (listing_promotions.source).
const (
	SourcePayment = "PAYMENT"
	SourceCredit  = "CREDIT"
	SourceAdmin   = "ADMIN"
)

// UntilColumn is the listing column holding the "active until" timestamp of each timed promotion type.
var UntilColumn = map[string]string{
	"AUTO_BUMP": "auto_bump_until",
	"VIP":       "vip_until",
	"PREMIUM":   "premium_until",
	"HIGHLIGHT": "highlight_until",
	"URGENT":    "urgent_until",
}

// untilOrder fixes the iteration order (Object.entries order of the former UNTIL_COLUMN) for notification texts.
var untilOrder = []string{"AUTO_BUMP", "VIP", "PREMIUM", "HIGHLIGHT", "URGENT"}

var promoNameAz = map[string]string{
	"AUTO_BUMP": "Avto-qaldırma", "VIP": "VIP", "PREMIUM": "Premium", "HIGHLIGHT": "Rəngli fon", "URGENT": `"Təcili" nişanı`,
}

// CreditService maps a subscription credit to the catalog service applied with it.
var CreditService = map[string]string{"BUMP": "BUMP_1", "VIP_7": "VIP_7", "PREMIUM_7": "PREMIUM_7"}

var creditColumn = map[string]string{"BUMP": "bumps_left", "VIP_7": "vip_credits_left", "PREMIUM_7": "premium_credits_left"}

// ExtendUntil is the stacking rule: a new period starts at max(now, current end). Pure — exported for tests.
func ExtendUntil(current *time.Time, days int, now time.Time) time.Time {
	start := now
	if current != nil && current.After(now) {
		start = *current
	}
	return wallet.AddDays(start, days)
}

// Service applies paid / credit / admin promotions and runs the promotion crons. Implements app.PromotionsAPI.
type Service struct {
	pool     db.Querier
	settings *settings.Service
	notify   *notify.Service

	runningExpire, runningAutoBump atomic.Bool
}

var _ app.PromotionsAPI = (*Service)(nil)

func NewService(d *app.Deps) *Service {
	return &Service{pool: d.Pool, settings: d.Settings, notify: d.Notify}
}

// Apply applies a catalog service to a listing (locks the listing row).
// BUMP → bumped_at = now · AUTO_BUMP → auto_bump_until extended + immediate bump ·
// VIP / PREMIUM / HIGHLIGHT / URGENT → *_until = max(now, current) + durationDays (purchases stack).
func (s *Service) Apply(ctx context.Context, q db.Querier, listingID, serviceCode, source string, paymentID *string) error {
	svc, err := s.settings.Service(ctx, serviceCode) // inactive services still apply (already paid)
	if err != nil {
		return err
	}
	if svc == nil || svc.PromotionType == nil {
		return httpx.BadRequest("INVALID_SERVICE", fmt.Sprintf("Service %s is not a listing promotion", serviceCode))
	}
	typ := *svc.PromotionType
	if q == nil {
		q = s.pool
	}
	return db.WithTx(ctx, q, func(tx pgx.Tx) error {
		l, err := GetListing(ctx, tx, listingID, true)
		if err != nil {
			return err
		}
		if l == nil {
			return httpx.NotFound("Listing")
		}
		now := time.Now()
		var endsAt *time.Time
		if typ == "BUMP" {
			if _, err := tx.Exec(ctx, `update listings set bumped_at = $2, updated_at = now() where id = $1`, listingID, now); err != nil {
				return err
			}
		} else {
			col, ok := UntilColumn[typ]
			if !ok {
				return httpx.BadRequest("INVALID_SERVICE", "Unknown promotion type "+typ)
			}
			end := ExtendUntil(untilValue(l, typ), svc.DurationDays, now)
			endsAt = &end
			// col comes from the fixed UntilColumn whitelist.
			if typ == "AUTO_BUMP" {
				_, err = tx.Exec(ctx, `update listings set `+col+` = $2, bumped_at = $3, updated_at = now() where id = $1`, listingID, end, now)
			} else {
				_, err = tx.Exec(ctx, `update listings set `+col+` = $2, updated_at = now() where id = $1`, listingID, end)
			}
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `insert into listing_promotions (listing_id, type, service_code, starts_at, ends_at, payment_id, source) values ($1,$2,$3,$4,$5,$6,$7)`,
			listingID, typ, serviceCode, now, endsAt, paymentID, source)
		return err
	})
}

func untilValue(l *ListingRow, typ string) *time.Time {
	switch typ {
	case "AUTO_BUMP":
		return l.AutoBumpUntil
	case "VIP":
		return l.VipUntil
	case "PREMIUM":
		return l.PremiumUntil
	case "HIGHLIGHT":
		return l.HighlightUntil
	case "URGENT":
		return l.UrgentUntil
	}
	return nil
}

// ApplyCredit (POST /listings/:id/apply-credit) spends one subscription credit of the owner (or their agency).
func (s *Service) ApplyCredit(ctx context.Context, userID, listingID, credit string) (*MyListing, error) {
	l, err := GetListing(ctx, s.pool, listingID, false)
	if err != nil {
		return nil, err
	}
	if l == nil {
		return nil, httpx.NotFound("Listing")
	}
	if l.OwnerID != userID {
		return nil, httpx.Forbidden("Not your listing")
	}
	if l.Status != "ACTIVE" && l.Status != "PENDING" {
		return nil, httpx.E(http.StatusConflict, "LISTING_NOT_ACTIVE", "Only active or pending listings can be promoted")
	}
	var agencyID *string
	if err := s.pool.QueryRow(ctx, `select agency_id from users where id = $1`, userID).Scan(&agencyID); err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	sub, err := s.settings.ActiveSubscription(ctx, s.pool, userID, agencyID)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return nil, httpx.E(http.StatusPaymentRequired, "NO_SUBSCRIPTION", "An active business subscription is required")
	}
	col := creditColumn[credit] // validated by the handler (enum)
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var left int
		err := tx.QueryRow(ctx, `select `+col+` from subscriptions where id = $1 for update`, sub.ID).Scan(&left)
		if err != nil && !db.IsNoRows(err) {
			return err
		}
		if db.IsNoRows(err) || left <= 0 {
			return httpx.E(http.StatusPaymentRequired, "NO_CREDITS", "No credits left for this period")
		}
		if _, err := tx.Exec(ctx, `update subscriptions set `+col+` = $2, updated_at = now() where id = $1`, sub.ID, left-1); err != nil {
			return err
		}
		return s.Apply(ctx, tx, listingID, CreditService[credit], SourceCredit, nil)
	})
	if err != nil {
		return nil, err
	}
	fresh, err := GetListing(ctx, s.pool, listingID, false)
	if err != nil {
		return nil, err
	}
	if fresh == nil {
		return nil, httpx.NotFound("Listing")
	}
	return ToMyListing(ctx, s.pool, fresh)
}

// ExpirePromotions (cron, 10 min) clears past *_until columns and notifies the owner once (the column is nulled,
// so never twice). Returns the number of listings whose owner was notified.
func (s *Service) ExpirePromotions(ctx context.Context, now time.Time) (int, error) {
	if !s.runningExpire.CompareAndSwap(false, true) {
		return 0, nil
	}
	defer s.runningExpire.Store(false)
	var conds []string
	for _, t := range untilOrder {
		conds = append(conds, fmt.Sprintf("(%s is not null and %s <= $1)", UntilColumn[t], UntilColumn[t]))
	}
	rows, err := s.pool.Query(ctx, `select id from listings where `+strings.Join(conds, " or ")+` limit 1000`, now)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var effects []wallet.Effect
	for _, id := range ids {
		err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
			l, err := ScanListing(tx.QueryRow(ctx, `select `+ListingColumns+` from listings where id = $1 for update skip locked`, id))
			if db.IsNoRows(err) {
				return nil
			}
			if err != nil {
				return err
			}
			var sets, expired []string
			for _, t := range untilOrder {
				if v := untilValue(l, t); v != nil && !v.After(now) {
					sets = append(sets, UntilColumn[t]+" = null")
					expired = append(expired, promoNameAz[t])
				}
			}
			if len(expired) == 0 {
				return nil
			}
			if _, err := tx.Exec(ctx, `update listings set `+strings.Join(sets, ", ")+`, updated_at = now() where id = $1`, id); err != nil {
				return err
			}
			owner, title := l.OwnerID, l.Title
			text := fmt.Sprintf(`"%s" elanı üçün %s xidmətinin müddəti başa çatdı. Elanınızı yenidən irəli çəkə bilərsiniz.`, title, strings.Join(expired, ", "))
			effects = append(effects, func(ctx context.Context) error {
				_, err := s.notify.Notify(ctx, owner, "PROMOTION_EXPIRED", "Reklam xidmətinin müddəti bitdi", text, map[string]any{"listingId": id})
				return err
			})
			return nil
		})
		if err != nil {
			return len(effects), err
		}
	}
	wallet.RunEffects(ctx, effects)
	return len(effects), nil
}

// AutoBump (cron, hourly): AUTO_BUMP — bump active listings once every 24 h while auto_bump_until is in the future.
func (s *Service) AutoBump(ctx context.Context, now time.Time) (int, error) {
	if !s.runningAutoBump.CompareAndSwap(false, true) {
		return 0, nil
	}
	defer s.runningAutoBump.Store(false)
	tag, err := s.pool.Exec(ctx, `update listings set bumped_at = $1, updated_at = now()
		where status = 'ACTIVE' and auto_bump_until > $1 and bumped_at < $2`, now, now.Add(-24*time.Hour+time.Minute))
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
