package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/cards"
	"github.com/alasgarovnamig/evtap/mockbank/internal/config"
	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

// TestOTP is the one-time password that passes 3-D Secure.
const TestOTP = "111111"

// MaxOTPAttempts wrong codes decline the order with 3DS_FAILED.
const MaxOTPAttempts = 3

// delivery says how webhooks raised by an operation are sent after commit.
type delivery int

const (
	deliverAwait      delivery = iota // first attempt before the HTTP response (checkout: webhook before redirect)
	deliverBackground                 // fire and forget
)

// OrderService implements the order state machine.
type OrderService struct {
	db       *pgxpool.Pool
	cfg      *config.Config
	tokens   *TokenService
	webhooks *WebhookService
	log      *slog.Logger
}

// ---------------------------------------------------------------- reads

// Get returns an order (nil when unknown).
func (s *OrderService) Get(ctx context.Context, orderID string) (*Order, error) {
	return findOrder(ctx, s.db, orderID, false)
}

// GetForMerchant returns the merchant's order or ORDER_NOT_FOUND.
func (s *OrderService) GetForMerchant(ctx context.Context, merchantID, orderID string) (*Order, error) {
	o, err := findOrder(ctx, s.db, orderID, false)
	if err != nil {
		return nil, err
	}
	if o == nil || o.MerchantID != merchantID {
		return nil, errOrderNotFound()
	}
	return o, nil
}

// ToJSON builds the public Order object.
func (s *OrderService) ToJSON(ctx context.Context, o *Order) (OrderJSON, error) {
	return loadOrderJSON(ctx, s.db, o)
}

// PaymentURL is the hosted checkout URL of an order.
func (s *OrderService) PaymentURL(orderID string) string {
	return s.cfg.PublicURL + "/checkout/" + orderID
}

// ---------------------------------------------------------------- merchant API

// Create handles POST /orders — idempotent on (merchant, merchantOrderId).
func (s *OrderService) Create(ctx context.Context, m *Merchant, in *CreateOrderInput) (*Order, bool, error) {
	var customer *string
	if in.Customer != nil {
		c := compactJSON(in.Customer)
		customer = &c
	}
	o, err := scanOrder(s.db.QueryRow(ctx, `INSERT INTO orders (id, merchant_id, merchant_order_id, kind, amount, currency, description, language,
		  return_url, callback_url, save_card, customer, status, form_nonce, expires_at)
		VALUES ($1, $2, $3, 'CHECKOUT', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'CREATED', $12, now() + $13::float8 * interval '1 minute')
		ON CONFLICT (merchant_id, merchant_order_id) DO NOTHING
		RETURNING `+orderCols,
		util.NewID("ord", 12), m.ID, in.MerchantOrderID, in.Amount, in.Currency, in.Description, in.Language,
		in.ReturnURL, in.CallbackURL, in.SaveCard, customer, util.NewNonce(), s.cfg.OrderTTLMinutes))
	if err == nil {
		if err := addEvent(ctx, s.db, o.ID, "CREATED", "Order created for "+util.FormatMoney(o.Amount, o.Currency), map[string]any{
			"merchantOrderId": o.MerchantOrderID, "saveCard": o.SaveCard, "language": o.Language,
		}); err != nil {
			return nil, false, err
		}
		s.log.Info("order created", "orderId", o.ID, "merchantOrderId", o.MerchantOrderID)
		return o, true, nil
	}
	if !isNoRows(err) {
		return nil, false, err
	}
	existing, err := s.findByMerchantOrderID(ctx, s.db, m.ID, in.MerchantOrderID)
	if err != nil {
		return nil, false, err
	}
	if existing == nil {
		return nil, false, &APIError{Status: 500, Code: "INTERNAL_ERROR", Message: "Idempotent lookup failed"}
	}
	return existing, false, nil
}

// ChargeToken handles POST /orders/charge-token — synchronous merchant-initiated charge of a saved card.
func (s *OrderService) ChargeToken(ctx context.Context, m *Merchant, in *ChargeTokenInput) (*Order, error) {
	var order *Order
	webhookID := ""
	err := withTx(ctx, s.db, func(tx pgx.Tx) error {
		existing, err := s.findByMerchantOrderID(ctx, tx, m.ID, in.MerchantOrderID)
		if err != nil {
			return err
		}
		if existing != nil {
			order = existing
			return nil
		}
		token, err := s.tokens.Find(ctx, tx, in.CardToken, m.ID, true)
		if err != nil {
			return err
		}
		status := StatusApproved
		declineCode := ""
		if token == nil {
			declineCode = "TOKEN_INVALID"
		} else if token.ForceInsufficientFunds {
			declineCode = "INSUFFICIENT_FUNDS"
		}
		if declineCode != "" {
			status = StatusDeclined
		}
		approved := status == StatusApproved
		var mask, brand, tok, dc, dr, rrn, auth *string
		if token != nil {
			mask, brand, tok = &token.Mask, &token.Brand, &token.Token
		}
		if declineCode != "" {
			dc, dr = strPtr(declineCode), strPtr(DeclineReasons[declineCode])
		}
		if approved {
			rrn, auth = strPtr(util.NewRRN()), strPtr(util.NewApprovalCode())
		}
		o, err := scanOrder(tx.QueryRow(ctx, `INSERT INTO orders (id, merchant_id, merchant_order_id, kind, amount, currency, description, language,
			  callback_url, status, card_mask, card_brand, card_token, decline_code, decline_reason, rrn, approval_code,
			  form_nonce, paid_at, expires_at)
			VALUES ($1, $2, $3, 'TOKEN', $4, $5, $6, 'en', $7, $8::text, $9, $10, $11, $12, $13, $14, $15, $16,
			  CASE WHEN $8::text = 'APPROVED' THEN now() END, now() + $17::float8 * interval '1 minute')
			ON CONFLICT (merchant_id, merchant_order_id) DO NOTHING
			RETURNING `+orderCols,
			util.NewID("ord", 12), m.ID, in.MerchantOrderID, in.Amount, in.Currency, in.Description, in.CallbackURL, status,
			mask, brand, tok, dc, dr, rrn, auth, util.NewNonce(), s.cfg.OrderTTLMinutes))
		if isNoRows(err) {
			// Concurrent request with the same merchantOrderId won the race.
			order, err = s.findByMerchantOrderID(ctx, tx, m.ID, in.MerchantOrderID)
			return err
		}
		if err != nil {
			return err
		}
		order = o
		if token != nil {
			if err := s.tokens.Touch(ctx, tx, token.Token); err != nil {
				return err
			}
		}
		if err := addEvent(ctx, tx, o.ID, "CREATED", fmt.Sprintf("Token charge %s with %s", util.FormatMoney(o.Amount, o.Currency), in.CardToken), nil); err != nil {
			return err
		}
		msg := fmt.Sprintf("Approved (RRN %s, auth %s)", deref(o.RRN), deref(o.ApprovalCode))
		if !approved {
			msg = fmt.Sprintf("Declined: %s — %s", declineCode, deref(o.DeclineReason))
		}
		if err := addEvent(ctx, tx, o.ID, o.Status, msg, nil); err != nil {
			return err
		}
		webhookID, err = s.queueWebhook(ctx, tx, o)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.send(webhookID, deliverBackground)
	return order, nil
}

// RefundSource tells who initiated a refund.
type RefundSource string

// Refund sources.
const (
	SourceAPI   RefundSource = "API"
	SourceAdmin RefundSource = "ADMIN"
)

// Refund handles POST /orders/:id/refund (also used by the admin UI). merchantID scopes the
// lookup ("" for admin).
func (s *OrderService) Refund(ctx context.Context, orderID string, in *RefundInput, merchantID string, source RefundSource) (*Order, error) {
	var order *Order
	webhookID := ""
	err := withTx(ctx, s.db, func(tx pgx.Tx) error {
		current, err := findOrder(ctx, tx, orderID, true)
		if err != nil {
			return err
		}
		if current == nil || (merchantID != "" && current.MerchantID != merchantID) {
			return errOrderNotFound()
		}
		if current.Status != StatusApproved && current.Status != StatusPartiallyRefunded {
			return &APIError{Status: 409, Code: "NOT_REFUNDABLE", Message: fmt.Sprintf("Order in status %s cannot be refunded", current.Status)}
		}
		remaining := current.Amount - current.RefundedAmount
		amount := remaining
		if in.Amount != nil {
			amount = *in.Amount
		}
		if amount > remaining {
			return &APIError{Status: 409, Code: "NOT_REFUNDABLE", Message: fmt.Sprintf("Refund amount %d exceeds the refundable remainder %d", amount, remaining)}
		}
		refunded := current.RefundedAmount + amount
		status := StatusPartiallyRefunded
		if refunded >= current.Amount {
			status = StatusRefunded
		}
		refundID := util.NewID("rf", 12)
		if _, err := tx.Exec(ctx, `INSERT INTO refunds (id, order_id, amount, reason, source) VALUES ($1, $2, $3, $4, $5)`,
			refundID, current.ID, amount, in.Reason, string(source)); err != nil {
			return err
		}
		o, err := transition(ctx, tx, current.ID, []string{current.Status}, set{"status", status}, set{"refunded_amount", refunded})
		if err != nil {
			return err
		}
		order = o
		reason := ""
		if in.Reason != nil && *in.Reason != "" {
			reason = " — " + *in.Reason
		}
		if err := addEvent(ctx, tx, o.ID, "REFUNDED",
			fmt.Sprintf("Refund %s %s via %s%s → %s", refundID, util.FormatMoney(amount, o.Currency), source, reason, status),
			map[string]any{"refundId": refundID, "amount": amount}); err != nil {
			return err
		}
		webhookID, err = s.queueWebhook(ctx, tx, o)
		return err
	})
	if err != nil {
		return nil, err
	}
	if source == SourceAPI {
		s.send(webhookID, deliverBackground)
	} else {
		s.send(webhookID, deliverAwait)
	}
	return order, nil
}

// Cancel handles POST /orders/:id/cancel — merchant cancels an unpaid order.
func (s *OrderService) Cancel(ctx context.Context, merchantID, orderID string) (*Order, error) {
	existing, err := s.GetForMerchant(ctx, merchantID, orderID)
	if err != nil {
		return nil, err
	}
	o, err := s.finish(ctx, existing.ID, []string{StatusCreated}, StatusCancelled, nil, "Cancelled by merchant", deliverBackground, false)
	if err != nil {
		return nil, err
	}
	if o == nil {
		fresh, err := findOrder(ctx, s.db, orderID, false)
		if err != nil {
			return nil, err
		}
		return nil, &APIError{Status: 409, Code: "NOT_CANCELLABLE", Message: fmt.Sprintf("Order in status %s cannot be cancelled", fresh.Status)}
	}
	return o, nil
}

// ---------------------------------------------------------------- hosted checkout

// CancelByCustomer handles the Cancel button of the card form.
func (s *OrderService) CancelByCustomer(ctx context.Context, orderID string) (*Order, error) {
	return s.finish(ctx, orderID, []string{StatusCreated}, StatusCancelled, nil, "Cancelled by cardholder on the payment page", deliverAwait, false)
}

// SubmitCard processes a (validated) card form. Returns the order in its new state, or nil
// when the order was no longer CREATED.
func (s *OrderService) SubmitCard(ctx context.Context, orderID string, card *cards.Validated, saveRequested bool) (*Order, error) {
	outcome := cards.CardOutcome(card.PAN)
	cardFields := []set{{"card_mask", card.Mask}, {"card_brand", card.Brand}, {"card_holder", card.Holder}}
	var order *Order
	webhookID := ""
	err := withTx(ctx, s.db, func(tx pgx.Tx) error {
		current, err := findOrder(ctx, tx, orderID, true)
		if err != nil || current == nil || current.Status != StatusCreated {
			return err
		}
		save := current.SaveCard && saveRequested
		saveNote := ""
		if save {
			saveNote = ", save card requested"
		}
		if err := addEvent(ctx, tx, orderID, "CARD_SUBMITTED", fmt.Sprintf("Card %s (%s) submitted%s", card.Mask, card.Brand, saveNote), nil); err != nil {
			return err
		}
		switch outcome.Kind {
		case cards.ThreeDS:
			o, err := transition(ctx, tx, orderID, []string{StatusCreated},
				append(cardFields, set{"status", StatusProcessing}, set{"save_card_requested", save}, set{"otp_attempts", 0})...)
			if err != nil {
				return err
			}
			order = o
			return addEvent(ctx, tx, orderID, "3DS_STARTED", "3-D Secure challenge started", nil)
		case cards.Decline:
			o, err := transition(ctx, tx, orderID, []string{StatusCreated},
				append(cardFields, set{"status", StatusDeclined}, set{"decline_code", outcome.Code}, set{"decline_reason", DeclineReasons[outcome.Code]})...)
			if err != nil {
				return err
			}
			order = o
			if err := addEvent(ctx, tx, orderID, "DECLINED", fmt.Sprintf("Declined by issuer: %s — %s", outcome.Code, DeclineReasons[outcome.Code]), nil); err != nil {
				return err
			}
			webhookID, err = s.queueWebhook(ctx, tx, o)
			return err
		}
		o, err := s.approve(ctx, tx, current, []string{StatusCreated}, save, cardFields, "Approved (frictionless)")
		if err != nil {
			return err
		}
		order = o
		webhookID, err = s.queueWebhook(ctx, tx, o)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.send(webhookID, deliverAwait)
	return order, nil
}

// OTPResult is the outcome of a 3-D Secure OTP submission.
type OTPResult struct {
	Order        *Order
	AttemptsLeft int
}

// SubmitOTP processes a 3-D Secure one-time password (nil when the order is not PROCESSING).
func (s *OrderService) SubmitOTP(ctx context.Context, orderID, otp string) (*OTPResult, error) {
	var result *OTPResult
	webhookID := ""
	err := withTx(ctx, s.db, func(tx pgx.Tx) error {
		current, err := findOrder(ctx, tx, orderID, true)
		if err != nil || current == nil || current.Status != StatusProcessing {
			return err
		}
		if util.JSTrim(otp) == TestOTP {
			if err := addEvent(ctx, tx, orderID, "3DS_PASSED", "3-D Secure authentication successful", nil); err != nil {
				return err
			}
			o, err := s.approve(ctx, tx, current, []string{StatusProcessing}, current.SaveCardRequested, nil, "Approved after 3-D Secure")
			if err != nil {
				return err
			}
			result = &OTPResult{Order: o}
			webhookID, err = s.queueWebhook(ctx, tx, o)
			return err
		}
		attempts := current.OTPAttempts + 1
		left := MaxOTPAttempts - attempts
		if left < 0 {
			left = 0
		}
		if err := addEvent(ctx, tx, orderID, "3DS_WRONG_OTP", fmt.Sprintf("Wrong one-time password (attempt %d/%d)", attempts, MaxOTPAttempts), nil); err != nil {
			return err
		}
		if left > 0 {
			o, err := transition(ctx, tx, orderID, []string{StatusProcessing}, set{"otp_attempts", attempts})
			if err != nil {
				return err
			}
			result = &OTPResult{Order: o, AttemptsLeft: left}
			return nil
		}
		o, err := transition(ctx, tx, orderID, []string{StatusProcessing}, set{"otp_attempts", attempts}, set{"status", StatusDeclined},
			set{"decline_code", "3DS_FAILED"}, set{"decline_reason", DeclineReasons["3DS_FAILED"]})
		if err != nil {
			return err
		}
		if err := addEvent(ctx, tx, orderID, "DECLINED", fmt.Sprintf("Declined: 3DS_FAILED — %d wrong one-time passwords", MaxOTPAttempts), nil); err != nil {
			return err
		}
		result = &OTPResult{Order: o}
		webhookID, err = s.queueWebhook(ctx, tx, o)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.send(webhookID, deliverAwait)
	return result, nil
}

// Abort3DS: the cardholder cancelled the 3-D Secure challenge → authentication failed.
func (s *OrderService) Abort3DS(ctx context.Context, orderID string) (*Order, error) {
	return s.finish(ctx, orderID, []string{StatusProcessing}, StatusDeclined,
		[]set{{"decline_code", "3DS_FAILED"}, {"decline_reason", "Authentication cancelled by cardholder"}},
		"Declined: 3DS_FAILED — authentication cancelled by cardholder", deliverAwait, false)
}

// ---------------------------------------------------------------- expiry

func (s *OrderService) expiredMessage() string {
	return fmt.Sprintf("Not paid within %s min — expired", jsNumber(s.cfg.OrderTTLMinutes))
}

// ExpireIfDue expires one order if its time is up (customer opens a stale checkout link).
func (s *OrderService) ExpireIfDue(ctx context.Context, o *Order) (*Order, error) {
	if (o.Status != StatusCreated && o.Status != StatusProcessing) || o.ExpiresAt.After(time.Now()) {
		return o, nil
	}
	expired, err := s.finish(ctx, o.ID, []string{StatusCreated, StatusProcessing}, StatusExpired, nil, s.expiredMessage(), deliverAwait, false)
	if err != nil {
		return nil, err
	}
	if expired != nil {
		return expired, nil
	}
	return findOrder(ctx, s.db, o.ID, false)
}

// ExpireDue (scheduler tick) expires overdue unpaid orders and queues order.expired webhooks.
func (s *OrderService) ExpireDue(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM orders WHERE status IN ('CREATED','PROCESSING') AND expires_at <= now() ORDER BY expires_at LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	count := 0
	for _, id := range ids {
		o, err := s.finish(ctx, id, []string{StatusCreated, StatusProcessing}, StatusExpired, nil, s.expiredMessage(), deliverBackground, true)
		if err != nil {
			return count, err
		}
		if o != nil {
			count++
		}
	}
	return count, nil
}

// ---------------------------------------------------------------- admin

// ResendWebhook re-sends the webhook for the order's current status (admin "Resend webhook").
func (s *OrderService) ResendWebhook(ctx context.Context, orderID string) error {
	webhookID := ""
	err := withTx(ctx, s.db, func(tx pgx.Tx) error {
		o, err := findOrder(ctx, tx, orderID, true)
		if err != nil {
			return err
		}
		if o == nil {
			return errOrderNotFound()
		}
		event := EventForStatus(o.Status)
		if event == "" || o.CallbackURL == nil || *o.CallbackURL == "" {
			return &APIError{Status: 409, Code: "NOTHING_TO_SEND", Message: "Order has no final status or no callbackUrl"}
		}
		if err := addEvent(ctx, tx, orderID, "WEBHOOK_RESEND", fmt.Sprintf("Webhook %s re-sent manually", event), nil); err != nil {
			return err
		}
		webhookID, err = s.queueWebhook(ctx, tx, o)
		return err
	})
	if err != nil {
		return err
	}
	s.send(webhookID, deliverAwait)
	return nil
}

// OrderListFilter filters the admin order list.
type OrderListFilter struct {
	Status     string
	MerchantID string
	Q          string
	Page       int
	PageSize   int
}

// OrderPage is one page of the admin order list.
type OrderPage struct {
	Items    []*Order
	Total    int
	Page     int
	PageSize int
}

// List returns a filtered, paginated order list (newest first).
func (s *OrderService) List(ctx context.Context, f OrderListFilter) (*OrderPage, error) {
	var where []string
	var params []any
	if f.Status != "" {
		params = append(params, f.Status)
		where = append(where, fmt.Sprintf("status = $%d", len(params)))
	}
	if f.MerchantID != "" {
		params = append(params, f.MerchantID)
		where = append(where, fmt.Sprintf("merchant_id = $%d", len(params)))
	}
	if f.Q != "" {
		params = append(params, "%"+util.JSTrim(f.Q)+"%")
		n := len(params)
		where = append(where, fmt.Sprintf("(id ILIKE $%d OR merchant_order_id ILIKE $%d OR card_mask ILIKE $%d)", n, n, n))
	}
	pageSize := f.PageSize
	if pageSize == 0 {
		pageSize = 50
	}
	pageSize = min(max(pageSize, 1), 200)
	page := max(f.Page, 1)
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}
	rows, err := s.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM orders %s ORDER BY created_at DESC, id LIMIT %d OFFSET %d`,
		orderCols, whereSQL, pageSize, (page-1)*pageSize), params...)
	if err != nil {
		return nil, err
	}
	var items []*Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM orders `+whereSQL, params...).Scan(&total); err != nil {
		return nil, err
	}
	return &OrderPage{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// Timeline returns the order's events (oldest first).
func (s *OrderService) Timeline(ctx context.Context, orderID string) ([]TimelineEvent, error) {
	rows, err := s.db.Query(ctx, `SELECT id, type, message, created_at FROM events WHERE order_id = $1 ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TimelineEvent
	for rows.Next() {
		var e TimelineEvent
		if err := rows.Scan(&e.ID, &e.Type, &e.Message, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Refunds returns the order's refunds (oldest first).
func (s *OrderService) Refunds(ctx context.Context, orderID string) ([]Refund, error) {
	return findRefunds(ctx, s.db, orderID)
}

// ---------------------------------------------------------------- internals

func (s *OrderService) findByMerchantOrderID(ctx context.Context, q Querier, merchantID, merchantOrderID string) (*Order, error) {
	o, err := scanOrder(q.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE merchant_id = $1 AND merchant_order_id = $2`, merchantID, merchantOrderID))
	if isNoRows(err) {
		return nil, nil
	}
	return o, err
}

func (s *OrderService) approve(ctx context.Context, tx pgx.Tx, current *Order, from []string, save bool, cardFields []set, message string) (*Order, error) {
	var token *string
	if save {
		mask, brand := deref(current.CardMask), "UNKNOWN"
		if current.CardBrand != nil {
			brand = *current.CardBrand
		}
		for _, f := range cardFields {
			switch f.col {
			case "card_mask":
				mask = f.value.(string)
			case "card_brand":
				brand = f.value.(string)
			}
		}
		var customerID *string
		if c := current.Customer(); c != nil {
			customerID = c.ID
		}
		t, err := s.tokens.Create(ctx, tx, current.MerchantID, mask, brand, customerID)
		if err != nil {
			return nil, err
		}
		token = &t
	}
	patch := append(append([]set{}, cardFields...),
		set{"status", StatusApproved}, set{"card_token", token}, set{"decline_code", (*string)(nil)}, set{"decline_reason", (*string)(nil)},
		set{"rrn", util.NewRRN()}, set{"approval_code", util.NewApprovalCode()}, set{"paid_at", nowValue{}})
	o, err := transition(ctx, tx, current.ID, from, patch...)
	if err != nil {
		return nil, err
	}
	if err := addEvent(ctx, tx, o.ID, "APPROVED", fmt.Sprintf("%s — RRN %s, auth code %s", message, deref(o.RRN), deref(o.ApprovalCode)), nil); err != nil {
		return nil, err
	}
	if token != nil {
		if err := addEvent(ctx, tx, o.ID, "TOKEN_CREATED", "Card saved as "+*token, nil); err != nil {
			return nil, err
		}
	}
	return o, nil
}

// finish is the generic final transition + timeline event + webhook. Returns nil when the order
// was not in from.
func (s *OrderService) finish(ctx context.Context, orderID string, from []string, status string, patch []set, message string, d delivery, skipLocked bool) (*Order, error) {
	var order *Order
	webhookID := ""
	err := withTx(ctx, s.db, func(tx pgx.Tx) error {
		if skipLocked {
			var id string
			err := tx.QueryRow(ctx, `SELECT id FROM orders WHERE id = $1 FOR UPDATE SKIP LOCKED`, orderID).Scan(&id)
			if isNoRows(err) {
				return nil
			}
			if err != nil {
				return err
			}
		}
		o, err := transition(ctx, tx, orderID, from, append(append([]set{}, patch...), set{"status", status})...)
		if err != nil || o == nil {
			return err
		}
		order = o
		if err := addEvent(ctx, tx, orderID, status, message, nil); err != nil {
			return err
		}
		webhookID, err = s.queueWebhook(ctx, tx, o)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.send(webhookID, d)
	return order, nil
}

func (s *OrderService) queueWebhook(ctx context.Context, tx pgx.Tx, o *Order) (string, error) {
	event := EventForStatus(o.Status)
	if event == "" || o.CallbackURL == nil || *o.CallbackURL == "" {
		return "", nil
	}
	j, err := loadOrderJSON(ctx, tx, o)
	if err != nil {
		return "", err
	}
	return s.webhooks.Enqueue(ctx, tx, o.MerchantID, *o.CallbackURL, event, j)
}

func (s *OrderService) send(webhookID string, d delivery) {
	if webhookID == "" {
		return
	}
	if d == deliverBackground {
		s.webhooks.Dispatch(webhookID)
		return
	}
	// A failing first attempt must never break the customer's flow; the scheduler retries it.
	// Not tied to the request context: a disconnecting browser must not abort the delivery.
	if err := s.webhooks.DeliverNow(context.Background(), webhookID); err != nil {
		s.log.Error("webhook delivery error", "webhookId", webhookID, "err", err.Error())
	}
}

// jsNumber prints a float like JavaScript's String(number) for the simple values used here.
func jsNumber(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%g", v)
}
