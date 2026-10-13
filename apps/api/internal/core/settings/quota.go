package settings

import (
	"context"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// ListingQuota DTO (Me.quota).
type ListingQuota struct {
	FreeLimit  int `json:"freeLimit"`
	Used       int `json:"used"`
	Remaining  int `json:"remaining"` // -1 = unlimited
	ListingFee int `json:"listingFee"`
}

// SubscriptionRow is a row of the subscriptions table.
type SubscriptionRow struct {
	ID                 string
	UserID             string
	AgencyID           *string
	PlanCode           string
	Period             string
	Status             string
	AutoRenew          bool
	CurrentPeriodStart time.Time
	CurrentPeriodEnd   time.Time
	BumpsLeft          int
	VipCreditsLeft     int
	PremiumCreditsLeft int
	CardToken          *string
	CardMask           *string
	RenewalAttempts    int
	LastPaymentID      *string
	CreatedAt          time.Time
}

// SubscriptionColumns selects every SubscriptionRow field in ScanSubscription order.
const SubscriptionColumns = `id, user_id, agency_id, plan_code, period, status, auto_renew, current_period_start, current_period_end,
	bumps_left, vip_credits_left, premium_credits_left, card_token, card_mask, renewal_attempts, last_payment_id, created_at`

func ScanSubscription(row interface{ Scan(...any) error }) (*SubscriptionRow, error) {
	var s SubscriptionRow
	err := row.Scan(&s.ID, &s.UserID, &s.AgencyID, &s.PlanCode, &s.Period, &s.Status, &s.AutoRenew, &s.CurrentPeriodStart, &s.CurrentPeriodEnd,
		&s.BumpsLeft, &s.VipCreditsLeft, &s.PremiumCreditsLeft, &s.CardToken, &s.CardMask, &s.RenewalAttempts, &s.LastPaymentID, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// SubscriptionUsage / Subscription DTOs (types.ts).
type SubscriptionUsage struct {
	ActiveListings     int `json:"activeListings"`
	ListingQuota       int `json:"listingQuota"`
	BumpsLeft          int `json:"bumpsLeft"`
	VipCreditsLeft     int `json:"vipCreditsLeft"`
	PremiumCreditsLeft int `json:"premiumCreditsLeft"`
}
type Subscription struct {
	ID                 string            `json:"id"`
	PlanCode           string            `json:"planCode"`
	Period             string            `json:"period"`
	Status             string            `json:"status"`
	AutoRenew          bool              `json:"autoRenew"`
	CurrentPeriodStart string            `json:"currentPeriodStart"`
	CurrentPeriodEnd   string            `json:"currentPeriodEnd"`
	Usage              SubscriptionUsage `json:"usage"`
	CardMask           *string           `json:"cardMask"`
}

// ActiveSubscription returns the user's (or their agency's) subscription that is ACTIVE/CANCELLED and not yet ended.
func (s *Service) ActiveSubscription(ctx context.Context, q db.Querier, userID string, agencyID *string) (*SubscriptionRow, error) {
	row := q.QueryRow(ctx, `select `+SubscriptionColumns+` from subscriptions
		where (user_id = $1 or ($2::uuid is not null and agency_id = $2)) and status in ('ACTIVE','CANCELLED') and current_period_end > now()
		order by current_period_end desc limit 1`, userID, agencyID)
	sub, err := ScanSubscription(row)
	if db.IsNoRows(err) {
		return nil, nil
	}
	return sub, err
}

// CountBusinessActive counts ACTIVE+PENDING listings of the agency (or the user when no agency).
func (s *Service) CountBusinessActive(ctx context.Context, q db.Querier, userID string, agencyID *string) (int, error) {
	var n int
	var err error
	if agencyID != nil {
		err = q.QueryRow(ctx, `select count(*) from listings where agency_id = $1 and status in ('ACTIVE','PENDING')`, *agencyID).Scan(&n)
	} else {
		err = q.QueryRow(ctx, `select count(*) from listings where owner_id = $1 and status in ('ACTIVE','PENDING')`, userID).Scan(&n)
	}
	return n, err
}

// Quota implements the listing quota rules (docs/BUSINESS_MODEL.md):
//   - business user with an active subscription: plan.listingQuota simultaneous ACTIVE+PENDING listings (-1 = unlimited)
//   - everyone else: freeListingsPerMonth free SALE/RENT_LONG listings per rolling 30 days (RENT_DAILY is free)
func (s *Service) Quota(ctx context.Context, q db.Querier, userID string, agencyID *string) (ListingQuota, error) {
	st, err := s.Settings(ctx)
	if err != nil {
		return ListingQuota{}, err
	}
	sub, err := s.ActiveSubscription(ctx, q, userID, agencyID)
	if err != nil {
		return ListingQuota{}, err
	}
	if sub != nil {
		plan, err := s.Plan(ctx, sub.PlanCode)
		if err != nil {
			return ListingQuota{}, err
		}
		limit := 0
		if plan != nil {
			limit = plan.ListingQuota
		}
		used, err := s.CountBusinessActive(ctx, q, userID, agencyID)
		if err != nil {
			return ListingQuota{}, err
		}
		rem := -1
		if limit >= 0 {
			rem = max(0, limit-used)
		}
		return ListingQuota{FreeLimit: limit, Used: used, Remaining: rem, ListingFee: st.ListingFee}, nil
	}
	var used int
	err = q.QueryRow(ctx, `select count(*) from listings where owner_id = $1 and is_free_quota and deal_type <> 'RENT_DAILY'
		and created_at > now() - interval '30 days' and status not in ('DRAFT','REJECTED')`, userID).Scan(&used)
	if err != nil {
		return ListingQuota{}, err
	}
	return ListingQuota{FreeLimit: st.FreeListingsPerMonth, Used: used, Remaining: max(0, st.FreeListingsPerMonth-used), ListingFee: st.ListingFee}, nil
}

// SubscriptionDTO maps a subscription row to the API DTO.
func (s *Service) SubscriptionDTO(ctx context.Context, q db.Querier, sub *SubscriptionRow) (*Subscription, error) {
	plan, err := s.Plan(ctx, sub.PlanCode)
	if err != nil {
		return nil, err
	}
	active, err := s.CountBusinessActive(ctx, q, sub.UserID, sub.AgencyID)
	if err != nil {
		return nil, err
	}
	quota := 0
	if plan != nil {
		quota = plan.ListingQuota
	}
	return &Subscription{
		ID: sub.ID, PlanCode: sub.PlanCode, Period: sub.Period, Status: sub.Status, AutoRenew: sub.AutoRenew,
		CurrentPeriodStart: httpx.ISO(sub.CurrentPeriodStart), CurrentPeriodEnd: httpx.ISO(sub.CurrentPeriodEnd),
		Usage:    SubscriptionUsage{ActiveListings: active, ListingQuota: quota, BumpsLeft: sub.BumpsLeft, VipCreditsLeft: sub.VipCreditsLeft, PremiumCreditsLeft: sub.PremiumCreditsLeft},
		CardMask: sub.CardMask,
	}, nil
}
