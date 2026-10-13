package payments

import (
	"context"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
)

// listingFallback is a MINIMAL app.ListingsAPI used ONLY while d.Listings is nil, i.e. in the money worktree before
// the marketplace workstream (internal/modules/listings) is merged, and in this package's tests. It is a straight
// port of the former apps/api/src/modules/payments/listing-fulfilment.ts. Once listings.New assigns d.Listings,
// Service.listings() returns that implementation and this type is never used.
type listingFallback struct{ settings *settings.Service }

// MarkListingFeePaid: DRAFT → PENDING (or ACTIVE when moderation is disabled); the listing no longer counts against
// the free quota. Idempotent.
func (f *listingFallback) MarkListingFeePaid(ctx context.Context, q db.Querier, listingID string) error {
	s, err := f.settings.Settings(ctx)
	if err != nil {
		return err
	}
	var status string
	if err := q.QueryRow(ctx, `select status from listings where id = $1 for update`, listingID).Scan(&status); err != nil {
		if db.IsNoRows(err) {
			return httpx.NotFound("Listing")
		}
		return err
	}
	if status != "DRAFT" {
		_, err = q.Exec(ctx, `update listings set is_free_quota = false, updated_at = now() where id = $1`, listingID)
		return err
	}
	if s.ModerationEnabled {
		_, err = q.Exec(ctx, `update listings set is_free_quota = false, status = 'PENDING', updated_at = now() where id = $1`, listingID)
		return err
	}
	now := time.Now()
	_, err = q.Exec(ctx, `update listings set is_free_quota = false, status = 'ACTIVE', published_at = $2, bumped_at = $2, expires_at = $3,
		updated_at = now() where id = $1`, listingID, now, wallet.AddDays(now, s.ListingLifetimeDays))
	return err
}

// SetVerified grants (or, on refund, revokes) the "Yoxlanılıb" badge. For the MVP the badge is granted immediately on
// payment (in reality an inspector visits the property first).
func (f *listingFallback) SetVerified(ctx context.Context, q db.Querier, listingID string, verified bool) error {
	tag, err := q.Exec(ctx, `update listings set is_verified = $2, updated_at = now() where id = $1`, listingID, verified)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Listing")
	}
	return nil
}
