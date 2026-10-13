package payments

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// bakuOffset: stats day boundaries and admin date filters follow Baku time (UTC+4, no DST).
var bakuOffset = time.FixedZone("Asia/Baku", 4*3600)

type adminPayment struct {
	Payment
	UserName string `json:"userName"`
}

type adminPaymentUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Phone *string `json:"phone"`
	Email *string `json:"email"`
}

type adminPaymentDetail struct {
	Payment
	User         adminPaymentUser `json:"user"`
	ProviderData map[string]any   `json:"providerData"`
	Metadata     map[string]any   `json:"metadata"`
	FulfilledAt  *string          `json:"fulfilledAt"`
}

// adminList implements GET /admin/payments (adminPaymentQuerySchema).
func (s *Service) adminList(r *http.Request) (any, error) {
	pg, err := httpx.Pagination(r, 20, 100)
	if err != nil {
		return nil, err
	}
	q := httpx.Q(r)
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "$?", "$"+strconv.Itoa(len(args))))
	}
	if v := q.Str("status"); v != nil {
		if !shared.In(*v, shared.Enum.PaymentStatuses) {
			q.Fail("status: Invalid option: expected one of " + strings.Join(shared.Enum.PaymentStatuses, "|"))
		}
		add("p.status = $?", *v)
	}
	if v := q.Str("purpose"); v != nil {
		if !shared.In(*v, shared.Enum.PaymentPurposes) {
			q.Fail("purpose: Invalid option: expected one of " + strings.Join(shared.Enum.PaymentPurposes, "|"))
		}
		add("p.purpose = $?", *v)
	}
	if v := q.Str("userId"); v != nil {
		if !IsUUID(*v) {
			q.Fail("userId: Invalid uuid")
		}
		add("p.user_id = $?", *v)
	}
	if v := q.Str("from"); v != nil {
		t, err := time.ParseInLocation("2006-01-02", *v, bakuOffset)
		if err != nil || !shared.ISODateRe.MatchString(*v) {
			q.Fail("from: Expected YYYY-MM-DD")
		}
		add("p.created_at >= $?", t)
	}
	if v := q.Str("to"); v != nil {
		t, err := time.ParseInLocation("2006-01-02", *v, bakuOffset)
		if err != nil || !shared.ISODateRe.MatchString(*v) {
			q.Fail("to: Expected YYYY-MM-DD")
		}
		add("p.created_at < $?", t.Add(24*time.Hour))
	}
	if err := q.Err(); err != nil {
		return nil, err
	}
	where := ""
	if len(conds) > 0 {
		where = " where " + strings.Join(conds, " and ")
	}
	ctx := r.Context()
	n := len(args)
	rows, err := s.pool.Query(ctx, `select `+ColumnsAs+`, u.name from payments p join users u on u.id = p.user_id`+where+
		` order by p.created_at desc limit $`+strconv.Itoa(n+1)+` offset $`+strconv.Itoa(n+2), append(args, pg.Limit, pg.Offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []adminPayment{}
	for rows.Next() {
		var name string
		p, err := Scan(rows, &name)
		if err != nil {
			return nil, err
		}
		items = append(items, adminPayment{Payment: p.DTO(), UserName: name})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var total int
	if err := s.pool.QueryRow(ctx, `select count(*) from payments p`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	return httpx.NewPage(items, total, pg.Page, pg.PageSize), nil
}

func (s *Service) adminGet(ctx context.Context, id string) (any, error) {
	var u adminPaymentUser
	p, err := Scan(s.pool.QueryRow(ctx, `select `+ColumnsAs+`, u.id, u.name, u.phone, u.email from payments p join users u on u.id = p.user_id where p.id = $1`, id),
		&u.ID, &u.Name, &u.Phone, &u.Email)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Payment")
	}
	if err != nil {
		return nil, err
	}
	return adminPaymentDetail{Payment: p.DTO(), User: u, ProviderData: p.ProviderData, Metadata: p.Metadata, FulfilledAt: httpx.ISOPtr(p.FulfilledAt)}, nil
}

type refundBody struct {
	Amount *int    `json:"amount" validate:"omitempty,gt=0"`
	Reason *string `json:"reason" validate:"omitempty,max=300"`
}

func (s *Service) adminRefund(r *http.Request, id string) (any, error) {
	var b refundBody
	if err := httpx.Bind(r, &b); err != nil {
		return nil, err
	}
	user := auth.Current(r)
	in := RefundInput{Reason: "Admin tərəfindən geri qaytarma", ActorID: &user.ID, Reverse: true}
	if b.Amount != nil {
		in.Amount = *b.Amount
	}
	if b.Reason != nil && *b.Reason != "" {
		in.Reason = *b.Reason
	}
	p, err := s.Refund(r.Context(), id, in)
	if err != nil {
		return nil, err
	}
	var amount, reason any
	if b.Amount != nil {
		amount = *b.Amount
	}
	if b.Reason != nil {
		reason = *b.Reason
	}
	s.d.Audit.Log(r.Context(), &user.ID, "payment.refund", "payment", &id, map[string]any{"amount": amount, "reason": reason, "refundedAmount": p.RefundedAmount}, wallet.ClientIP(r))
	return p.DTO(), nil
}

// Revenue implements GET /admin/stats/revenue: daily revenue. One key per PaymentPurpose = paid amount net of refunds.
// `value` = total excluding WALLET_TOPUP (top-ups are prepaid balance; that money is counted when it is spent on a
// purpose). BOOKING is the full guest payment (GMV incl. host share); `bookingCommission` = platform take
// (guest fee + host fee) of those bookings.
func (s *Service) Revenue(ctx context.Context, days int, now time.Time) ([]map[string]any, error) {
	today := now.In(bakuOffset).Format("2006-01-02")
	todayT, _ := time.ParseInLocation("2006-01-02", today, bakuOffset)
	since := todayT.AddDate(0, 0, -(days - 1))
	rows, err := s.pool.Query(ctx, `select to_char((paid_at at time zone 'Asia/Baku')::date, 'YYYY-MM-DD') as day, purpose,
		coalesce(sum(amount - refunded_amount), 0)::int from payments
		where status in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') and paid_at >= $1 group by 1, 2`, since)
	if err != nil {
		return nil, err
	}
	type agg struct {
		day, purpose string
		net          int
	}
	var revenue []agg
	for rows.Next() {
		var a agg
		if err := rows.Scan(&a.day, &a.purpose, &a.net); err != nil {
			rows.Close()
			return nil, err
		}
		revenue = append(revenue, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = s.pool.Query(ctx, `select to_char((p.paid_at at time zone 'Asia/Baku')::date, 'YYYY-MM-DD') as day, coalesce(sum(b.guest_fee + b.host_fee), 0)::int
		from payments p join bookings b on b.id = p.booking_id
		where p.purpose = 'BOOKING' and p.paid_at >= $1 and b.status in ('CONFIRMED', 'COMPLETED') group by 1`, since)
	if err != nil {
		return nil, err
	}
	commission := map[string]int{}
	for rows.Next() {
		var day string
		var v int
		if err := rows.Scan(&day, &v); err != nil {
			rows.Close()
			return nil, err
		}
		commission[day] = v
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	points := make([]map[string]any, 0, days)
	index := map[string]map[string]any{}
	for i := 0; i < days; i++ {
		date := since.AddDate(0, 0, i).Format("2006-01-02")
		pt := map[string]any{"date": date, "value": 0, "bookingCommission": commission[date]}
		for _, p := range shared.Enum.PaymentPurposes {
			pt[p] = 0
		}
		points = append(points, pt)
		index[date] = pt
	}
	for _, a := range revenue {
		pt, ok := index[a.day]
		if !ok {
			continue
		}
		pt[a.purpose] = pt[a.purpose].(int) + a.net
		if a.purpose != "WALLET_TOPUP" {
			pt["value"] = pt["value"].(int) + a.net
		}
	}
	return points, nil
}
