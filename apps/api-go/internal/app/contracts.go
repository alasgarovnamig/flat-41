package app

import (
	"context"

	"github.com/alasgarovnamig/evtap/api/internal/db"
)

// ListingsAPI is implemented by internal/modules/listings (marketplace workstream).
type ListingsAPI interface {
	// MarkListingFeePaid: DRAFT → PENDING (or ACTIVE when moderation is disabled), is_free_quota=false. Idempotent.
	MarkListingFeePaid(ctx context.Context, q db.Querier, listingID string) error
	// SetVerified grants (or, on refund, revokes) the "Yoxlanılıb" badge.
	SetVerified(ctx context.Context, q db.Querier, listingID string, verified bool) error
}

// PromotionsAPI is implemented by internal/modules/promotions (money workstream).
type PromotionsAPI interface {
	// Apply a catalog service to a listing. source: PAYMENT | CREDIT | ADMIN.
	Apply(ctx context.Context, q db.Querier, listingID, serviceCode, source string, paymentID *string) error
}

// WalletAPI is implemented by internal/modules/wallet (money workstream). Amounts in minor units.
type WalletAPI interface {
	// Credit adds money; bonusAmount (≤ amount) goes to the bonus balance. txType: WalletTxType.
	Credit(ctx context.Context, q db.Querier, userID string, amount int, txType, description string, opts WalletOpts) error
	// Debit spends money (bonus first unless opts.Source says otherwise); returns AppError INSUFFICIENT_FUNDS (402).
	Debit(ctx context.Context, q db.Querier, userID string, amount int, description string, opts WalletOpts) error
}

type WalletOpts struct {
	BonusAmount int
	PaymentID   *string
	BookingID   *string
	ActorID     *string
	TxType      string // debit ledger type (default SPEND)
	Source      string // BONUS_FIRST (default) | REAL_ONLY | BONUS_ONLY
}
