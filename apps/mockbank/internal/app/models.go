package app

import (
	"bytes"
	"encoding/json"
	"time"
)

// Order statuses.
const (
	StatusCreated           = "CREATED"
	StatusProcessing        = "PROCESSING"
	StatusApproved          = "APPROVED"
	StatusDeclined          = "DECLINED"
	StatusCancelled         = "CANCELLED"
	StatusExpired           = "EXPIRED"
	StatusRefunded          = "REFUNDED"
	StatusPartiallyRefunded = "PARTIALLY_REFUNDED"
)

// OrderStatuses in contract order.
var OrderStatuses = []string{
	StatusCreated, StatusProcessing, StatusApproved, StatusDeclined,
	StatusCancelled, StatusExpired, StatusRefunded, StatusPartiallyRefunded,
}

// Currencies accepted by the merchant API.
var Currencies = []string{"AZN", "USD", "EUR", "GEL"}

// Order kinds.
const (
	KindCheckout = "CHECKOUT"
	KindToken    = "TOKEN"
)

// DeclineReasons are the merchant-facing (English) decline reasons.
var DeclineReasons = map[string]string{
	"DO_NOT_HONOR":       "Do not honor",
	"INSUFFICIENT_FUNDS": "Insufficient funds",
	"EXPIRED_CARD":       "Expired card",
	"PROCESSING_ERROR":   "Processing error, please try again later",
	"3DS_FAILED":         "3-D Secure authentication failed",
	"TOKEN_INVALID":      "Card token is invalid or has been deleted",
}

// Customer is the optional customer object of POST /orders.
type Customer struct {
	ID    *string `json:"id,omitempty"`
	Phone *string `json:"phone,omitempty"`
	Email *string `json:"email,omitempty"`
}

// Order is a row of the orders table.
type Order struct {
	ID                string
	MerchantID        string
	MerchantOrderID   string
	Kind              string
	Amount            int64
	Currency          string
	Description       string
	Language          string
	ReturnURL         *string
	CallbackURL       *string
	SaveCard          bool
	CustomerJSON      *string // JSONB text, key order as stored by Postgres
	Status            string
	RefundedAmount    int64
	CardMask          *string
	CardBrand         *string
	CardToken         *string
	CardHolder        *string
	SaveCardRequested bool
	DeclineCode       *string
	DeclineReason     *string
	RRN               *string
	ApprovalCode      *string
	OTPAttempts       int
	FormNonce         string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	PaidAt            *time.Time
	ExpiresAt         time.Time
}

// Customer decodes the stored customer JSON (nil when none).
func (o *Order) Customer() *Customer {
	if o.CustomerJSON == nil {
		return nil
	}
	var c Customer
	if json.Unmarshal([]byte(*o.CustomerJSON), &c) != nil {
		return nil
	}
	return &c
}

// CustomerCompact returns the customer JSON as JSON.stringify would print the parsed JSONB.
func (o *Order) CustomerCompact() string {
	if o.CustomerJSON == nil {
		return ""
	}
	var buf bytes.Buffer
	if json.Compact(&buf, []byte(*o.CustomerJSON)) != nil {
		return *o.CustomerJSON
	}
	return buf.String()
}

// orderCols is the column list used by every order SELECT / RETURNING (scanned by scanOrder).
const orderCols = `id, merchant_id, merchant_order_id, kind, amount, currency, description, language,
  return_url, callback_url, save_card, customer::text, status, refunded_amount, card_mask, card_brand,
  card_token, card_holder, save_card_requested, decline_code, decline_reason, rrn, approval_code,
  otp_attempts, form_nonce, created_at, updated_at, paid_at, expires_at`

type rowScanner interface{ Scan(dest ...any) error }

func scanOrder(row rowScanner) (*Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.MerchantID, &o.MerchantOrderID, &o.Kind, &o.Amount, &o.Currency, &o.Description, &o.Language,
		&o.ReturnURL, &o.CallbackURL, &o.SaveCard, &o.CustomerJSON, &o.Status, &o.RefundedAmount, &o.CardMask, &o.CardBrand,
		&o.CardToken, &o.CardHolder, &o.SaveCardRequested, &o.DeclineCode, &o.DeclineReason, &o.RRN, &o.ApprovalCode,
		&o.OTPAttempts, &o.FormNonce, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt, &o.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// Refund is a row of the refunds table.
type Refund struct {
	ID        string
	OrderID   string
	Amount    int64
	Reason    *string
	Source    string
	CreatedAt time.Time
}

// Merchant is a row of the merchants table.
type Merchant struct {
	ID        string
	Name      string
	Secret    string
	CreatedAt time.Time
}

// MerchantStats is a merchant with counters for the admin UI.
type MerchantStats struct {
	Merchant
	OrderCount    int
	ApprovedCount int
	TokenCount    int
}

// CardToken is a saved card (never a PAN or CVV).
type CardToken struct {
	Token                  string
	MerchantID             string
	Mask                   string
	Brand                  string
	CustomerID             *string
	ForceInsufficientFunds bool
	CreatedAt              time.Time
	LastUsedAt             *time.Time
}

// TimelineEvent is a row of the events table.
type TimelineEvent struct {
	ID        int64
	Type      string
	Message   string
	CreatedAt time.Time
}

// ---------------------------------------------------------------- public JSON (docs/MOCKBANK.md)

// CardJSON is Order.card.
type CardJSON struct {
	Mask  string  `json:"mask"`
	Brand string  `json:"brand"`
	Token *string `json:"token"`
}

// RefundJSON is one entry of Order.refunds.
type RefundJSON struct {
	ID        string  `json:"id"`
	Amount    int64   `json:"amount"`
	Reason    *string `json:"reason"`
	CreatedAt string  `json:"createdAt"`
}

// OrderJSON is the public Order object (field order matches the Node implementation).
type OrderJSON struct {
	OrderID         string       `json:"orderId"`
	MerchantOrderID string       `json:"merchantOrderId"`
	Amount          int64        `json:"amount"`
	Currency        string       `json:"currency"`
	Description     string       `json:"description"`
	Status          string       `json:"status"`
	RefundedAmount  int64        `json:"refundedAmount"`
	Card            *CardJSON    `json:"card"`
	DeclineCode     *string      `json:"declineCode"`
	DeclineReason   *string      `json:"declineReason"`
	RRN             *string      `json:"rrn"`
	ApprovalCode    *string      `json:"approvalCode"`
	Refunds         []RefundJSON `json:"refunds"`
	CreatedAt       string       `json:"createdAt"`
	UpdatedAt       string       `json:"updatedAt"`
	PaidAt          *string      `json:"paidAt"`
	ExpiresAt       string       `json:"expiresAt"`
}

// ISO formats like JavaScript's Date#toISOString (UTC, millisecond precision).
func ISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func isoPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := ISO(*t)
	return &s
}

// ToOrderJSON builds the public Order object.
func ToOrderJSON(o *Order, refunds []Refund) OrderJSON {
	var card *CardJSON
	if o.CardMask != nil && *o.CardMask != "" {
		brand := "UNKNOWN"
		if o.CardBrand != nil {
			brand = *o.CardBrand
		}
		card = &CardJSON{Mask: *o.CardMask, Brand: brand, Token: o.CardToken}
	}
	rs := make([]RefundJSON, 0, len(refunds))
	for _, r := range refunds {
		rs = append(rs, RefundJSON{ID: r.ID, Amount: r.Amount, Reason: r.Reason, CreatedAt: ISO(r.CreatedAt)})
	}
	return OrderJSON{
		OrderID:         o.ID,
		MerchantOrderID: o.MerchantOrderID,
		Amount:          o.Amount,
		Currency:        o.Currency,
		Description:     o.Description,
		Status:          o.Status,
		RefundedAmount:  o.RefundedAmount,
		Card:            card,
		DeclineCode:     o.DeclineCode,
		DeclineReason:   o.DeclineReason,
		RRN:             o.RRN,
		ApprovalCode:    o.ApprovalCode,
		Refunds:         rs,
		CreatedAt:       ISO(o.CreatedAt),
		UpdatedAt:       ISO(o.UpdatedAt),
		PaidAt:          isoPtr(o.PaidAt),
		ExpiresAt:       ISO(o.ExpiresAt),
	}
}

// MarshalJSON serialises like JSON.stringify: no HTML escaping, no trailing newline.
func MarshalJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// MarshalIndentJSON is JSON.stringify(v, null, 2).
func MarshalIndentJSON(v any) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return ""
	}
	return string(bytes.TrimSuffix(buf.Bytes(), []byte("\n")))
}

// EventForStatus is the webhook event announcing an order's status ("" for non-final statuses).
func EventForStatus(status string) string {
	switch status {
	case StatusApproved:
		return "order.approved"
	case StatusDeclined:
		return "order.declined"
	case StatusRefunded, StatusPartiallyRefunded:
		return "order.refunded"
	case StatusCancelled:
		return "order.cancelled"
	case StatusExpired:
		return "order.expired"
	}
	return ""
}

func strPtr(s string) *string { return &s }

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
