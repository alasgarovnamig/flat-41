// Package bookings — daily-rent bookings and reviews (money workstream).
//
//	POST /bookings/quote          [public] body BookingQuoteInput → BookingQuote
//	POST /bookings                [auth]   body CreateBookingInput → { booking, checkout } (201; dates held 30 min while PENDING_PAYMENT)
//	GET  /bookings                [auth]   query { role: guest|host, status?, page, pageSize } → Paginated<Booking>
//	GET  /bookings/:id            [guest|host|staff] → Booking
//	POST /bookings/:id/pay        [guest]  body { method: CARD|WALLET, returnUrl? } → CheckoutResponse
//	POST /bookings/:id/cancel     [guest|host] body { reason? } → Booking
//	POST /bookings/:id/review     [guest]  body { rating, comment } → Review (201)
//	POST /reviews/:id/reply       [host]   body { reply } → Review
//	GET  /admin/bookings          [admin]  query AdminBookingQuery → Paginated<Booking>
//	POST /admin/bookings/:id/cancel [ADMIN] body { reason } → Booking (full refund)
//
// Jobs: bookings.holds (5 min), bookings.complete-payout (hourly). Registers the BOOKING purpose handler.
package bookings

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

type Module struct {
	d   *app.Deps
	Svc *Service
}

func New(d *app.Deps) *Module {
	svc := NewService(d)
	d.Jobs.Every("bookings.holds", 5*time.Minute, func(ctx context.Context) error {
		_, err := svc.ReleaseExpiredHolds(ctx, time.Now())
		return err
	})
	d.Jobs.Every("bookings.complete-payout", time.Hour, func(ctx context.Context) error {
		_, err := svc.CompleteAndPayout(ctx, time.Now())
		return err
	})
	return &Module{d: d, Svc: svc}
}

// bookingDates (bookingQuoteSchema).
type quoteBody struct {
	ListingID string `json:"listingId" validate:"required,uuid"`
	CheckIn   string `json:"checkIn" validate:"required,isodate"`
	CheckOut  string `json:"checkOut" validate:"required,isodate"`
	Guests    int    `json:"guests" validate:"required,min=1,max=50"`
}

func checkDates(in, out string) []string {
	_, e1 := time.Parse("2006-01-02", in)
	_, e2 := time.Parse("2006-01-02", out)
	if e1 != nil || e2 != nil {
		return nil // format errors are reported by the isodate tag; impossible dates fall through to the check below
	}
	if !(out > in) {
		return []string{"checkOut: checkOut must be after checkIn"}
	}
	return nil
}

func (b *quoteBody) Check() []string { return checkDates(b.CheckIn, b.CheckOut) }

// createBookingSchema
type createBody struct {
	quoteBody
	Method    string  `json:"method" validate:"required,oneof=CARD WALLET"`
	ReturnURL *string `json:"returnUrl"`
}

func (b *createBody) Check() []string {
	errs := checkDates(b.CheckIn, b.CheckOut)
	if b.ReturnURL != nil && !payments.IsURL(*b.ReturnURL) {
		errs = append(errs, "returnUrl: Invalid url")
	}
	return errs
}

type payBody struct {
	Method    string  `json:"method" validate:"required,oneof=CARD WALLET"`
	ReturnURL *string `json:"returnUrl"`
}

func (b *payBody) Check() []string {
	if b.ReturnURL != nil && !payments.IsURL(*b.ReturnURL) {
		return []string{"returnUrl: Invalid url"}
	}
	return nil
}

// cancelBookingSchema
type cancelBody struct {
	Reason *string `json:"reason" validate:"omitempty,max=500"`
}

// adminCancelSchema
type adminCancelBody struct {
	Reason string `json:"reason" validate:"required,min=1,max=500"`
}

func (b *adminCancelBody) Normalize() { b.Reason = strings.TrimSpace(b.Reason) }

// reviewSchema
type reviewBody struct {
	Rating  int    `json:"rating" validate:"required,min=1,max=5"`
	Comment string `json:"comment" validate:"required,min=5,max=2000"`
}

func (b *reviewBody) Normalize() { b.Comment = strings.TrimSpace(b.Comment) }

// reviewReplySchema
type replyBody struct {
	Reply string `json:"reply" validate:"required,min=1,max=2000"`
}

func (b *replyBody) Normalize() { b.Reply = strings.TrimSpace(b.Reply) }

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func enumQ(q *httpx.Query, name string, allowed []string) *string {
	v := q.Str(name)
	if v != nil && !slices.Contains(allowed, *v) {
		q.Fail(name + ": Invalid option: expected one of " + strings.Join(allowed, "|"))
	}
	return v
}

func (m *Module) Routes(r chi.Router) {
	s := m.Svc
	r.Post("/bookings/quote", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var b quoteBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		userID := ""
		if u := auth.Current(r); u != nil {
			userID = u.ID
		}
		return s.Quote(r.Context(), Dates{ListingID: strings.ToLower(b.ListingID), CheckIn: b.CheckIn, CheckOut: b.CheckOut, Guests: b.Guests}, userID)
	}))
	r.With(auth.Required).Post("/bookings", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
		var b createBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return s.Create(r.Context(), auth.Current(r).ID, Dates{ListingID: strings.ToLower(b.ListingID), CheckIn: b.CheckIn, CheckOut: b.CheckOut, Guests: b.Guests},
			b.Method, str(b.ReturnURL))
	}))
	r.With(auth.Required).Get("/bookings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		pg, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		q := httpx.Q(r)
		role := "guest"
		if v := enumQ(q, "role", []string{"guest", "host"}); v != nil {
			role = *v
		}
		status := enumQ(q, "status", shared.Enum.BookingStatuses)
		if err := q.Err(); err != nil {
			return nil, err
		}
		return s.List(r.Context(), auth.Current(r).ID, role, status, pg)
	}))
	r.With(auth.Required).Get("/bookings/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return s.Get(r.Context(), auth.Current(r), id)
	}))
	r.With(auth.Required).Post("/bookings/{id}/pay", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		var b payBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return s.Pay(r.Context(), auth.Current(r).ID, id, b.Method, str(b.ReturnURL))
	}))
	r.With(auth.Required).Post("/bookings/{id}/cancel", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		var b cancelBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return s.Cancel(r.Context(), auth.Current(r), id, b.Reason, false)
	}))
	r.With(auth.Required).Post("/bookings/{id}/review", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		var b reviewBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return s.CreateReview(r.Context(), auth.Current(r).ID, id, b.Rating, b.Comment)
	}))
	r.With(auth.Required).Post("/reviews/{id}/reply", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		var b replyBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		return s.Reply(r.Context(), auth.Current(r).ID, id, b.Reply)
	}))

	r.With(auth.Roles("MODERATOR")).Get("/admin/bookings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		pg, err := httpx.Pagination(r, 20, 100)
		if err != nil {
			return nil, err
		}
		q := httpx.Q(r)
		status := enumQ(q, "status", shared.Enum.BookingStatuses)
		payout := enumQ(q, "payoutStatus", []string{"NOT_DUE", "PENDING", "PAID", "CANCELLED"})
		if err := q.Err(); err != nil {
			return nil, err
		}
		return s.AdminList(r.Context(), status, payout, pg)
	}))
	// Full refund to the guest regardless of timing.
	r.With(auth.Roles("ADMIN")).Post("/admin/bookings/{id}/cancel", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := httpx.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		var b adminCancelBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		user := auth.Current(r)
		bk, err := s.Cancel(r.Context(), user, id, &b.Reason, true)
		if err != nil {
			return nil, err
		}
		m.d.Audit.Log(r.Context(), &user.ID, "booking.cancel", "booking", &id, map[string]any{"reason": b.Reason, "refundedAmount": bk.RefundedAmount}, wallet.ClientIP(r))
		return bk, nil
	}))
}
