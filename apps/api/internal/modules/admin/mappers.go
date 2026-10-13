package admin

import (
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// Report is the ListingReport DTO.
type Report struct {
	ID           string    `json:"id"`
	ListingID    string    `json:"listingId"`
	ListingTitle string    `json:"listingTitle"`
	Reporter     *NamedRef `json:"reporter"`
	Reason       string    `json:"reason"`
	Comment      *string   `json:"comment"`
	Status       string    `json:"status"`
	CreatedAt    string    `json:"createdAt"`
	ResolvedAt   *string   `json:"resolvedAt"`
}

type NamedRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

const reportColumns = `r.id, r.listing_id, (select l.title from listings l where l.id = r.listing_id), r.reporter_id,
	(select u.name from users u where u.id = r.reporter_id), r.reason, r.comment, r.status, r.created_at, r.resolved_at`

func scanReport(row pgx.Row) (*Report, error) {
	var rp Report
	var title, reporterID, reporterName *string
	var created time.Time
	var resolved *time.Time
	if err := row.Scan(&rp.ID, &rp.ListingID, &title, &reporterID, &reporterName, &rp.Reason, &rp.Comment, &rp.Status, &created, &resolved); err != nil {
		return nil, err
	}
	if title != nil {
		rp.ListingTitle = *title
	}
	if reporterID != nil {
		name := ""
		if reporterName != nil {
			name = *reporterName
		}
		rp.Reporter = &NamedRef{ID: *reporterID, Name: name}
	}
	rp.CreatedAt, rp.ResolvedAt = httpx.ISO(created), httpx.ISOPtr(resolved)
	return &rp, nil
}

// Payment DTO (admin user detail).
type Payment struct {
	ID              string          `json:"id"`
	UserID          string          `json:"userId"`
	Purpose         string          `json:"purpose"`
	Method          string          `json:"method"`
	Amount          int             `json:"amount"`
	Currency        string          `json:"currency"`
	Status          string          `json:"status"`
	Description     string          `json:"description"`
	ListingID       *string         `json:"listingId"`
	BookingID       *string         `json:"bookingId"`
	Items           json.RawMessage `json:"items"`
	Provider        *string         `json:"provider"`
	ProviderOrderID *string         `json:"providerOrderId"`
	CardMask        *string         `json:"cardMask"`
	RefundedAmount  int             `json:"refundedAmount"`
	FailureReason   *string         `json:"failureReason"`
	CreatedAt       string          `json:"createdAt"`
	PaidAt          *string         `json:"paidAt"`
}

const paymentColumns = `id, user_id, purpose, method, amount, currency, status, description, listing_id, booking_id, items, provider,
	provider_order_id, card_mask, refunded_amount, failure_reason, created_at, paid_at`

func scanPayment(row pgx.Row) (*Payment, error) {
	var p Payment
	var items []byte
	var created time.Time
	var paid *time.Time
	if err := row.Scan(&p.ID, &p.UserID, &p.Purpose, &p.Method, &p.Amount, &p.Currency, &p.Status, &p.Description, &p.ListingID, &p.BookingID,
		&items, &p.Provider, &p.ProviderOrderID, &p.CardMask, &p.RefundedAmount, &p.FailureReason, &created, &paid); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		items = []byte("[]")
	}
	p.Items = items
	p.CreatedAt, p.PaidAt = httpx.ISO(created), httpx.ISOPtr(paid)
	return &p, nil
}

// WalletTx is the WalletTransaction DTO.
type WalletTx struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	Amount       int     `json:"amount"`
	BalanceAfter int     `json:"balanceAfter"`
	Description  string  `json:"description"`
	PaymentID    *string `json:"paymentId"`
	CreatedAt    string  `json:"createdAt"`
}

// Wallet DTO.
type Wallet struct {
	Balance      int    `json:"balance"`
	BonusBalance int    `json:"bonusBalance"`
	Currency     string `json:"currency"`
}

// AuditLog DTO.
type AuditLog struct {
	ID        string         `json:"id"`
	Actor     *NamedRef      `json:"actor"`
	Action    string         `json:"action"`
	Entity    string         `json:"entity"`
	EntityID  *string        `json:"entityId"`
	Data      map[string]any `json:"data"`
	IP        *string        `json:"ip"`
	CreatedAt string         `json:"createdAt"`
}

// AdminUser DTO.
type AdminUser struct {
	auth.UserDTO
	WalletBalance  int     `json:"walletBalance"`
	ActiveListings int     `json:"activeListings"`
	TotalSpent     int     `json:"totalSpent"`
	LastLoginAt    *string `json:"lastLoginAt"`
}

const adminUserExtras = `coalesce((select w.balance from wallets w where w.user_id = users.id), 0),
	(select count(*)::int from listings l where l.owner_id = users.id and l.status = 'ACTIVE'),
	(select coalesce(sum(p.amount - p.refunded_amount), 0)::int from payments p
		where p.user_id = users.id and p.status in ('SUCCEEDED','PARTIALLY_REFUNDED') and p.purpose <> 'WALLET_TOPUP')`

func scanAdminUser(row pgx.Row) (*AdminUser, error) {
	var u auth.UserRow
	var au AdminUser
	if err := row.Scan(&u.ID, &u.Name, &u.Phone, &u.Email, &u.PasswordHash, &u.AvatarURL, &u.Role, &u.AccountType, &u.Status, &u.Locale,
		&u.IsPhoneVerified, &u.IsEmailVerified, &u.AgencyID, &u.LastLoginAt, &u.CreatedAt,
		&au.WalletBalance, &au.ActiveListings, &au.TotalSpent); err != nil {
		return nil, err
	}
	au.UserDTO = u.DTO()
	au.LastLoginAt = httpx.ISOPtr(u.LastLoginAt)
	return &au, nil
}
