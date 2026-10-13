package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments/providers"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
)

// FulfilResult is what a purpose handler hands back to the payment engine.
type FulfilResult struct {
	// After runs once the transaction committed (notifications, events).
	After wallet.Effect
	// RefundReason: the goods can no longer be delivered (e.g. booking dates taken meanwhile) → the payment is refunded in full.
	RefundReason string
}

// RefundCtx is passed to PurposeHandler.Reverse.
type RefundCtx struct {
	ActorID *string
	Reason  string
}

// PurposeHandler is per-purpose business logic plugged into the payment engine. Payments own WALLET_TOPUP /
// PROMOTION / LISTING_FEE / VERIFICATION; subscriptions and bookings register theirs in their New().
// Every function runs inside the payment's transaction with the payment row locked.
type PurposeHandler struct {
	Fulfil   func(ctx context.Context, tx pgx.Tx, p *Row) (FulfilResult, error)
	OnFailed func(ctx context.Context, tx pgx.Tx, p *Row) (FulfilResult, error)
	// Reverse (admin refund) undoes what was granted where it makes sense (may return an error to abort the refund).
	Reverse func(ctx context.Context, tx pgx.Tx, p *Row, amount int, rc RefundCtx) (FulfilResult, error)
}

// StartInput describes a payment to start.
type StartInput struct {
	UserID      string
	Purpose     string
	Method      string // CARD | WALLET
	Amount      int
	Currency    string // default AZN
	Description string
	Items       []Item
	Metadata    map[string]any
	ListingID   *string
	BookingID   *string
	// ReturnURL is the client return URL ("" → `${WEB_URL}/payment/result`). Validated.
	ReturnURL string
	SaveCard  bool
	Language  string
	Phone     *string
	Email     *string
	// Tx (WALLET only): run debit + fulfilment inside the caller's transaction. The caller must then call AfterCommit.
	Tx pgx.Tx
}

// Started is the result of StartPayment.
type Started struct {
	Checkout    CheckoutResponse
	Payment     *Row
	AfterCommit func(ctx context.Context)
}

// RefundInput parameterises Refund.
type RefundInput struct {
	Amount  int // 0 = the remaining refundable amount
	Reason  string
	ActorID *string
	Reverse bool // also undo the fulfilment (admin refunds)
	Tx      pgx.Tx
	// Effects (with Tx): post-commit side effects are appended here instead of being run immediately.
	Effects *[]wallet.Effect
}

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IsUUID reports whether s is a UUID.
func IsUUID(s string) bool { return uuidRe.MatchString(s) }

// Service is the payment engine: wallet & card payments, provider finalisation (webhook / return / reconciliation),
// idempotent fulfilment (payments.fulfilled_at under a row lock) and refunds.
type Service struct {
	d        *app.Deps
	cfg      *config.Config
	pool     *pgxpool.Pool
	settings *settings.Service
	notify   *notify.Service
	bus      *events.Bus
	Wallet   *wallet.Service
	Provider providers.Provider

	mu          sync.RWMutex
	handlers    map[string]*PurposeHandler
	reconciling atomic.Bool
	fallback    app.ListingsAPI
}

var (
	registryMu sync.Mutex
	registry   = map[*app.Deps]*Service{}
)

// Engine returns the payment engine shared by every money module built on the same Deps (created on first use),
// so subscriptions and bookings can register purpose handlers regardless of construction order.
func Engine(d *app.Deps) *Service {
	registryMu.Lock()
	defer registryMu.Unlock()
	if s, ok := registry[d]; ok {
		return s
	}
	p, err := providers.New(d.Cfg)
	if err != nil {
		panic(err)
	}
	s := NewService(d, p)
	registry[d] = s
	return s
}

// NewService builds an engine with an explicit provider (tests). Prefer Engine(d).
func NewService(d *app.Deps, p providers.Provider) *Service {
	s := &Service{
		d: d, cfg: d.Cfg, pool: d.Pool, settings: d.Settings, notify: d.Notify, bus: d.Bus, Wallet: wallet.NewService(d.Pool), Provider: p,
		handlers: map[string]*PurposeHandler{},
	}
	s.fallback = &listingFallback{settings: d.Settings}
	s.registerCoreHandlers()
	return s
}

// RegisterHandler plugs in the business logic of a payment purpose.
func (s *Service) RegisterHandler(purpose string, h *PurposeHandler) {
	s.mu.Lock()
	s.handlers[purpose] = h
	s.mu.Unlock()
}

func (s *Service) handler(purpose string) *PurposeHandler {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.handlers[purpose]
}

func (s *Service) mustHandler(purpose string) (*PurposeHandler, error) {
	h := s.handler(purpose)
	if h == nil || h.Fulfil == nil {
		return nil, fmt.Errorf("no fulfilment handler registered for %s", purpose)
	}
	return h, nil
}

// listings returns the marketplace ListingsAPI, or the local fallback while it is not wired (see listing_fallback.go).
func (s *Service) listings() app.ListingsAPI {
	if s.d.Listings != nil {
		return s.d.Listings
	}
	return s.fallback
}

// CallbackURL is the server-to-server webhook URL given to the bank.
func (s *Service) CallbackURL() string {
	return s.cfg.APIInternalURL + "/api/v1/payments/webhook/" + s.Provider.Name()
}

// ResolveReturnURL validates a client return URL ("" → the web result page).
func (s *Service) ResolveReturnURL(u string) (string, error) {
	if u == "" {
		return s.cfg.WebURL + "/payment/result", nil
	}
	if !IsAllowedReturnURL(s.cfg, u) {
		return "", httpx.BadRequest("RETURN_URL_NOT_ALLOWED", "returnUrl is not an allowed EvTap address")
	}
	return u, nil
}

func (s *Service) runEffects(ctx context.Context, effects []wallet.Effect) {
	wallet.RunEffects(ctx, effects)
}

// ───────────────────────────── Start ─────────────────────────────

const insertPayment = `insert into payments (user_id, purpose, method, amount, currency, description, listing_id, booking_id, items, metadata,
	return_url, status, provider) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning ` + Columns

// StartPayment creates a payment. WALLET: debit + fulfil immediately (SUCCEEDED). CARD: create the bank order (PENDING).
func (s *Service) StartPayment(ctx context.Context, in StartInput) (*Started, error) {
	if in.Amount <= 0 {
		return nil, httpx.BadRequest("INVALID_AMOUNT", "Amount must be a positive integer")
	}
	currency := in.Currency
	if currency == "" {
		currency = "AZN"
	}
	returnURL, err := s.ResolveReturnURL(in.ReturnURL)
	if err != nil {
		return nil, err
	}
	items := in.Items
	if items == nil {
		items = []Item{}
	}
	meta := in.Metadata
	if meta == nil {
		meta = map[string]any{}
	}

	if in.Method == "WALLET" {
		if currency != "AZN" {
			return nil, httpx.BadRequest("CURRENCY_NOT_SUPPORTED", "Wallet payments are only available in AZN")
		}
		var effects []wallet.Effect
		var done *Row
		var q db.Querier = s.pool
		if in.Tx != nil {
			q = in.Tx
		}
		err := db.WithTx(ctx, q, func(tx pgx.Tx) error {
			p, err := Scan(tx.QueryRow(ctx, insertPayment, in.UserID, in.Purpose, in.Method, in.Amount, currency, in.Description, in.ListingID,
				in.BookingID, items, meta, returnURL, "PENDING", nil))
			if err != nil {
				return err
			}
			if _, err := s.Wallet.DebitTx(ctx, tx, in.UserID, in.Amount, in.Description, app.WalletOpts{PaymentID: &p.ID, BookingID: in.BookingID}); err != nil {
				return err
			}
			now := time.Now()
			paid, err := Scan(tx.QueryRow(ctx, `update payments set status = 'SUCCEEDED', paid_at = $2, updated_at = now() where id = $1 returning `+Columns, p.ID, now))
			if err != nil {
				return err
			}
			h, err := s.mustHandler(p.Purpose)
			if err != nil {
				return err
			}
			r, err := h.Fulfil(ctx, tx, paid)
			if err != nil {
				return err
			}
			if r.RefundReason != "" {
				return httpx.E(http.StatusConflict, "FULFILMENT_FAILED", r.RefundReason) // rolls back the debit too
			}
			done, err = Scan(tx.QueryRow(ctx, `update payments set fulfilled_at = $2, updated_at = now() where id = $1 returning `+Columns, p.ID, now))
			if err != nil {
				return err
			}
			effects = append(effects, r.After, func(ctx context.Context) error { return s.publish(ctx, done, true) })
			return nil
		})
		if err != nil {
			return nil, err
		}
		after := func(ctx context.Context) { s.runEffects(ctx, effects) }
		started := &Started{
			Checkout: CheckoutResponse{PaymentID: done.ID, Status: "SUCCEEDED", Amount: done.Amount, Currency: done.Currency},
			Payment:  done, AfterCommit: func(context.Context) {},
		}
		if in.Tx == nil {
			after(ctx)
		} else {
			started.AfterCommit = after
		}
		return started, nil
	}

	// CARD — the payment row must be committed before the bank can call our webhook.
	if in.Tx != nil {
		return nil, errors.New("card payments cannot run inside an outer transaction")
	}
	name := s.Provider.Name()
	p, err := Scan(s.pool.QueryRow(ctx, insertPayment, in.UserID, in.Purpose, "CARD", in.Amount, currency, in.Description, in.ListingID,
		in.BookingID, items, meta, returnURL, "PENDING", name))
	if err != nil {
		return nil, err
	}
	lang := in.Language
	if lang == "" {
		lang = "az"
	}
	order, err := s.Provider.CreateOrder(ctx, providers.CreateOrderInput{
		Amount: p.Amount, Currency: currency, MerchantOrderID: p.ID, Description: p.Description, Language: lang,
		ReturnURL:   s.cfg.APIPublicURL + "/api/v1/payments/return/" + name + "?paymentId=" + p.ID,
		CallbackURL: s.CallbackURL(), SaveCard: in.SaveCard,
		Customer: &providers.Customer{ID: in.UserID, Phone: in.Phone, Email: in.Email},
	})
	if err != nil {
		slog.Error("createOrder failed", "paymentId", p.ID, "err", err)
		if _, ferr := s.MarkFailed(context.WithoutCancel(ctx), p.ID, "Bank xidməti əlçatan deyil", false); ferr != nil {
			slog.Error("markFailed", "paymentId", p.ID, "err", ferr)
		}
		return nil, httpx.E(http.StatusBadGateway, "PAYMENT_PROVIDER_UNAVAILABLE", "Payment provider is unavailable, try again later")
	}
	pd := map[string]any{"paymentUrl": order.PaymentURL, "expiresAt": order.ExpiresAt, "status": order.Status}
	updated, err := Scan(s.pool.QueryRow(ctx, `update payments set provider_order_id = $2, provider_data = $3, updated_at = now() where id = $1 returning `+Columns,
		p.ID, order.OrderID, pd))
	if err != nil {
		return nil, err
	}
	url := order.PaymentURL
	return &Started{
		Checkout: CheckoutResponse{PaymentID: p.ID, Status: "PENDING", Amount: p.Amount, Currency: p.Currency, PaymentURL: &url},
		Payment:  updated, AfterCommit: func(context.Context) {},
	}, nil
}

// ChargeSavedCard is a merchant-initiated charge of a saved card (subscription renewals). Returns the finalised payment row.
func (s *Service) ChargeSavedCard(ctx context.Context, in StartInput, cardToken string) (*Row, error) {
	currency := in.Currency
	if currency == "" {
		currency = "AZN"
	}
	items := in.Items
	if items == nil {
		items = []Item{}
	}
	meta := in.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	p, err := Scan(s.pool.QueryRow(ctx, insertPayment, in.UserID, in.Purpose, "CARD", in.Amount, currency, in.Description, in.ListingID,
		in.BookingID, items, meta, nil, "PENDING", s.Provider.Name()))
	if err != nil {
		return nil, err
	}
	order, err := s.Provider.ChargeToken(ctx, providers.ChargeTokenInput{
		Amount: p.Amount, Currency: currency, MerchantOrderID: p.ID, Description: p.Description, CardToken: cardToken, CallbackURL: s.CallbackURL(),
	})
	if err != nil {
		reason := "Kartdan ödəniş alınmadı"
		var pe *providers.ProviderError
		if errors.As(err, &pe) {
			if b, ok := pe.Body.(map[string]any); ok {
				if v, ok := b["declineReason"].(string); ok && v != "" {
					reason = v
				} else if v, ok := b["error"].(string); ok && v != "" {
					reason = v
				}
			}
		}
		failed, ferr := s.MarkFailed(ctx, p.ID, reason, true)
		if ferr != nil {
			return nil, ferr
		}
		if failed == nil {
			return p, nil
		}
		return failed, nil
	}
	r, err := s.ApplyProviderOrder(ctx, order)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return p, nil
	}
	return r, nil
}

// ───────────────────────────── Finalise ─────────────────────────────

func getForUpdate(ctx context.Context, tx pgx.Tx, id string) (*Row, error) {
	p, err := Scan(tx.QueryRow(ctx, `select `+Columns+` from payments where id = $1 for update`, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	return p, err
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m)+1)
	for k, v := range m {
		out[k] = v
	}
	return out
}

// ApplyProviderOrder applies a provider order state to our payment (webhook, return redirect, reconciliation, token
// charges). Idempotent and race-safe: the payment row is locked and fulfilled_at guards fulfilment.
func (s *Service) ApplyProviderOrder(ctx context.Context, order *providers.Order) (*Row, error) {
	if order == nil || !IsUUID(order.MerchantOrderID) {
		return nil, nil
	}
	var effects []wallet.Effect
	var result *Row
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		p, err := getForUpdate(ctx, tx, order.MerchantOrderID)
		if err != nil {
			return err
		}
		if p == nil || p.Method != "CARD" || p.Provider == nil || *p.Provider != s.Provider.Name() {
			return nil
		}
		result = p
		if p.ProviderOrderID != nil && *p.ProviderOrderID != order.OrderID {
			slog.Warn("order does not belong to payment", "orderId", order.OrderID, "paymentId", p.ID, "expected", *p.ProviderOrderID)
			return nil
		}
		providerData := cloneMap(p.ProviderData)
		providerData["order"] = order.Raw
		now := time.Now()
		pending := p.Status == "PENDING" || p.Status == "CREATED"

		if providers.IsPaid(order.Status) {
			if order.Amount != p.Amount || order.Currency != p.Currency {
				slog.Error("amount mismatch", "paymentId", p.ID, "bankAmount", order.Amount, "bankCurrency", order.Currency, "amount", p.Amount, "currency", p.Currency)
				if p.FulfilledAt != nil || !pending {
					return nil
				}
				result, err = s.failInTx(ctx, tx, p, "Məbləğ uyğunsuzluğu (AMOUNT_MISMATCH)", &effects, failOpts{orderID: &order.OrderID, providerData: providerData, notify: true})
				return err
			}
			if p.FulfilledAt != nil {
				// Already fulfilled. Only sync refunds performed on the bank side (bank admin → order.refunded webhook).
				if order.RefundedAmount > p.RefundedAmount {
					status := "PARTIALLY_REFUNDED"
					if order.RefundedAmount >= p.Amount {
						status = "REFUNDED"
					}
					u, err := Scan(tx.QueryRow(ctx, `update payments set refunded_amount = $2, status = $3, provider_data = $4, updated_at = now() where id = $1 returning `+Columns,
						p.ID, order.RefundedAmount, status, providerData))
					if err != nil {
						return err
					}
					result = u
					effects = append(effects, func(ctx context.Context) error { return s.publish(ctx, u, false) })
				}
				return nil
			}
			// PENDING → SUCCEEDED (also a late approval of a payment we had already marked FAILED / CANCELLED).
			paidAt := now
			if order.PaidAt != nil {
				if t, err := time.Parse(time.RFC3339Nano, *order.PaidAt); err == nil {
					paidAt = t
				}
			}
			cardMask, cardToken := p.CardMask, p.CardToken
			if order.Card != nil {
				if order.Card.Mask != nil {
					cardMask = order.Card.Mask
				}
				if order.Card.Token != nil {
					cardToken = order.Card.Token
				}
			}
			paid, err := Scan(tx.QueryRow(ctx, `update payments set status = 'SUCCEEDED', paid_at = $2, provider_order_id = $3, provider_data = $4,
				card_mask = $5, card_token = $6, failure_reason = null, updated_at = now() where id = $1 returning `+Columns,
				p.ID, paidAt, order.OrderID, providerData, cardMask, cardToken))
			if err != nil {
				return err
			}
			h, err := s.mustHandler(p.Purpose)
			if err != nil {
				return err
			}
			r, err := h.Fulfil(ctx, tx, paid)
			if err != nil {
				return err
			}
			done, err := Scan(tx.QueryRow(ctx, `update payments set fulfilled_at = $2, updated_at = now() where id = $1 returning `+Columns, p.ID, now))
			if err != nil {
				return err
			}
			result = done
			effects = append(effects, r.After, func(ctx context.Context) error { return s.publish(ctx, done, true) })
			if r.RefundReason != "" {
				reason := r.RefundReason
				effects = append(effects, func(ctx context.Context) error { s.autoRefund(ctx, done.ID, reason); return nil })
			}
			return nil
		}

		if providers.IsUnpaidFinal(order.Status) {
			if !pending {
				return nil
			}
			reason := "Bank ödənişi rədd etdi"
			switch {
			case order.Status == providers.StatusExpired:
				reason = "Ödəniş müddəti bitdi"
			case order.Status == providers.StatusCancelled:
				reason = "Ödəniş ləğv edildi"
			case order.DeclineReason != nil:
				reason = *order.DeclineReason
			case order.DeclineCode != nil:
				reason = *order.DeclineCode
			}
			status := "FAILED"
			if order.Status == providers.StatusCancelled {
				status = "CANCELLED"
			}
			result, err = s.failInTx(ctx, tx, p, reason, &effects, failOpts{orderID: &order.OrderID, providerData: providerData, status: status, declineCode: order.DeclineCode, notify: true})
			return err
		}

		// CREATED / PROCESSING — remember the order id, nothing else to do yet.
		if p.ProviderOrderID == nil {
			u, err := Scan(tx.QueryRow(ctx, `update payments set provider_order_id = $2, updated_at = now() where id = $1 returning `+Columns, p.ID, order.OrderID))
			if err != nil {
				return err
			}
			result = u
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.runEffects(ctx, effects)
	return result, nil
}

type failOpts struct {
	orderID      *string
	providerData map[string]any
	status       string // FAILED (default) | CANCELLED
	declineCode  *string
	notify       bool
}

func (s *Service) failInTx(ctx context.Context, tx pgx.Tx, p *Row, reason string, effects *[]wallet.Effect, o failOpts) (*Row, error) {
	status := o.status
	if status == "" {
		status = "FAILED"
	}
	failure := reason
	if o.declineCode != nil && *o.declineCode != "" {
		failure = fmt.Sprintf("%s (%s)", reason, *o.declineCode)
	}
	failed, err := Scan(tx.QueryRow(ctx, `update payments set status = $2, failure_reason = $3,
		provider_order_id = coalesce($4, provider_order_id), provider_data = case when $5::boolean then $6::jsonb else provider_data end, updated_at = now()
		where id = $1 returning `+Columns, p.ID, status, failure, o.orderID, o.providerData != nil, o.providerData))
	if err != nil {
		return nil, err
	}
	if h := s.handler(p.Purpose); h != nil && h.OnFailed != nil {
		r, err := h.OnFailed(ctx, tx, failed)
		if err != nil {
			return nil, err
		}
		*effects = append(*effects, r.After)
	}
	notifyUser := o.notify
	*effects = append(*effects, func(ctx context.Context) error { return s.publish(ctx, failed, notifyUser) })
	return failed, nil
}

// MarkFailed moves a PENDING payment to FAILED (provider unreachable, timeout). No-op for any other status.
func (s *Service) MarkFailed(ctx context.Context, paymentID, reason string, notifyUser bool) (*Row, error) {
	var effects []wallet.Effect
	var row *Row
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		p, err := getForUpdate(ctx, tx, paymentID)
		if err != nil || p == nil {
			return err
		}
		row = p
		if p.Status != "PENDING" && p.Status != "CREATED" {
			return nil
		}
		row, err = s.failInTx(ctx, tx, p, reason, &effects, failOpts{notify: notifyUser})
		return err
	})
	if err != nil {
		return nil, err
	}
	s.runEffects(ctx, effects)
	return row, nil
}

// GetRow loads a payment (nil when missing).
func (s *Service) GetRow(ctx context.Context, q db.Querier, id string) (*Row, error) {
	if q == nil {
		q = s.pool
	}
	p, err := Scan(q.QueryRow(ctx, `select `+Columns+` from payments where id = $1`, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	return p, err
}

// HandleReturn (bank return redirect): re-fetch the order (never trust query params), finalise, return the payment.
func (s *Service) HandleReturn(ctx context.Context, providerName, paymentID string) (*Row, error) {
	if paymentID == "" || !IsUUID(paymentID) || providerName != s.Provider.Name() {
		return nil, nil
	}
	p, err := s.GetRow(ctx, nil, paymentID)
	if err != nil || p == nil {
		return nil, err
	}
	if p.Status == "PENDING" && p.ProviderOrderID != nil {
		order, err := s.Provider.GetOrder(ctx, *p.ProviderOrderID)
		if err != nil {
			slog.Warn("return: could not fetch order", "orderId", *p.ProviderOrderID, "err", err)
			return p, nil
		}
		r, err := s.ApplyProviderOrder(ctx, order)
		if err != nil {
			return nil, err
		}
		if r != nil {
			return r, nil
		}
	}
	return p, nil
}

// Reconcile (cron, 10 min): PENDING card payments older than 15 min → ask the bank; no answer for 24 h → FAILED.
// Returns the number of payments that left PENDING.
func (s *Service) Reconcile(ctx context.Context, now time.Time) (int, error) {
	if !s.reconciling.CompareAndSwap(false, true) {
		return 0, nil
	}
	defer s.reconciling.Store(false)
	rows, err := s.pool.Query(ctx, `select `+Columns+` from payments where status = 'PENDING' and method = 'CARD' and created_at < $1
		order by created_at limit 200`, now.Add(-15*time.Minute))
	if err != nil {
		return 0, err
	}
	var stale []*Row
	for rows.Next() {
		p, err := Scan(rows)
		if err != nil {
			rows.Close()
			return 0, err
		}
		stale = append(stale, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	touched := 0
	for _, p := range stale {
		dead := p.CreatedAt.Before(now.Add(-24 * time.Hour))
		var updated *Row
		if p.ProviderOrderID != nil && p.Provider != nil && *p.Provider == s.Provider.Name() {
			order, err := s.Provider.GetOrder(ctx, *p.ProviderOrderID)
			if err != nil {
				slog.Warn("reconcile", "paymentId", p.ID, "err", err)
			} else if updated, err = s.ApplyProviderOrder(ctx, order); err != nil {
				slog.Warn("reconcile apply", "paymentId", p.ID, "err", err)
			}
		}
		if (updated == nil || updated.Status == "PENDING") && dead {
			if updated, err = s.MarkFailed(ctx, p.ID, "Bankdan cavab alınmadı", true); err != nil {
				slog.Warn("reconcile markFailed", "paymentId", p.ID, "err", err)
			}
		}
		if updated != nil && updated.Status != "PENDING" {
			touched++
		}
	}
	return touched, nil
}

// ───────────────────────────── Refunds ─────────────────────────────

// Refund refunds (part of) a payment to its original method: card → provider refund API, wallet → REFUND credit
// (the bonus share goes back to the bonus balance). Reverse also undoes the fulfilment (admin refunds).
func (s *Service) Refund(ctx context.Context, paymentID string, in RefundInput) (*Row, error) {
	var effects []wallet.Effect
	var out *Row
	var q db.Querier = s.pool
	if in.Tx != nil {
		q = in.Tx
	}
	err := db.WithTx(ctx, q, func(tx pgx.Tx) error {
		p, err := getForUpdate(ctx, tx, paymentID)
		if err != nil {
			return err
		}
		if p == nil {
			return httpx.NotFound("Payment")
		}
		if p.Status != "SUCCEEDED" && p.Status != "PARTIALLY_REFUNDED" {
			return httpx.E(http.StatusConflict, "NOT_REFUNDABLE", fmt.Sprintf("Payment in status %s cannot be refunded", p.Status))
		}
		remaining := p.Amount - p.RefundedAmount
		amount := in.Amount
		if amount == 0 {
			amount = remaining
		}
		if amount <= 0 || amount > remaining {
			return httpx.BadRequest("REFUND_AMOUNT_INVALID", fmt.Sprintf("Refund amount must be between 1 and %d", remaining))
		}
		reason := in.Reason
		if reason == "" {
			reason = "Geri qaytarma"
		}
		if in.Reverse {
			if h := s.handler(p.Purpose); h != nil && h.Reverse != nil {
				r, err := h.Reverse(ctx, tx, p, amount, RefundCtx{ActorID: in.ActorID, Reason: reason})
				if err != nil {
					return err
				}
				effects = append(effects, r.After)
			}
		}

		providerData := p.ProviderData
		if p.Method == "CARD" {
			if p.ProviderOrderID == nil {
				return httpx.E(http.StatusConflict, "NOT_REFUNDABLE", "Payment has no bank order")
			}
			order, err := s.Provider.Refund(ctx, *p.ProviderOrderID, amount, reason)
			if err != nil {
				var pe *providers.ProviderError
				if errors.As(err, &pe) && pe.Status == http.StatusConflict {
					return httpx.E(http.StatusConflict, "REFUND_REJECTED", "The bank rejected the refund")
				}
				return httpx.E(http.StatusBadGateway, "PAYMENT_PROVIDER_UNAVAILABLE", "Refund failed: "+err.Error())
			}
			providerData = cloneMap(p.ProviderData)
			providerData["order"] = order.Raw
		} else {
			// Give the bonus part back as bonus (bonus money is never converted into real money).
			var spentBonus int
			err := tx.QueryRow(ctx, `select bonus_amount from wallet_transactions where payment_id = $1 and type = 'SPEND' limit 1`, p.ID).Scan(&spentBonus)
			if err != nil && !db.IsNoRows(err) {
				return err
			}
			if spentBonus < 0 {
				spentBonus = -spentBonus
			}
			bonus := min(amount, amount*spentBonus/p.Amount)
			if _, err := s.Wallet.CreditTx(ctx, tx, p.UserID, amount, "REFUND", "Geri qaytarma: "+p.Description,
				app.WalletOpts{BonusAmount: bonus, PaymentID: &p.ID, BookingID: p.BookingID, ActorID: in.ActorID}); err != nil {
				return err
			}
		}

		refunded := p.RefundedAmount + amount
		status := "PARTIALLY_REFUNDED"
		if refunded >= p.Amount {
			status = "REFUNDED"
		}
		meta := cloneMap(p.Metadata)
		var refunds []any
		if prev, ok := p.Metadata["refunds"].([]any); ok {
			refunds = append(refunds, prev...)
		}
		refunds = append(refunds, map[string]any{"amount": amount, "reason": reason, "actorId": in.ActorID, "at": httpx.ISO(time.Now())})
		meta["refunds"] = refunds
		u, err := Scan(tx.QueryRow(ctx, `update payments set refunded_amount = $2, status = $3, provider_data = $4, metadata = $5, updated_at = now()
			where id = $1 returning `+Columns, p.ID, refunded, status, providerData, meta))
		if err != nil {
			return err
		}
		out = u
		where := "balansınıza"
		if u.Method == "CARD" {
			where = "kartınıza"
		}
		text := fmt.Sprintf("%s: %s %s qaytarıldı.", u.Description, wallet.FormatMoney(amount, u.Currency), where)
		effects = append(effects,
			func(ctx context.Context) error { return s.publish(ctx, u, false) },
			func(ctx context.Context) error {
				_, err := s.notify.Notify(ctx, u.UserID, "SYSTEM", "Vəsait geri qaytarıldı", text, map[string]any{"paymentId": u.ID, "amount": amount})
				return err
			})
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Inside a caller's transaction the caller runs the effects after its commit.
	if in.Effects != nil {
		*in.Effects = append(*in.Effects, effects...)
	} else {
		s.runEffects(ctx, effects)
	}
	return out, nil
}

func (s *Service) autoRefund(ctx context.Context, paymentID, reason string) {
	if _, err := s.Refund(ctx, paymentID, RefundInput{Reason: reason}); err != nil {
		slog.Error("automatic refund failed", "paymentId", paymentID, "reason", reason, "err", err)
	}
}

// ───────────────────────────── Queries ─────────────────────────────

// List returns the user's payments, newest first.
func (s *Service) List(ctx context.Context, userID string, pg httpx.PageArgs) (httpx.Paginated[Payment], error) {
	rows, err := s.pool.Query(ctx, `select `+Columns+` from payments where user_id = $1 order by created_at desc limit $2 offset $3`, userID, pg.Limit, pg.Offset)
	if err != nil {
		return httpx.Paginated[Payment]{}, err
	}
	defer rows.Close()
	items := []Payment{}
	for rows.Next() {
		p, err := Scan(rows)
		if err != nil {
			return httpx.Paginated[Payment]{}, err
		}
		items = append(items, p.DTO())
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[Payment]{}, err
	}
	var total int
	if err := s.pool.QueryRow(ctx, `select count(*) from payments where user_id = $1`, userID).Scan(&total); err != nil {
		return httpx.Paginated[Payment]{}, err
	}
	return httpx.NewPage(items, total, pg.Page, pg.PageSize), nil
}

// GetOwn returns one of the user's payments.
func (s *Service) GetOwn(ctx context.Context, userID, id string) (*Payment, error) {
	p, err := Scan(s.pool.QueryRow(ctx, `select `+Columns+` from payments where id = $1 and user_id = $2`, id, userID))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Payment")
	}
	if err != nil {
		return nil, err
	}
	dto := p.DTO()
	return &dto, nil
}

// ───────────────────────────── Side effects ─────────────────────────────

// publish emits payment.updated (→ WebSocket "payment:updated") and optionally PAYMENT_SUCCEEDED / PAYMENT_FAILED.
func (s *Service) publish(ctx context.Context, p *Row, notifyUser bool) error {
	s.bus.Publish(events.PaymentUpdated, events.PaymentUpdatedEvent{UserID: p.UserID, Payment: p.DTO()})
	if !notifyUser {
		return nil
	}
	data := map[string]any{"paymentId": p.ID, "purpose": p.Purpose, "listingId": p.ListingID, "bookingId": p.BookingID}
	switch p.Status {
	case "SUCCEEDED":
		_, err := s.notify.Notify(ctx, p.UserID, "PAYMENT_SUCCEEDED", "Ödəniş uğurla tamamlandı",
			fmt.Sprintf("%s — %s", p.Description, wallet.FormatMoney(p.Amount, p.Currency)), data)
		return err
	case "FAILED", "CANCELLED":
		title := "Ödəniş alınmadı"
		if p.Status == "CANCELLED" {
			title = "Ödəniş ləğv edildi"
		}
		reason := "ödəniş tamamlanmadı"
		if p.FailureReason != nil {
			reason = *p.FailureReason
		}
		_, err := s.notify.Notify(ctx, p.UserID, "PAYMENT_FAILED", title, fmt.Sprintf("%s: %s", p.Description, reason), data)
		return err
	}
	return nil
}

// ───────────────────────────── Core purpose handlers ─────────────────────────────

func (s *Service) registerCoreHandlers() {
	s.RegisterHandler("WALLET_TOPUP", &PurposeHandler{
		Fulfil: func(ctx context.Context, tx pgx.Tx, p *Row) (FulfilResult, error) {
			if _, err := s.Wallet.CreditTx(ctx, tx, p.UserID, p.Amount, "TOPUP", "Balansın artırılması (kart)", app.WalletOpts{PaymentID: &p.ID}); err != nil {
				return FulfilResult{}, err
			}
			if bonus := MetaInt(p.Metadata, "bonus"); bonus > 0 {
				if _, err := s.Wallet.CreditTx(ctx, tx, p.UserID, bonus, "BONUS", "Balans artırma bonusu", app.WalletOpts{BonusAmount: bonus, PaymentID: &p.ID}); err != nil {
					return FulfilResult{}, err
				}
			}
			return FulfilResult{}, nil
		},
		// Refunding a top-up takes the money back out of the wallet (fails with INSUFFICIENT_FUNDS if already spent)
		// and revokes the proportional part of the bonus.
		Reverse: func(ctx context.Context, tx pgx.Tx, p *Row, amount int, rc RefundCtx) (FulfilResult, error) {
			if _, err := s.Wallet.DebitTx(ctx, tx, p.UserID, amount, "Balans artırılmasının geri qaytarılması",
				app.WalletOpts{TxType: "REFUND", Source: wallet.RealOnly, PaymentID: &p.ID, ActorID: rc.ActorID}); err != nil {
				return FulfilResult{}, err
			}
			bonus := MetaInt(p.Metadata, "bonus") * amount / p.Amount
			_, err := s.Wallet.RevokeBonus(ctx, tx, p.UserID, bonus, "Bonusun ləğvi (geri qaytarma)", app.WalletOpts{PaymentID: &p.ID, ActorID: rc.ActorID})
			return FulfilResult{}, err
		},
	})

	s.RegisterHandler("PROMOTION", &PurposeHandler{
		Fulfil: func(ctx context.Context, tx pgx.Tx, p *Row) (FulfilResult, error) {
			if p.ListingID == nil {
				return FulfilResult{RefundReason: "Elan artıq mövcud deyil"}, nil
			}
			codes, _ := p.Metadata["serviceCodes"].([]any)
			for _, c := range codes {
				code, _ := c.(string)
				if err := s.d.Promotions.Apply(ctx, tx, *p.ListingID, code, "PAYMENT", &p.ID); err != nil {
					return FulfilResult{}, err
				}
			}
			return FulfilResult{}, nil
		},
		// Promotions already shown are not revoked on refund (goodwill / partial compensation); money only.
	})

	s.RegisterHandler("LISTING_FEE", &PurposeHandler{
		Fulfil: func(ctx context.Context, tx pgx.Tx, p *Row) (FulfilResult, error) {
			ok, err := s.withListing(ctx, tx, p.ListingID, func(id string) error { return s.listings().MarkListingFeePaid(ctx, tx, id) })
			if err != nil || !ok {
				return FulfilResult{RefundReason: "Elan artıq mövcud deyil"}, err
			}
			return FulfilResult{}, nil
		},
	})

	s.RegisterHandler("VERIFICATION", &PurposeHandler{
		Fulfil: func(ctx context.Context, tx pgx.Tx, p *Row) (FulfilResult, error) {
			ok, err := s.withListing(ctx, tx, p.ListingID, func(id string) error { return s.listings().SetVerified(ctx, tx, id, true) })
			if err != nil || !ok {
				return FulfilResult{RefundReason: "Elan artıq mövcud deyil"}, err
			}
			return FulfilResult{}, nil
		},
		Reverse: func(ctx context.Context, tx pgx.Tx, p *Row, amount int, rc RefundCtx) (FulfilResult, error) {
			if p.ListingID != nil && p.RefundedAmount+amount >= p.Amount {
				_, err := s.withListing(ctx, tx, p.ListingID, func(id string) error { return s.listings().SetVerified(ctx, tx, id, false) })
				return FulfilResult{}, err
			}
			return FulfilResult{}, nil
		},
	})
}

// withListing runs fn when the listing still exists (locking it first). Returns false when it does not
// (→ the purpose handler asks for a refund). A NOT_FOUND AppError from fn is treated the same way.
func (s *Service) withListing(ctx context.Context, tx pgx.Tx, listingID *string, fn func(id string) error) (bool, error) {
	if listingID == nil {
		return false, nil
	}
	var id string
	err := tx.QueryRow(ctx, `select id from listings where id = $1 for update`, *listingID).Scan(&id)
	if db.IsNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := fn(id); err != nil {
		var ae *httpx.AppError
		if db.IsNoRows(err) || (errors.As(err, &ae) && ae.Status == http.StatusNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
