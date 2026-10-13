package payments

import (
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// Item is one line of payments.items.
type Item struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Amount int    `json:"amount"`
}

// Row is a row of the payments table.
type Row struct {
	ID              string
	UserID          string
	Purpose         string
	Method          string
	Amount          int
	Currency        string
	Status          string
	Description     string
	ListingID       *string
	BookingID       *string
	Items           []Item
	Metadata        map[string]any
	Provider        *string
	ProviderOrderID *string
	ProviderData    map[string]any
	CardMask        *string
	CardToken       *string
	ReturnURL       *string
	RefundedAmount  int
	FailureReason   *string
	FulfilledAt     *time.Time
	PaidAt          *time.Time
	CreatedAt       time.Time
}

// Columns selects every Row field in Scan order (prefix-free; use ColumnsAs for joins).
const Columns = `id, user_id, purpose, method, amount, currency, status, description, listing_id, booking_id, items, metadata, provider,
	provider_order_id, provider_data, card_mask, card_token, return_url, refunded_amount, failure_reason, fulfilled_at, paid_at, created_at`

// ColumnsAs is Columns qualified with the alias "p.".
const ColumnsAs = `p.id, p.user_id, p.purpose, p.method, p.amount, p.currency, p.status, p.description, p.listing_id, p.booking_id, p.items,
	p.metadata, p.provider, p.provider_order_id, p.provider_data, p.card_mask, p.card_token, p.return_url, p.refunded_amount, p.failure_reason,
	p.fulfilled_at, p.paid_at, p.created_at`

// Scan reads a row selected with Columns (plus optional extra destinations appended after them).
func Scan(row interface{ Scan(...any) error }, extra ...any) (*Row, error) {
	var p Row
	dest := []any{&p.ID, &p.UserID, &p.Purpose, &p.Method, &p.Amount, &p.Currency, &p.Status, &p.Description, &p.ListingID, &p.BookingID,
		&p.Items, &p.Metadata, &p.Provider, &p.ProviderOrderID, &p.ProviderData, &p.CardMask, &p.CardToken, &p.ReturnURL, &p.RefundedAmount,
		&p.FailureReason, &p.FulfilledAt, &p.PaidAt, &p.CreatedAt}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, err
	}
	if p.Items == nil {
		p.Items = []Item{}
	}
	if p.Metadata == nil {
		p.Metadata = map[string]any{}
	}
	return &p, nil
}

// Payment DTO (types.ts).
type Payment struct {
	ID              string  `json:"id"`
	UserID          string  `json:"userId"`
	Purpose         string  `json:"purpose"`
	Method          string  `json:"method"`
	Amount          int     `json:"amount"`
	Currency        string  `json:"currency"`
	Status          string  `json:"status"`
	Description     string  `json:"description"`
	ListingID       *string `json:"listingId"`
	BookingID       *string `json:"bookingId"`
	Items           []Item  `json:"items"`
	Provider        *string `json:"provider"`
	ProviderOrderID *string `json:"providerOrderId"`
	CardMask        *string `json:"cardMask"`
	RefundedAmount  int     `json:"refundedAmount"`
	FailureReason   *string `json:"failureReason"`
	CreatedAt       string  `json:"createdAt"`
	PaidAt          *string `json:"paidAt"`
}

// DTO maps a payment row to the API DTO.
func (p *Row) DTO() Payment {
	items := p.Items
	if items == nil {
		items = []Item{}
	}
	return Payment{
		ID: p.ID, UserID: p.UserID, Purpose: p.Purpose, Method: p.Method, Amount: p.Amount, Currency: p.Currency, Status: p.Status,
		Description: p.Description, ListingID: p.ListingID, BookingID: p.BookingID, Items: items, Provider: p.Provider,
		ProviderOrderID: p.ProviderOrderID, CardMask: p.CardMask, RefundedAmount: p.RefundedAmount, FailureReason: p.FailureReason,
		CreatedAt: httpx.ISO(p.CreatedAt), PaidAt: httpx.ISOPtr(p.PaidAt),
	}
}

// CheckoutResponse DTO (types.ts).
type CheckoutResponse struct {
	PaymentID  string  `json:"paymentId"`
	Status     string  `json:"status"`
	Amount     int     `json:"amount"`
	Currency   string  `json:"currency"`
	PaymentURL *string `json:"paymentUrl"`
}

// MetaInt reads an integer from payments.metadata (JSON numbers decode as float64).
func MetaInt(m map[string]any, key string) int {
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return 0
}

// MetaString reads a string from payments.metadata.
func MetaString(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// MetaBool reads a boolean from payments.metadata (def when absent).
func MetaBool(m map[string]any, key string, def bool) bool {
	if b, ok := m[key].(bool); ok {
		return b
	}
	return def
}
