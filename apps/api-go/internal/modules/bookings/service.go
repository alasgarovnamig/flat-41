package bookings

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments/providers"
	"github.com/alasgarovnamig/evtap/api/internal/modules/promotions"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

var unavailableMessages = map[string]string{
	"OWN_LISTING":       "You cannot book your own listing",
	"PAST_DATE":         "Check-in date is in the past",
	"TOO_LONG":          fmt.Sprintf("Bookings are limited to %d nights", MaxNights),
	"MIN_NIGHTS":        "Stay is shorter than the minimum number of nights",
	"MAX_GUESTS":        "Too many guests for this listing",
	"DATES_UNAVAILABLE": "Selected dates are not available",
}

// Row is a row of the bookings table (dates as YYYY-MM-DD).
type Row struct {
	ID, ListingID, GuestID, HostID     string
	CheckIn, CheckOut                  string
	Nights, Guests                     int
	NightlyPrice                       int
	Currency                           string
	Subtotal, GuestFee, HostFee, Total int
	HostPayout                         int
	Status, PayoutStatus               string
	RefundedAmount                     int
	PaymentID                          *string
	HoldExpiresAt                      *time.Time
	CancelledBy, CancelReason          *string
	CancelledAt, PaidOutAt             *time.Time
	CreatedAt                          time.Time
}

const columns = `id, listing_id, guest_id, host_id, to_char(check_in, 'YYYY-MM-DD'), to_char(check_out, 'YYYY-MM-DD'), nights, guests,
	nightly_price, currency, subtotal, guest_fee, host_fee, total, host_payout, status, payout_status, refunded_amount, payment_id,
	hold_expires_at, cancelled_by, cancel_reason, cancelled_at, paid_out_at, created_at`

func scan(row interface{ Scan(...any) error }) (*Row, error) {
	var b Row
	err := row.Scan(&b.ID, &b.ListingID, &b.GuestID, &b.HostID, &b.CheckIn, &b.CheckOut, &b.Nights, &b.Guests, &b.NightlyPrice, &b.Currency,
		&b.Subtotal, &b.GuestFee, &b.HostFee, &b.Total, &b.HostPayout, &b.Status, &b.PayoutStatus, &b.RefundedAmount, &b.PaymentID,
		&b.HoldExpiresAt, &b.CancelledBy, &b.CancelReason, &b.CancelledAt, &b.PaidOutAt, &b.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func getBooking(ctx context.Context, q db.Querier, id string, lock string) (*Row, error) {
	b, err := scan(q.QueryRow(ctx, `select `+columns+` from bookings where id = $1 `+lock, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	return b, err
}

// ── DTOs (types.ts) ──

type Quote struct {
	ListingID         string `json:"listingId"`
	CheckIn           string `json:"checkIn"`
	CheckOut          string `json:"checkOut"`
	Nights            int    `json:"nights"`
	Guests            int    `json:"guests"`
	NightlyPrice      int64  `json:"nightlyPrice"`
	Currency          string `json:"currency"`
	Subtotal          int    `json:"subtotal"`
	GuestFee          int    `json:"guestFee"`
	Total             int    `json:"total"`
	Available         bool   `json:"available"`
	UnavailableReason string `json:"unavailableReason,omitempty"`
}

type bookingListing struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	CoverURL *string `json:"coverUrl"`
	CityID   string  `json:"cityId"`
	Address  *string `json:"address"`
}

type person struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Phone     *string `json:"phone"`
	AvatarURL *string `json:"avatarUrl"`
}

// Booking DTO.
type Booking struct {
	ID             string         `json:"id"`
	Listing        bookingListing `json:"listing"`
	Guest          person         `json:"guest"`
	Host           person         `json:"host"`
	CheckIn        string         `json:"checkIn"`
	CheckOut       string         `json:"checkOut"`
	Nights         int            `json:"nights"`
	Guests         int            `json:"guests"`
	NightlyPrice   int            `json:"nightlyPrice"`
	Currency       string         `json:"currency"`
	Subtotal       int            `json:"subtotal"`
	GuestFee       int            `json:"guestFee"`
	HostFee        int            `json:"hostFee"`
	Total          int            `json:"total"`
	HostPayout     int            `json:"hostPayout"`
	Status         string         `json:"status"`
	PayoutStatus   string         `json:"payoutStatus"`
	RefundedAmount int            `json:"refundedAmount"`
	PaymentID      *string        `json:"paymentId"`
	CancelledBy    *string        `json:"cancelledBy"`
	CancelReason   *string        `json:"cancelReason"`
	CanReview      bool           `json:"canReview"`
	CreatedAt      string         `json:"createdAt"`
}

type reviewAuthor struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

// Review DTO.
type Review struct {
	ID        string       `json:"id"`
	ListingID string       `json:"listingId"`
	BookingID string       `json:"bookingId"`
	Author    reviewAuthor `json:"author"`
	Rating    int          `json:"rating"`
	Comment   string       `json:"comment"`
	CreatedAt string       `json:"createdAt"`
	HostReply *string      `json:"hostReply"`
}

// CreateResult is the response of POST /bookings.
type CreateResult struct {
	Booking  *Booking                  `json:"booking"`
	Checkout payments.CheckoutResponse `json:"checkout"`
}

// Dates is the bookingDates input.
type Dates struct {
	ListingID         string
	CheckIn, CheckOut string
	Guests            int
}

// Service implements daily-rent bookings (Airbnb model).
type Service struct {
	pool     *pgxpool.Pool
	settings *settings.Service
	notify   *notify.Service
	payments *payments.Service
	wallet   *wallet.Service

	runningHolds, runningPayouts atomic.Bool
}

func NewService(d *app.Deps) *Service {
	s := &Service{pool: d.Pool, settings: d.Settings, notify: d.Notify, payments: payments.Engine(d), wallet: wallet.NewService(d.Pool)}
	s.payments.RegisterHandler("BOOKING", &payments.PurposeHandler{
		Fulfil:   s.onPaid,
		OnFailed: s.onPaymentFailed,
		Reverse: func(ctx context.Context, tx pgx.Tx, p *payments.Row, amount int, _ payments.RefundCtx) (payments.FulfilResult, error) {
			return payments.FulfilResult{}, s.onAdminRefund(ctx, tx, p, amount)
		},
	})
	return s
}

func (s *Service) provider() providers.Provider { return s.payments.Provider }

// ───────────────────────────── Availability & quote ─────────────────────────────

// IsAvailable: no blocked date and no live booking (CONFIRMED / COMPLETED, or PENDING_PAYMENT with a running hold) overlaps.
func (s *Service) IsAvailable(ctx context.Context, q db.Querier, listingID, checkIn, checkOut string, excludeBookingID *string) (bool, error) {
	var x int
	err := q.QueryRow(ctx, `select 1 from listing_blocked_dates where listing_id = $1 and date >= $2::date and date < $3::date limit 1`,
		listingID, checkIn, checkOut).Scan(&x)
	if err == nil {
		return false, nil
	}
	if !db.IsNoRows(err) {
		return false, err
	}
	err = q.QueryRow(ctx, `select 1 from bookings where listing_id = $1 and check_in < $3::date and check_out > $2::date
		and (status in ('CONFIRMED','COMPLETED') or (status = 'PENDING_PAYMENT' and hold_expires_at > now()))
		and ($4::uuid is null or id <> $4) limit 1`, listingID, checkIn, checkOut, excludeBookingID).Scan(&x)
	if db.IsNoRows(err) {
		return true, nil
	}
	return false, err
}

func (s *Service) evaluate(ctx context.Context, q db.Querier, l *promotions.ListingRow, in Dates, userID string, st shared.PlatformSettings) (*Quote, shared.BookingCalc, string, error) {
	if l == nil || l.Status != "ACTIVE" {
		return nil, shared.BookingCalc{}, "", httpx.E(http.StatusNotFound, "LISTING_NOT_AVAILABLE", "Listing is not available")
	}
	if l.DealType != "RENT_DAILY" {
		return nil, shared.BookingCalc{}, "", httpx.BadRequest("NOT_BOOKABLE", "Only daily-rent listings can be booked online")
	}
	nights := shared.NightsBetween(in.CheckIn, in.CheckOut)
	calc := shared.CalcBooking(int(l.Price), nights, st)
	reason := ""
	switch {
	case userID != "" && userID == l.OwnerID:
		reason = "OWN_LISTING"
	case in.CheckIn < LocalToday(time.Now()):
		reason = "PAST_DATE"
	case nights > MaxNights:
		reason = "TOO_LONG"
	case l.MinNights != nil && *l.MinNights > 0 && nights < *l.MinNights:
		reason = "MIN_NIGHTS"
	case l.MaxGuests != nil && *l.MaxGuests > 0 && in.Guests > *l.MaxGuests:
		reason = "MAX_GUESTS"
	default:
		ok, err := s.IsAvailable(ctx, q, l.ID, in.CheckIn, in.CheckOut, nil)
		if err != nil {
			return nil, calc, "", err
		}
		if !ok {
			reason = "DATES_UNAVAILABLE"
		}
	}
	return &Quote{
		ListingID: l.ID, CheckIn: in.CheckIn, CheckOut: in.CheckOut, Nights: nights, Guests: in.Guests, NightlyPrice: l.Price, Currency: l.Currency,
		Subtotal: calc.Subtotal, GuestFee: calc.GuestFee, Total: calc.Total, Available: reason == "", UnavailableReason: reason,
	}, calc, reason, nil
}

// Quote prices a stay (POST /bookings/quote).
func (s *Service) Quote(ctx context.Context, in Dates, userID string) (*Quote, error) {
	st, err := s.settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	l, err := promotions.GetListing(ctx, s.pool, in.ListingID, false)
	if err != nil {
		return nil, err
	}
	q, _, _, err := s.evaluate(ctx, s.pool, l, in, userID, st)
	return q, err
}

// ───────────────────────────── Create & pay ─────────────────────────────

type guestInfo struct {
	status, locale string
	phone, email   *string
}

func (s *Service) activeGuest(ctx context.Context, userID string) (*guestInfo, error) {
	var g guestInfo
	err := s.pool.QueryRow(ctx, `select status, locale, phone, email from users where id = $1`, userID).Scan(&g.status, &g.locale, &g.phone, &g.email)
	if err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	if db.IsNoRows(err) || g.status != "ACTIVE" {
		return nil, httpx.Forbidden("Account is not active")
	}
	return &g, nil
}

// Create holds the dates (PENDING_PAYMENT for 30 min) and starts the payment.
func (s *Service) Create(ctx context.Context, userID string, in Dates, method, returnURL string) (*CreateResult, error) {
	st, err := s.settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	guest, err := s.activeGuest(ctx, userID)
	if err != nil {
		return nil, err
	}
	ret, err := s.payments.ResolveReturnURL(returnURL) // validate before holding dates
	if err != nil {
		return nil, err
	}
	var started *payments.Started
	var booking *Row
	var title string

	// The listing row lock serialises concurrent bookings of the same listing → no double booking.
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		l, err := promotions.GetListing(ctx, tx, in.ListingID, true)
		if err != nil {
			return err
		}
		q, calc, reason, err := s.evaluate(ctx, tx, l, in, userID, st)
		if err != nil {
			return err
		}
		if reason != "" {
			msg := unavailableMessages[reason]
			if msg == "" {
				msg = reason
			}
			return httpx.E(http.StatusConflict, reason, msg)
		}
		title = l.Title
		booking, err = scan(tx.QueryRow(ctx, `insert into bookings (listing_id, guest_id, host_id, check_in, check_out, nights, guests, nightly_price, currency,
			subtotal, guest_fee, host_fee, total, host_payout, status, payout_status, hold_expires_at)
			values ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING_PAYMENT','NOT_DUE',$15) returning `+columns,
			l.ID, userID, l.OwnerID, in.CheckIn, in.CheckOut, q.Nights, in.Guests, int(l.Price), l.Currency, calc.Subtotal, calc.GuestFee, calc.HostFee,
			calc.Total, calc.HostPayout, time.Now().Add(HoldMinutes*time.Minute)))
		if err != nil {
			return err
		}
		if method == "WALLET" {
			spec := s.paymentSpec(booking, title, userID, ret)
			spec.Method, spec.Tx = "WALLET", tx
			started, err = s.payments.StartPayment(ctx, spec)
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if method == "WALLET" {
		started.AfterCommit(ctx)
	} else {
		spec := s.paymentSpec(booking, title, userID, ret)
		spec.Method, spec.Language, spec.Phone, spec.Email = "CARD", guest.locale, guest.phone, guest.email
		started, err = s.payments.StartPayment(ctx, spec)
		if err != nil {
			bg := context.WithoutCancel(ctx)
			if _, uerr := s.pool.Exec(bg, `update bookings set status = 'CANCELLED', payout_status = 'CANCELLED', cancel_reason = 'Ödəniş başladıla bilmədi',
				cancelled_at = now(), updated_at = now() where id = $1`, booking.ID); uerr != nil {
				slog.Error("cancel booking after payment start failure", "bookingId", booking.ID, "err", uerr)
			}
			return nil, err
		}
		if _, err := s.pool.Exec(ctx, `update bookings set payment_id = $2, updated_at = now() where id = $1 and status = 'PENDING_PAYMENT'`, booking.ID, started.Payment.ID); err != nil {
			return nil, err
		}
	}
	dto, err := s.getDto(ctx, booking.ID, userID)
	if err != nil {
		return nil, err
	}
	return &CreateResult{Booking: dto, Checkout: started.Checkout}, nil
}

func (s *Service) paymentSpec(b *Row, title, userID, returnURL string) payments.StartInput {
	return payments.StartInput{
		UserID: userID, Purpose: "BOOKING", Amount: b.Total, Currency: b.Currency, BookingID: &b.ID, ListingID: &b.ListingID, ReturnURL: returnURL,
		Description: fmt.Sprintf(`Rezervasiya: "%s" (%s – %s)`, title, b.CheckIn, b.CheckOut),
		Items: []payments.Item{
			{Code: "NIGHTS", Name: fmt.Sprintf("%d gecə × %d %s", b.Nights, b.NightlyPrice, b.Currency), Amount: b.Subtotal},
			{Code: "SERVICE_FEE", Name: "Xidmət haqqı", Amount: b.GuestFee},
		},
	}
}

// Pay (POST /bookings/:id/pay) resumes payment of the caller's PENDING_PAYMENT booking whose hold has not expired
// (e.g. the guest closed the bank page, or wants to pay from the wallet instead). A declined card has already
// released the booking (CANCELLED), so it cannot be resumed — the guest books again.
// CARD: the pending card payment's bank order is reused while it is still payable (CREATED / PROCESSING); otherwise a
// new payment is created. WALLET: an open (CREATED) bank order is cancelled first so the stay cannot be paid twice.
func (s *Service) Pay(ctx context.Context, userID, bookingID, method, returnURL string) (*payments.CheckoutResponse, error) {
	b, err := getBooking(ctx, s.pool, bookingID, "")
	if err != nil {
		return nil, err
	}
	if b == nil || b.GuestID != userID {
		return nil, httpx.NotFound("Booking")
	}
	if err := payable(b, time.Now()); err != nil {
		return nil, err
	}
	guest, err := s.activeGuest(ctx, userID)
	if err != nil {
		return nil, err
	}
	if returnURL != "" {
		if _, err := s.payments.ResolveReturnURL(returnURL); err != nil {
			return nil, err
		}
	}

	// Paying from the wallet: check the balance before touching an open card order (the debit stays authoritative).
	if method == "WALLET" {
		w, err := s.wallet.Get(ctx, nil, userID)
		if err != nil {
			return nil, err
		}
		if w.Balance+w.BonusBalance < b.Total {
			return nil, wallet.ErrInsufficientFunds()
		}
	}

	// 1. Look at the current card payment, if any.
	if b.PaymentID != nil {
		p, err := s.payments.GetRow(ctx, nil, *b.PaymentID)
		if err != nil {
			return nil, err
		}
		if p != nil && p.Method == "CARD" && p.Status == "PENDING" && p.ProviderOrderID != nil {
			order, err := s.provider().GetOrder(ctx, *p.ProviderOrderID)
			if err != nil {
				slog.Warn("pay: could not fetch order", "orderId", *p.ProviderOrderID, "err", err)
				return nil, httpx.E(http.StatusBadGateway, "PAYMENT_PROVIDER_UNAVAILABLE", "Payment provider is unavailable, try again later")
			}
			switch {
			case providers.IsPaid(order.Status):
				// Already paid at the bank (webhook not processed yet) → finalise now.
				done, err := s.payments.ApplyProviderOrder(ctx, order)
				if err != nil {
					return nil, err
				}
				if done == nil {
					done = p
				}
				return &payments.CheckoutResponse{PaymentID: done.ID, Status: done.Status, Amount: done.Amount, Currency: done.Currency}, nil
			case order.Status == providers.StatusCreated || order.Status == providers.StatusProcessing:
				url, _ := p.ProviderData["paymentUrl"].(string)
				if method == "CARD" && url != "" {
					if returnURL != "" {
						if _, err := s.pool.Exec(ctx, `update payments set return_url = $2, updated_at = now() where id = $1`, p.ID, returnURL); err != nil {
							return nil, err
						}
					}
					return &payments.CheckoutResponse{PaymentID: p.ID, Status: "PENDING", Amount: p.Amount, Currency: p.Currency, PaymentURL: &url}, nil
				}
				if order.Status == providers.StatusProcessing {
					return nil, httpx.Conflict("CONFLICT", "A card payment for this booking is in progress")
				}
				// Switching method (or no stored URL): cancel the open order so it cannot be paid as well.
				if err := s.detachPayment(ctx, b.ID, p.ID); err != nil {
					return nil, err
				}
				cancelled, err := s.provider().Cancel(ctx, order.OrderID)
				if err != nil {
					return nil, httpx.Conflict("CONFLICT", "The pending card payment could not be cancelled, try again")
				}
				if _, err := s.payments.ApplyProviderOrder(ctx, cancelled); err != nil {
					return nil, err
				}
			default:
				// DECLINED / CANCELLED / EXPIRED at the bank (webhook not processed yet) → record it, then start a new payment.
				if err := s.detachPayment(ctx, b.ID, p.ID); err != nil {
					return nil, err
				}
				if _, err := s.payments.ApplyProviderOrder(ctx, order); err != nil {
					return nil, err
				}
			}
		}
	}

	// 2. New payment.
	var title string
	if err := s.pool.QueryRow(ctx, `select title from listings where id = $1`, b.ListingID).Scan(&title); err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	ret, err := s.payments.ResolveReturnURL(returnURL)
	if err != nil {
		return nil, err
	}
	if method == "WALLET" {
		var started *payments.Started
		err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
			// lock order: listing → booking (same as create / payment fulfilment)
			if _, err := tx.Exec(ctx, `select id from listings where id = $1 for update`, b.ListingID); err != nil {
				return err
			}
			cur, err := getBooking(ctx, tx, b.ID, "for update")
			if err != nil {
				return err
			}
			if err := payable(cur, time.Now()); err != nil {
				return err
			}
			spec := s.paymentSpec(cur, title, userID, ret)
			spec.Method, spec.Tx = "WALLET", tx
			started, err = s.payments.StartPayment(ctx, spec)
			return err
		})
		if err != nil {
			return nil, err
		}
		started.AfterCommit(ctx)
		return &started.Checkout, nil
	}
	cur, err := getBooking(ctx, s.pool, b.ID, "")
	if err != nil {
		return nil, err
	}
	if err := payable(cur, time.Now()); err != nil {
		return nil, err
	}
	spec := s.paymentSpec(cur, title, userID, ret)
	spec.Method, spec.Language, spec.Phone, spec.Email = "CARD", guest.locale, guest.phone, guest.email
	started, err := s.payments.StartPayment(ctx, spec)
	if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `update bookings set payment_id = $2, updated_at = now() where id = $1 and status = 'PENDING_PAYMENT'`, b.ID, started.Payment.ID); err != nil {
		return nil, err
	}
	return &started.Checkout, nil
}

// detachPayment unlinks a superseded payment from a PENDING_PAYMENT booking (see onPaymentFailed).
func (s *Service) detachPayment(ctx context.Context, bookingID, paymentID string) error {
	_, err := s.pool.Exec(ctx, `update bookings set payment_id = null, updated_at = now() where id = $1 and payment_id = $2 and status = 'PENDING_PAYMENT'`,
		bookingID, paymentID)
	return err
}

// payable: PENDING_PAYMENT with a running hold.
func payable(b *Row, now time.Time) error {
	if b == nil {
		return httpx.NotFound("Booking")
	}
	if b.Status != "PENDING_PAYMENT" {
		return httpx.E(http.StatusConflict, "INVALID_STATUS", fmt.Sprintf("Booking in status %s is not awaiting payment", b.Status))
	}
	if b.HoldExpiresAt == nil || !b.HoldExpiresAt.After(now) {
		return httpx.E(http.StatusConflict, "INVALID_STATUS", "The booking hold has expired; create a new booking")
	}
	return nil
}

// onPaid: BOOKING payment succeeded (runs in the payment transaction).
func (s *Service) onPaid(ctx context.Context, tx pgx.Tx, p *payments.Row) (payments.FulfilResult, error) {
	gone := payments.FulfilResult{RefundReason: "Rezervasiya tapılmadı"}
	if p.BookingID == nil {
		return gone, nil
	}
	var listingID string
	err := tx.QueryRow(ctx, `select listing_id from bookings where id = $1`, *p.BookingID).Scan(&listingID)
	if db.IsNoRows(err) {
		return gone, nil
	}
	if err != nil {
		return payments.FulfilResult{}, err
	}
	if _, err := tx.Exec(ctx, `select id from listings where id = $1 for update`, listingID); err != nil { // same lock order as create
		return payments.FulfilResult{}, err
	}
	b, err := getBooking(ctx, tx, *p.BookingID, "for update")
	if err != nil {
		return payments.FulfilResult{}, err
	}
	if b.PaymentID != nil && *b.PaymentID == p.ID && (b.Status == "CONFIRMED" || b.Status == "COMPLETED") {
		return payments.FulfilResult{}, nil
	}
	// A hold cancelled by the system (expired / failed attempt) is revived when the dates are still free.
	revivable := b.Status == "PENDING_PAYMENT" || (b.Status == "CANCELLED" && b.CancelledBy == nil && b.RefundedAmount == 0)
	if revivable {
		ok, err := s.IsAvailable(ctx, tx, b.ListingID, b.CheckIn, b.CheckOut, &b.ID)
		if err != nil {
			return payments.FulfilResult{}, err
		}
		revivable = ok
	}
	if !revivable {
		return payments.FulfilResult{RefundReason: "Seçilmiş tarixlər artıq mövcud deyil"}, nil
	}
	c, err := scan(tx.QueryRow(ctx, `update bookings set status = 'CONFIRMED', payment_id = $2, hold_expires_at = null, payout_status = 'PENDING',
		cancel_reason = null, cancelled_at = null, updated_at = now() where id = $1 returning `+columns, b.ID, p.ID))
	if err != nil {
		return payments.FulfilResult{}, err
	}
	return payments.FulfilResult{After: func(ctx context.Context) error { return s.notifyConfirmed(ctx, c) }}, nil
}

// onPaymentFailed: a failed / cancelled card payment releases the hold (CANCELLED, dates free again) like the former
// API. Only the booking's current payment can do that: POST /bookings/:id/pay detaches a superseded payment
// (payment_id = null) before closing its bank order, so that order's failure leaves the booking alone.
func (s *Service) onPaymentFailed(ctx context.Context, tx pgx.Tx, p *payments.Row) (payments.FulfilResult, error) {
	if p.BookingID == nil {
		return payments.FulfilResult{}, nil
	}
	_, err := tx.Exec(ctx, `update bookings set status = 'CANCELLED', payout_status = 'CANCELLED', cancel_reason = 'Ödəniş alınmadı', cancelled_at = now(),
		hold_expires_at = null, updated_at = now() where id = $1 and status = 'PENDING_PAYMENT' and payment_id = $2`, *p.BookingID, p.ID)
	return payments.FulfilResult{}, err
}

// onAdminRefund: admin refund of a booking payment (POST /admin/payments/:id/refund). Full refund → REFUNDED, payout
// cancelled if not paid yet.
func (s *Service) onAdminRefund(ctx context.Context, tx pgx.Tx, p *payments.Row, amount int) error {
	if p.BookingID == nil {
		return nil
	}
	b, err := getBooking(ctx, tx, *p.BookingID, "for update")
	if err != nil || b == nil {
		return err
	}
	refunded := b.RefundedAmount + amount
	if refunded < b.Total {
		_, err = tx.Exec(ctx, `update bookings set refunded_amount = $2, updated_at = now() where id = $1`, b.ID, refunded)
		return err
	}
	if b.PayoutStatus != "PAID" {
		_, err = tx.Exec(ctx, `update bookings set refunded_amount = $2, status = 'REFUNDED', payout_status = 'CANCELLED', host_payout = 0, updated_at = now() where id = $1`, b.ID, refunded)
	} else {
		_, err = tx.Exec(ctx, `update bookings set refunded_amount = $2, status = 'REFUNDED', updated_at = now() where id = $1`, b.ID, refunded)
	}
	return err
}

func (s *Service) notifyConfirmed(ctx context.Context, b *Row) error {
	var title string
	if err := s.pool.QueryRow(ctx, `select title from listings where id = $1`, b.ListingID).Scan(&title); err != nil && !db.IsNoRows(err) {
		return err
	}
	data := map[string]any{"bookingId": b.ID, "listingId": b.ListingID}
	if _, err := s.notify.Notify(ctx, b.HostID, "BOOKING_NEW", "Yeni rezervasiya", fmt.Sprintf(`"%s": %s – %s, %d qonaq. Qazancınız: %s.`,
		title, b.CheckIn, b.CheckOut, b.Guests, wallet.FormatMoney(b.HostPayout, b.Currency)), data); err != nil {
		return err
	}
	_, err := s.notify.Notify(ctx, b.GuestID, "BOOKING_CONFIRMED", "Rezervasiya təsdiqləndi", fmt.Sprintf(`"%s": %s – %s. Xoş istirahətlər!`, title, b.CheckIn, b.CheckOut), data)
	return err
}

// ───────────────────────────── Read ─────────────────────────────

// List returns the caller's bookings as guest or host.
func (s *Service) List(ctx context.Context, userID, role string, status *string, pg httpx.PageArgs) (httpx.Paginated[Booking], error) {
	where := `guest_id = $1`
	if role == "host" {
		where = `host_id = $1`
	}
	args := []any{userID}
	if status != nil {
		args = append(args, *status)
		where += ` and status = $2`
	} else if role == "host" {
		where += ` and status <> 'PENDING_PAYMENT'` // hosts don't need to see abandoned unpaid holds
	}
	return s.page(ctx, where, args, pg, &userID)
}

// AdminList implements GET /admin/bookings.
func (s *Service) AdminList(ctx context.Context, status, payoutStatus *string, pg httpx.PageArgs) (httpx.Paginated[Booking], error) {
	return s.page(ctx, `($1::text is null or status = $1) and ($2::text is null or payout_status = $2)`, []any{status, payoutStatus}, pg, nil)
}

func (s *Service) page(ctx context.Context, where string, args []any, pg httpx.PageArgs, viewerID *string) (httpx.Paginated[Booking], error) {
	n := len(args)
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`select `+columns+` from bookings where %s order by created_at desc limit $%d offset $%d`, where, n+1, n+2),
		append(args, pg.Limit, pg.Offset)...)
	if err != nil {
		return httpx.Paginated[Booking]{}, err
	}
	var list []*Row
	for rows.Next() {
		b, err := scan(rows)
		if err != nil {
			rows.Close()
			return httpx.Paginated[Booking]{}, err
		}
		list = append(list, b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return httpx.Paginated[Booking]{}, err
	}
	var total int
	if err := s.pool.QueryRow(ctx, `select count(*) from bookings where `+where, args...).Scan(&total); err != nil {
		return httpx.Paginated[Booking]{}, err
	}
	items, err := s.ToDtos(ctx, list, viewerID)
	if err != nil {
		return httpx.Paginated[Booking]{}, err
	}
	return httpx.NewPage(items, total, pg.Page, pg.PageSize), nil
}

// Get returns a booking visible to its guest, host or staff.
func (s *Service) Get(ctx context.Context, user *auth.User, id string) (*Booking, error) {
	b, err := getBooking(ctx, s.pool, id, "")
	if err != nil {
		return nil, err
	}
	if b == nil || (!user.IsStaff() && b.GuestID != user.ID && b.HostID != user.ID) {
		return nil, httpx.NotFound("Booking")
	}
	out, err := s.ToDtos(ctx, []*Row{b}, &user.ID)
	if err != nil {
		return nil, err
	}
	return &out[0], nil
}

func (s *Service) getDto(ctx context.Context, id, viewerID string) (*Booking, error) {
	b, err := getBooking(ctx, s.pool, id, "")
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, httpx.NotFound("Booking")
	}
	out, err := s.ToDtos(ctx, []*Row{b}, &viewerID)
	if err != nil {
		return nil, err
	}
	return &out[0], nil
}

// ToDtos maps booking rows to DTOs. viewerID nil = staff list (contact phones always shown).
func (s *Service) ToDtos(ctx context.Context, rows []*Row, viewerID *string) ([]Booking, error) {
	out := []Booking{}
	if len(rows) == 0 {
		return out, nil
	}
	var listingIDs, userIDs, bookingIDs []string
	for _, b := range rows {
		if !slices.Contains(listingIDs, b.ListingID) {
			listingIDs = append(listingIDs, b.ListingID)
		}
		for _, u := range []string{b.GuestID, b.HostID} {
			if !slices.Contains(userIDs, u) {
				userIDs = append(userIDs, u)
			}
		}
		bookingIDs = append(bookingIDs, b.ID)
	}
	type lInfo struct {
		title, cityID string
		address       *string
	}
	ls := map[string]lInfo{}
	lr, err := s.pool.Query(ctx, `select id, title, city_id, address from listings where id = any($1::uuid[])`, listingIDs)
	if err != nil {
		return nil, err
	}
	for lr.Next() {
		var id string
		var li lInfo
		if err := lr.Scan(&id, &li.title, &li.cityID, &li.address); err != nil {
			lr.Close()
			return nil, err
		}
		ls[id] = li
	}
	lr.Close()
	type uInfo struct {
		name          string
		phone, avatar *string
	}
	us := map[string]uInfo{}
	ur, err := s.pool.Query(ctx, `select id, name, phone, avatar_url from users where id = any($1::uuid[])`, userIDs)
	if err != nil {
		return nil, err
	}
	for ur.Next() {
		var id string
		var ui uInfo
		if err := ur.Scan(&id, &ui.name, &ui.phone, &ui.avatar); err != nil {
			ur.Close()
			return nil, err
		}
		us[id] = ui
	}
	ur.Close()
	covers, err := promotions.ListingCovers(ctx, s.pool, listingIDs)
	if err != nil {
		return nil, err
	}
	reviewed := map[string]bool{}
	rr, err := s.pool.Query(ctx, `select booking_id from reviews where booking_id = any($1::uuid[])`, bookingIDs)
	if err != nil {
		return nil, err
	}
	for rr.Next() {
		var id string
		if err := rr.Scan(&id); err != nil {
			rr.Close()
			return nil, err
		}
		reviewed[id] = true
	}
	rr.Close()

	for _, b := range rows {
		l := ls[b.ListingID]
		// Contact phones are only shared once the stay is paid.
		showPhones := viewerID == nil || b.Status == "CONFIRMED" || b.Status == "COMPLETED"
		pers := func(id string) person {
			u := us[id]
			p := person{ID: id, Name: u.name, AvatarURL: u.avatar}
			if showPhones {
				p.Phone = u.phone
			}
			return p
		}
		out = append(out, Booking{
			ID:      b.ID,
			Listing: bookingListing{ID: b.ListingID, Title: l.title, CoverURL: covers[b.ListingID].CoverURL, CityID: l.cityID, Address: l.address},
			Guest:   pers(b.GuestID), Host: pers(b.HostID),
			CheckIn: b.CheckIn, CheckOut: b.CheckOut, Nights: b.Nights, Guests: b.Guests, NightlyPrice: b.NightlyPrice, Currency: b.Currency,
			Subtotal: b.Subtotal, GuestFee: b.GuestFee, HostFee: b.HostFee, Total: b.Total, HostPayout: b.HostPayout,
			Status: b.Status, PayoutStatus: b.PayoutStatus, RefundedAmount: b.RefundedAmount, PaymentID: b.PaymentID,
			CancelledBy: b.CancelledBy, CancelReason: b.CancelReason,
			CanReview: viewerID != nil && *viewerID == b.GuestID && b.Status == "COMPLETED" && !reviewed[b.ID],
			CreatedAt: httpx.ISO(b.CreatedAt),
		})
	}
	return out, nil
}

// ───────────────────────────── Cancel ─────────────────────────────

// Cancel: guest / host / admin cancellation with refund per policy (see policy.go). Refund goes to the original method.
func (s *Service) Cancel(ctx context.Context, actor *auth.User, id string, reason *string, asAdmin bool) (*Booking, error) {
	pre, err := getBooking(ctx, s.pool, id, "")
	if err != nil {
		return nil, err
	}
	if pre == nil {
		return nil, httpx.NotFound("Booking")
	}
	var by string
	switch {
	case asAdmin:
		by = ByAdmin
	case pre.GuestID == actor.ID:
		by = ByGuest
	case pre.HostID == actor.ID:
		by = ByHost
	default:
		return nil, httpx.NotFound("Booking")
	}
	st, err := s.settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	var title string
	var checkInTime *string
	if err := s.pool.QueryRow(ctx, `select title, check_in_time from listings where id = $1`, pre.ListingID).Scan(&title, &checkInTime); err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	var effects []wallet.Effect
	var pendingOrder *string

	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		// lock order: payment → booking (same as the payment finalisation path)
		if pre.PaymentID != nil {
			if _, err := tx.Exec(ctx, `select id from payments where id = $1 for update`, *pre.PaymentID); err != nil {
				return err
			}
		}
		b, err := getBooking(ctx, tx, id, "for update")
		if err != nil {
			return err
		}
		now := time.Now()
		if b.Status == "PENDING_PAYMENT" {
			if _, err := tx.Exec(ctx, `update bookings set status = 'CANCELLED', cancelled_by = $2, cancel_reason = $3, cancelled_at = $4, hold_expires_at = null,
				payout_status = 'CANCELLED', updated_at = now() where id = $1`, b.ID, by, reason, now); err != nil {
				return err
			}
			if b.PaymentID != nil {
				var pstatus string
				var orderID *string
				err := tx.QueryRow(ctx, `select status, provider_order_id from payments where id = $1`, *b.PaymentID).Scan(&pstatus, &orderID)
				if err != nil && !db.IsNoRows(err) {
					return err
				}
				if pstatus == "PENDING" && orderID != nil {
					pendingOrder = orderID
				}
			}
			return nil
		}
		if b.Status != "CONFIRMED" {
			return httpx.E(http.StatusConflict, "BOOKING_NOT_CANCELLABLE", fmt.Sprintf("Booking in status %s cannot be cancelled", b.Status))
		}
		hoursBefore := float64(CheckInMoment(b.CheckIn, checkInTime).Sub(now)) / float64(time.Hour)
		if by != ByAdmin && hoursBefore <= 0 {
			return httpx.E(http.StatusConflict, "BOOKING_ALREADY_STARTED", "The stay has already started; contact support")
		}
		outcome := Cancellation(Amounts{Subtotal: b.Subtotal, GuestFee: b.GuestFee, HostFee: b.HostFee, Total: b.Total}, by, hoursBefore, st.FreeCancellationHours)

		payoutStatus := "CANCELLED"
		if outcome.HostPayout > 0 {
			payoutStatus = "PENDING"
		}
		if b.PayoutStatus == "PAID" {
			// Only possible for admin cancellations during the stay: claw back what the host received beyond the new payout.
			if clawback := b.HostPayout - outcome.HostPayout; clawback > 0 {
				if _, err := s.wallet.DebitTx(ctx, tx, b.HostID, clawback, fmt.Sprintf("Rezervasiya ləğvi: ödənişin geri alınması (%s – %s)", b.CheckIn, b.CheckOut),
					app.WalletOpts{TxType: "ADJUSTMENT", Source: wallet.RealOnly, BookingID: &b.ID, ActorID: &actor.ID}); err != nil {
					return err
				}
			}
			payoutStatus = "PAID"
		}
		if outcome.Refund > 0 && b.PaymentID != nil {
			var actorID *string
			if asAdmin {
				actorID = &actor.ID
			}
			if _, err := s.payments.Refund(ctx, *b.PaymentID, payments.RefundInput{Amount: outcome.Refund, Reason: fmt.Sprintf("Rezervasiya ləğvi (%s)", by),
				ActorID: actorID, Tx: tx, Effects: &effects}); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `update bookings set status = 'CANCELLED', cancelled_by = $2, cancel_reason = $3, cancelled_at = $4, hold_expires_at = null,
			payout_status = $5, host_payout = $6, refunded_amount = $7, updated_at = now() where id = $1`,
			b.ID, by, reason, now, payoutStatus, outcome.HostPayout, b.RefundedAmount+outcome.Refund); err != nil {
			return err
		}

		data := map[string]any{"bookingId": b.ID, "listingId": b.ListingID}
		refundText := ""
		if outcome.Refund > 0 {
			refundText = " Geri qaytarılan məbləğ: " + wallet.FormatMoney(outcome.Refund, b.Currency) + "."
		}
		var guestText string
		if by != ByGuest {
			who := "administrator"
			if by == ByHost {
				who = "ev sahibi"
			}
			guestText = fmt.Sprintf(`"%s" (%s – %s) rezervasiyası %s tərəfindən ləğv edildi.%s`, title, b.CheckIn, b.CheckOut, who, refundText)
		} else {
			guestText = fmt.Sprintf(`"%s" (%s – %s) rezervasiyanız ləğv edildi.%s`, title, b.CheckIn, b.CheckOut, refundText)
		}
		guestID, hostID := b.GuestID, b.HostID
		effects = append(effects, func(ctx context.Context) error {
			_, err := s.notify.Notify(ctx, guestID, "BOOKING_CANCELLED", "Rezervasiya ləğv edildi", guestText, data)
			return err
		})
		if by != ByHost {
			who := "administrator"
			if by == ByGuest {
				who = "qonaq"
			}
			hostText := fmt.Sprintf(`"%s" (%s – %s) rezervasiyası %s tərəfindən ləğv edildi.`, title, b.CheckIn, b.CheckOut, who)
			effects = append(effects, func(ctx context.Context) error {
				_, err := s.notify.Notify(ctx, hostID, "BOOKING_CANCELLED", "Rezervasiya ləğv edildi", hostText, data)
				return err
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if pendingOrder != nil {
		orderID := *pendingOrder
		effects = append(effects, func(ctx context.Context) error { s.cancelBankOrder(ctx, orderID); return nil })
	}
	wallet.RunEffects(ctx, effects)
	return s.Get(ctx, actor, id)
}

func (s *Service) cancelBankOrder(ctx context.Context, orderID string) {
	order, err := s.provider().Cancel(ctx, orderID)
	if err == nil {
		_, err = s.payments.ApplyProviderOrder(ctx, order)
	}
	if err != nil {
		slog.Warn("could not cancel bank order", "orderId", orderID, "err", err)
	}
}

// ───────────────────────────── Reviews ─────────────────────────────

// CreateReview (POST /bookings/:id/review): only the guest, only COMPLETED stays, once.
func (s *Service) CreateReview(ctx context.Context, userID, bookingID string, rating int, comment string) (*Review, error) {
	var reviewID string
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		b, err := getBooking(ctx, tx, bookingID, "for update")
		if err != nil {
			return err
		}
		if b == nil || b.GuestID != userID {
			return httpx.NotFound("Booking")
		}
		if b.Status != "COMPLETED" {
			return httpx.E(http.StatusConflict, "BOOKING_NOT_COMPLETED", "Only completed stays can be reviewed")
		}
		var x int
		err = tx.QueryRow(ctx, `select 1 from reviews where booking_id = $1`, b.ID).Scan(&x)
		if err == nil {
			return httpx.E(http.StatusConflict, "ALREADY_REVIEWED", "This booking has already been reviewed")
		}
		if !db.IsNoRows(err) {
			return err
		}
		if err := tx.QueryRow(ctx, `insert into reviews (booking_id, listing_id, author_id, rating, comment) values ($1,$2,$3,$4,$5) returning id`,
			b.ID, b.ListingID, userID, rating, comment).Scan(&reviewID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update listings set
			rating_avg = (select round(avg(r.rating)::numeric, 2)::real from reviews r where r.listing_id = $1),
			reviews_count = (select count(*)::int from reviews r where r.listing_id = $1), updated_at = now() where id = $1`, b.ListingID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.review(ctx, reviewID)
}

// Reply (POST /reviews/:id/reply): only the host of the reviewed booking.
func (s *Service) Reply(ctx context.Context, userID, reviewID, reply string) (*Review, error) {
	var hostID string
	err := s.pool.QueryRow(ctx, `select b.host_id from reviews r join bookings b on b.id = r.booking_id where r.id = $1`, reviewID).Scan(&hostID)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Review")
	}
	if err != nil {
		return nil, err
	}
	if hostID != userID {
		return nil, httpx.Forbidden("Only the host can reply")
	}
	if _, err := s.pool.Exec(ctx, `update reviews set host_reply = $2 where id = $1`, reviewID, reply); err != nil {
		return nil, err
	}
	return s.review(ctx, reviewID)
}

func (s *Service) review(ctx context.Context, id string) (*Review, error) {
	var r Review
	var created time.Time
	var name *string
	err := s.pool.QueryRow(ctx, `select r.id, r.listing_id, r.booking_id, r.author_id, u.name, u.avatar_url, r.rating, r.comment, r.created_at, r.host_reply
		from reviews r left join users u on u.id = r.author_id where r.id = $1`, id).
		Scan(&r.ID, &r.ListingID, &r.BookingID, &r.Author.ID, &name, &r.Author.AvatarURL, &r.Rating, &r.Comment, &created, &r.HostReply)
	if err != nil {
		return nil, err
	}
	if name != nil {
		r.Author.Name = *name
	}
	r.CreatedAt = httpx.ISO(created)
	return &r, nil
}

// ───────────────────────────── Crons ─────────────────────────────

// ReleaseExpiredHolds (every 5 min): unpaid holds past hold_expires_at → CANCELLED (and the bank order is cancelled
// when still open). Returns the number of released holds.
func (s *Service) ReleaseExpiredHolds(ctx context.Context, now time.Time) (int, error) {
	if !s.runningHolds.CompareAndSwap(false, true) {
		return 0, nil
	}
	defer s.runningHolds.Store(false)
	rows, err := s.pool.Query(ctx, `select id from bookings where status = 'PENDING_PAYMENT' and hold_expires_at < $1 limit 500`, now)
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
	n := 0
	for _, id := range ids {
		var orderID *string
		err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
			b, err := getBooking(ctx, tx, id, "for update skip locked")
			if err != nil || b == nil {
				return err
			}
			if b.Status != "PENDING_PAYMENT" || b.HoldExpiresAt == nil || !b.HoldExpiresAt.Before(now) {
				return nil
			}
			var pstatus string
			var poid *string
			if b.PaymentID != nil {
				if err := tx.QueryRow(ctx, `select status, provider_order_id from payments where id = $1`, *b.PaymentID).Scan(&pstatus, &poid); err != nil && !db.IsNoRows(err) {
					return err
				}
			}
			if _, err := tx.Exec(ctx, `update bookings set status = 'CANCELLED', payout_status = 'CANCELLED', cancel_reason = 'Ödəniş vaxtı bitdi', cancelled_at = $2,
				updated_at = now() where id = $1`, id, now); err != nil {
				return err
			}
			n++
			if pstatus == "PENDING" {
				orderID = poid
			}
			return nil
		})
		if err != nil {
			return n, err
		}
		if orderID != nil {
			s.cancelBankOrder(ctx, *orderID)
		}
	}
	return n, nil
}

// PayoutStats is the result of CompleteAndPayout.
type PayoutStats struct{ Completed, PaidOut int }

// CompleteAndPayout (hourly): CONFIRMED stays whose check-out date has come → COMPLETED; host payouts (wallet PAYOUT of
// hostPayout) once check-in + payoutDelayHours has passed (PENDING → PAID).
func (s *Service) CompleteAndPayout(ctx context.Context, now time.Time) (PayoutStats, error) {
	var st PayoutStats
	if !s.runningPayouts.CompareAndSwap(false, true) {
		return st, nil
	}
	defer s.runningPayouts.Store(false)
	tag, err := s.pool.Exec(ctx, `update bookings set status = 'COMPLETED', updated_at = now() where status = 'CONFIRMED' and check_out <= $1::date`, LocalToday(now))
	if err != nil {
		return st, err
	}
	st.Completed = int(tag.RowsAffected())

	ps, err := s.settings.Settings(ctx)
	if err != nil {
		return st, err
	}
	tomorrow := LocalToday(now.Add(24 * time.Hour))
	rows, err := s.pool.Query(ctx, `select b.id, to_char(b.check_in, 'YYYY-MM-DD'), l.check_in_time, l.title from bookings b join listings l on l.id = b.listing_id
		where b.payout_status = 'PENDING' and b.status in ('CONFIRMED','COMPLETED','CANCELLED') and b.check_in <= $1::date limit 500`, tomorrow)
	if err != nil {
		return st, err
	}
	type due struct {
		id, checkIn, title string
		checkInTime        *string
	}
	var dues []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.checkIn, &d.checkInTime, &d.title); err != nil {
			rows.Close()
			return st, err
		}
		dues = append(dues, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return st, err
	}
	for _, d := range dues {
		if CheckInMoment(d.checkIn, d.checkInTime).Add(time.Duration(ps.PayoutDelayHours) * time.Hour).After(now) {
			continue
		}
		var paid *Row
		err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
			b, err := getBooking(ctx, tx, d.id, "for update skip locked")
			if err != nil || b == nil || b.PayoutStatus != "PENDING" {
				return err
			}
			// TODO: currency conversion — wallets are AZN; GEL bookings are credited 1:1 until FX rates exist.
			if b.HostPayout > 0 {
				if _, err := s.wallet.CreditTx(ctx, tx, b.HostID, b.HostPayout, "PAYOUT", fmt.Sprintf(`Rezervasiya qazancı: "%s" (%s – %s)`, d.title, b.CheckIn, b.CheckOut),
					app.WalletOpts{BookingID: &b.ID}); err != nil {
					return err
				}
			}
			status := "CANCELLED"
			if b.HostPayout > 0 {
				status = "PAID"
			}
			paid, err = scan(tx.QueryRow(ctx, `update bookings set payout_status = $2, paid_out_at = now(), updated_at = now() where id = $1 returning `+columns, b.ID, status))
			return err
		})
		if err != nil {
			return st, err
		}
		if paid != nil && paid.HostPayout > 0 {
			st.PaidOut++
			p, title := paid, d.title
			wallet.RunEffects(ctx, []wallet.Effect{func(ctx context.Context) error {
				_, err := s.notify.Notify(ctx, p.HostID, "PAYOUT", "Qazancınız balansa köçürüldü",
					fmt.Sprintf(`"%s" (%s – %s) rezervasiyası üzrə %s balansınıza əlavə olundu.`, title, p.CheckIn, p.CheckOut, wallet.FormatMoney(p.HostPayout, p.Currency)),
					map[string]any{"bookingId": p.ID})
				return err
			}})
		}
	}
	return st, nil
}
