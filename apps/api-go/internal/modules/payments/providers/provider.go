// Package providers is the card acquirer abstraction. The rest of the API only talks to a Provider, so plugging in
// a real Azerbaijani gateway (Kapital Bank, Payriff, Epoint…) means writing one type that implements Provider and
// registering it in New — routes are generic (/payments/webhook/:provider).
package providers

import (
	"context"
	"fmt"
	"net/http"
	"slices"

	"github.com/alasgarovnamig/evtap/api/internal/config"
)

// Normalised order statuses (MockBank vocabulary; real providers map theirs onto it).
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

var allStatuses = []string{StatusCreated, StatusProcessing, StatusApproved, StatusDeclined, StatusCancelled, StatusExpired, StatusRefunded, StatusPartiallyRefunded}

// PaidStatuses mean "the money was captured" (possibly refunded afterwards).
var PaidStatuses = []string{StatusApproved, StatusRefunded, StatusPartiallyRefunded}

// UnpaidFinalStatuses are final statuses meaning "no money was captured".
var UnpaidFinalStatuses = []string{StatusDeclined, StatusCancelled, StatusExpired}

func IsPaid(status string) bool        { return slices.Contains(PaidStatuses, status) }
func IsUnpaidFinal(status string) bool { return slices.Contains(UnpaidFinalStatuses, status) }

type Card struct {
	Mask  *string `json:"mask"`
	Brand *string `json:"brand"`
	Token *string `json:"token"`
}

// Order is a provider order normalised for the payment engine.
type Order struct {
	OrderID         string
	MerchantOrderID string
	Amount          int // minor units
	Currency        string
	Status          string
	RefundedAmount  int
	Card            *Card
	DeclineCode     *string
	DeclineReason   *string
	RRN             *string
	ApprovalCode    *string
	PaidAt          *string
	Raw             map[string]any // untouched provider payload (stored in payments.provider_data.order)
}

type Customer struct {
	ID    string  `json:"id,omitempty"`
	Phone *string `json:"phone,omitempty"`
	Email *string `json:"email,omitempty"`
}

type CreateOrderInput struct {
	Amount          int       `json:"amount"`
	Currency        string    `json:"currency"`
	MerchantOrderID string    `json:"merchantOrderId"`
	Description     string    `json:"description"`
	Language        string    `json:"language,omitempty"`
	ReturnURL       string    `json:"returnUrl"`
	CallbackURL     string    `json:"callbackUrl"`
	SaveCard        bool      `json:"saveCard,omitempty"`
	Customer        *Customer `json:"customer,omitempty"`
}

type CreatedOrder struct {
	OrderID    string
	Status     string
	PaymentURL string
	ExpiresAt  *string
}

type ChargeTokenInput struct {
	Amount          int    `json:"amount"`
	Currency        string `json:"currency"`
	MerchantOrderID string `json:"merchantOrderId"`
	Description     string `json:"description"`
	CardToken       string `json:"cardToken"`
	CallbackURL     string `json:"callbackUrl,omitempty"`
}

type WebhookEvent struct {
	Event string
	Order *Order
}

// Provider is a card acquirer.
type Provider interface {
	// Name is the stable id stored in payments.provider and used in webhook / return routes.
	Name() string
	// CreateOrder creates a hosted-payment-page order; the user is redirected to PaymentURL. Idempotent per merchantOrderId.
	CreateOrder(ctx context.Context, in CreateOrderInput) (*CreatedOrder, error)
	GetOrder(ctx context.Context, orderID string) (*Order, error)
	// Refund refunds amount (0 = the remaining captured amount).
	Refund(ctx context.Context, orderID string, amount int, reason string) (*Order, error)
	// ChargeToken is a merchant-initiated charge of a saved card token (subscription renewals). Synchronous result.
	ChargeToken(ctx context.Context, in ChargeTokenInput) (*Order, error)
	// Cancel cancels an unpaid order.
	Cancel(ctx context.Context, orderID string) (*Order, error)
	// VerifyWebhook authenticates and parses a webhook. Returns *InvalidSignatureError when the request is not genuine.
	VerifyWebhook(h http.Header, rawBody []byte) (*WebhookEvent, error)
	// DeleteToken forgets a saved card.
	DeleteToken(ctx context.Context, cardToken string) error
}

// ProviderError is a network / protocol error talking to the provider. Status = HTTP status when the provider answered.
type ProviderError struct {
	Msg    string
	Status int
	Body   any
}

func (e *ProviderError) Error() string { return e.Msg }

// InvalidSignatureError means a webhook is not genuine.
type InvalidSignatureError struct{ Msg string }

func (e *InvalidSignatureError) Error() string { return e.Msg }

// New returns the provider configured by PAYMENT_PROVIDER. Adding a real bank = one type + one case here.
func New(cfg *config.Config) (Provider, error) {
	switch cfg.Payments.Provider {
	case "mockbank", "":
		mb := cfg.Payments.MockBank
		return NewMockBank(MockBankConfig{URL: mb.URL, MerchantID: mb.MerchantID, Secret: mb.Secret}), nil
	}
	return nil, fmt.Errorf("unknown PAYMENT_PROVIDER %q (available: mockbank)", cfg.Payments.Provider)
}
