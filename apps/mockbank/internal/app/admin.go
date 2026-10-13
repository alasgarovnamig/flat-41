package app

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

func safeEqual(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// adminCSRF is the per-credentials CSRF token (same derivation as the Node version).
func adminCSRF(user, password string) string {
	m := hmac.New(sha256.New, []byte(password))
	m.Write([]byte("mockbank-admin-csrf:" + user))
	return hex.EncodeToString(m.Sum(nil))[:32]
}

func decodeBase64Lenient(s string) []byte {
	s = strings.TrimRight(strings.TrimSpace(s), "=")
	s = strings.NewReplacer("-", "+", "_", "/").Replace(s)
	b, err := base64.RawStdEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}

func (a *App) basicAuthOK(r *http.Request) bool {
	header := r.Header.Get("Authorization")
	parts := strings.Split(header, " ")
	if len(parts) < 2 || strings.ToLower(parts[0]) != "basic" || parts[1] == "" {
		return false
	}
	decoded := string(decodeBase64Lenient(parts[1]))
	idx := strings.IndexByte(decoded, ':')
	return idx >= 0 && safeEqual(decoded[:idx], a.Config.AdminUser) && safeEqual(decoded[idx+1:], a.Config.AdminPass)
}

type flash struct{ Kind, Text string }

type adminLayout struct {
	Title  string
	Active string
	CSS    template.CSS
	Flash  *flash
	CSRF   string
}

type merchantOptions struct {
	Merchants []MerchantStats
	Selected  string
}

// adminRouter is the bank back office — HTTP basic auth + a per-credentials CSRF token on every POST.
func (a *App) adminRouter() http.Handler {
	csrf := adminCSRF(a.Config.AdminUser, a.Config.AdminPass)
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if !a.basicAuthOK(req) {
				w.Header().Set("WWW-Authenticate", `Basic realm="Mock Bank admin", charset="UTF-8"`)
				textResponse(w, http.StatusUnauthorized, "Authentication required")
				return
			}
			if req.Method == http.MethodPost {
				req.Body = http.MaxBytesReader(w, req.Body, maxFormBody)
				if err := req.ParseForm(); err != nil {
					a.internalError(w, err)
					return
				}
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Frame-Options", "DENY")
			if req.Method == http.MethodPost && !safeEqual(req.PostForm.Get("csrf"), csrf) {
				textResponse(w, http.StatusForbidden, "Invalid CSRF token")
				return
			}
			next.ServeHTTP(w, req)
		})
	})
	r.NotFound(notFoundJSON)
	r.MethodNotAllowed(notFoundJSON)

	layout := func(req *http.Request, active, title string) adminLayout {
		l := adminLayout{Title: title, Active: active, CSS: a.views.adminCSS, CSRF: csrf}
		q := req.URL.Query()
		if msgs := q["msg"]; len(msgs) == 1 && msgs[0] != "" {
			kind := "ok"
			if k := q["kind"]; len(k) == 1 && k[0] == "err" {
				kind = "err"
			}
			l.Flash = &flash{Kind: kind, Text: util.JSSlice(msgs[0], 300)}
		}
		return l
	}
	str := func(v string) string { return util.JSTrim(v) }
	query := func(req *http.Request, key string) string {
		if v := req.URL.Query()[key]; len(v) == 1 {
			return str(v[0])
		}
		return ""
	}
	back := func(w http.ResponseWriter, path, kind, msg string) {
		redirect(w, http.StatusSeeOther, path+"?"+util.QueryString(util.KV{Key: "kind", Value: kind}, util.KV{Key: "msg", Value: msg}))
	}
	handle := func(fn func(w http.ResponseWriter, req *http.Request) error) http.HandlerFunc {
		return func(w http.ResponseWriter, req *http.Request) {
			if err := fn(w, req); err != nil {
				a.internalError(w, err)
			}
		}
	}
	errMessage := func(err error) string {
		if e, ok := asAPIError(err); ok {
			return e.Message
		}
		return "Error: " + err.Error()
	}

	r.Get("/", func(w http.ResponseWriter, _ *http.Request) { redirect(w, http.StatusFound, "/admin/orders") })

	r.Get("/orders", handle(func(w http.ResponseWriter, req *http.Request) error {
		status := query(req, "status")
		valid := false
		for _, s := range OrderStatuses {
			valid = valid || s == status
		}
		if !valid {
			status = ""
		}
		page, _ := strconv.Atoi(query(req, "page"))
		filter := OrderListFilter{Status: status, MerchantID: query(req, "merchant"), Q: query(req, "q"), Page: max(page, 1), PageSize: 50}
		data, err := a.Orders.List(req.Context(), filter)
		if err != nil {
			return err
		}
		merchants, err := a.Merchants.List(req.Context())
		if err != nil {
			return err
		}
		return a.sendPage(w, http.StatusOK, a.views.adminOrders, a.ordersPage(layout(req, "orders", "Orders"), data, filter, merchants))
	}))

	r.Get("/orders/{orderId}", handle(func(w http.ResponseWriter, req *http.Request) error {
		ctx := req.Context()
		o, err := a.Orders.Get(ctx, urlParam(req, "orderId"))
		if err != nil {
			return err
		}
		if o == nil {
			merchants, err := a.Merchants.List(ctx)
			if err != nil {
				return err
			}
			l := adminLayout{Title: "Orders", Active: "orders", CSS: a.views.adminCSS, CSRF: csrf, Flash: &flash{"err", "Order not found"}}
			return a.sendPage(w, http.StatusNotFound, a.views.adminOrders,
				a.ordersPage(l, &OrderPage{Page: 1, PageSize: 50}, OrderListFilter{}, merchants))
		}
		page, err := a.orderDetailPage(req, layout(req, "orders", o.ID), o)
		if err != nil {
			return err
		}
		return a.sendPage(w, http.StatusOK, a.views.adminOrder, page)
	}))

	r.Post("/orders/{orderId}/resend", handle(func(w http.ResponseWriter, req *http.Request) error {
		id := urlParam(req, "orderId")
		if err := a.Orders.ResendWebhook(req.Context(), id); err != nil {
			back(w, "/admin/orders/"+id, "err", errMessage(err))
			return nil
		}
		back(w, "/admin/orders/"+id, "ok", "Webhook re-sent — see the delivery log below.")
		return nil
	}))

	r.Post("/orders/{orderId}/refund", handle(func(w http.ResponseWriter, req *http.Request) error {
		id := urlParam(req, "orderId")
		rawAmount := str(req.PostForm.Get("amount"))
		var amount *int64
		if rawAmount != "" {
			v, ok := util.ParseMajorAmount(rawAmount)
			if !ok || v <= 0 {
				back(w, "/admin/orders/"+id, "err", fmt.Sprintf("Invalid amount %q", rawAmount))
				return nil
			}
			amount = &v
		}
		var reason *string
		if s := str(req.PostForm.Get("reason")); s != "" {
			reason = &s
		}
		o, err := a.Orders.Refund(req.Context(), id, &RefundInput{Amount: amount, Reason: reason}, "", SourceAdmin)
		if err != nil {
			back(w, "/admin/orders/"+id, "err", errMessage(err))
			return nil
		}
		back(w, "/admin/orders/"+id, "ok", fmt.Sprintf("Refund done — order is now %s (refunded %s).", o.Status, util.FormatMoney(o.RefundedAmount, o.Currency)))
		return nil
	}))

	r.Get("/tokens", handle(func(w http.ResponseWriter, req *http.Request) error {
		filter := TokenFilter{MerchantID: query(req, "merchant"), Q: query(req, "q")}
		tokens, err := a.Tokens.List(req.Context(), filter)
		if err != nil {
			return err
		}
		merchants, err := a.Merchants.List(req.Context())
		if err != nil {
			return err
		}
		type tokenRow struct {
			Token, MerchantID, Mask, Brand, CustomerID, Created, LastUsed string
			Insufficient                                                  bool
		}
		rows := make([]tokenRow, 0, len(tokens))
		for _, t := range tokens {
			rows = append(rows, tokenRow{t.Token, t.MerchantID, t.Mask, t.Brand, deref(t.CustomerID), formatDateTime(t.CreatedAt),
				formatDateTimePtr(t.LastUsedAt), t.ForceInsufficientFunds})
		}
		return a.sendPage(w, http.StatusOK, a.views.adminTokens, struct {
			adminLayout
			Tokens          []tokenRow
			Filter          TokenFilter
			MerchantOptions merchantOptions
		}{layout(req, "tokens", "Saved cards"), rows, filter, merchantOptions{merchants, filter.MerchantID}})
	}))

	r.Post("/tokens/{token}/insufficient", handle(func(w http.ResponseWriter, req *http.Request) error {
		token := urlParam(req, "token")
		on := req.PostForm.Get("value") == "1"
		ok, err := a.Tokens.SetInsufficientFunds(req.Context(), token, on)
		if err != nil {
			return err
		}
		if !ok {
			back(w, "/admin/tokens", "err", "Token not found")
			return nil
		}
		state := "disabled"
		if on {
			state = "enabled"
		}
		back(w, "/admin/tokens", "ok", fmt.Sprintf("Insufficient funds %s for %s", state, token))
		return nil
	}))

	r.Post("/tokens/{token}/delete", handle(func(w http.ResponseWriter, req *http.Request) error {
		token := urlParam(req, "token")
		ok, err := a.Tokens.Delete(req.Context(), token, "")
		if err != nil {
			return err
		}
		if !ok {
			back(w, "/admin/tokens", "err", "Token not found")
			return nil
		}
		back(w, "/admin/tokens", "ok", "Deleted "+token)
		return nil
	}))

	r.Get("/merchants", handle(func(w http.ResponseWriter, req *http.Request) error {
		merchants, err := a.Merchants.List(req.Context())
		if err != nil {
			return err
		}
		type merchantRow struct {
			ID, Name, Secret, Since               string
			OrderCount, ApprovedCount, TokenCount int
		}
		rows := make([]merchantRow, 0, len(merchants))
		for _, m := range merchants {
			rows = append(rows, merchantRow{m.ID, m.Name, maskSecret(m.Secret), formatDateTime(m.CreatedAt), m.OrderCount, m.ApprovedCount, m.TokenCount})
		}
		return a.sendPage(w, http.StatusOK, a.views.adminMs, struct {
			adminLayout
			Merchants []merchantRow
		}{layout(req, "merchants", "Merchants"), rows})
	}))
	return r
}

func maskSecret(s string) string {
	r := []rune(s)
	head := r[:min(4, len(r))]
	tail := r[max(0, len(r)-2):]
	return string(head) + "••••••" + string(tail)
}

// ---------------------------------------------------------------- orders list

type orderRow struct {
	ID, MerchantID, MerchantOrderID, Description, Amount, Refunded, Status, DeclineCode, CardMask, Created string
	IsToken                                                                                                bool
}

func (a *App) ordersPage(l adminLayout, data *OrderPage, f OrderListFilter, merchants []MerchantStats) any {
	pages := int(math.Max(1, math.Ceil(float64(data.Total)/float64(data.PageSize))))
	link := func(page int) string {
		var kv []util.KV
		for _, p := range []util.KV{{Key: "status", Value: f.Status}, {Key: "merchant", Value: f.MerchantID}, {Key: "q", Value: f.Q}, {Key: "page", Value: strconv.Itoa(page)}} {
			if p.Value != "" {
				kv = append(kv, p)
			}
		}
		return "/admin/orders?" + util.QueryString(kv...)
	}
	rows := make([]orderRow, 0, len(data.Items))
	for _, o := range data.Items {
		refunded := ""
		if o.RefundedAmount != 0 {
			refunded = util.FormatMoney(o.RefundedAmount, o.Currency)
		}
		rows = append(rows, orderRow{
			ID: o.ID, MerchantID: o.MerchantID, MerchantOrderID: o.MerchantOrderID, Description: o.Description,
			Amount: util.FormatMoney(o.Amount, o.Currency), Refunded: refunded, Status: o.Status, DeclineCode: deref(o.DeclineCode),
			CardMask: deref(o.CardMask), Created: formatDateTime(o.CreatedAt), IsToken: o.Kind == KindToken,
		})
	}
	prev, next := "", ""
	if data.Page > 1 {
		prev = link(data.Page - 1)
	}
	if data.Page < pages {
		next = link(data.Page + 1)
	}
	return struct {
		adminLayout
		Data            *OrderPage
		Filter          OrderListFilter
		Statuses        []string
		MerchantOptions merchantOptions
		Rows            []orderRow
		Pages           int
		PrevLink        string
		NextLink        string
	}{l, data, f, OrderStatuses, merchantOptions{merchants, f.MerchantID}, rows, pages, prev, next}
}

// ---------------------------------------------------------------- order detail

type detailField struct {
	Label, Value string
	Mono         bool
}

// prettyJSON is JSON.stringify(JSON.parse(s), null, 2) for our own (already normalised) JSON.
func prettyJSON(s string) string {
	var buf bytes.Buffer
	if err := json.Indent(&buf, []byte(s), "", "  "); err != nil {
		return s
	}
	return buf.String()
}

func (a *App) orderDetailPage(req *http.Request, l adminLayout, o *Order) (any, error) {
	ctx := req.Context()
	j, err := a.Orders.ToJSON(ctx, o)
	if err != nil {
		return nil, err
	}
	merchant, err := a.Merchants.Get(ctx, o.MerchantID)
	if err != nil {
		return nil, err
	}
	refunds, err := a.Orders.Refunds(ctx, o.ID)
	if err != nil {
		return nil, err
	}
	timeline, err := a.Orders.Timeline(ctx, o.ID)
	if err != nil {
		return nil, err
	}
	hooks, deliveries, err := a.Webhooks.ListForOrder(ctx, o.ID)
	if err != nil {
		return nil, err
	}

	money := func(v int64) string { return util.FormatMoney(v, o.Currency) }
	merchantLabel := o.MerchantID
	if merchant != nil {
		merchantLabel = fmt.Sprintf("%s (%s)", merchant.Name, merchant.ID)
	}
	opt := func(cond bool, v string) string {
		if cond {
			return v
		}
		return ""
	}
	saveCard := "no"
	if o.SaveCard {
		saveCard = "offered"
		if o.SaveCardRequested || o.CardToken != nil {
			saveCard = "yes (customer opted in)"
		}
	}
	decline := ""
	if o.DeclineCode != nil {
		decline = fmt.Sprintf("%s — %s", *o.DeclineCode, deref(o.DeclineReason))
	}
	card := ""
	if o.CardMask != nil && *o.CardMask != "" {
		card = fmt.Sprintf("%s · %s", *o.CardMask, deref(o.CardBrand))
	}
	paid := ""
	if o.PaidAt != nil {
		paid = formatDateTime(*o.PaidAt)
	}
	fields := []detailField{
		{Label: "Merchant", Value: merchantLabel},
		{Label: "Merchant order id", Value: o.MerchantOrderID, Mono: true},
		{Label: "Kind", Value: o.Kind},
		{Label: "Description", Value: o.Description},
		{Label: "Amount", Value: money(o.Amount)},
		{Label: "Refunded", Value: opt(o.RefundedAmount != 0, money(o.RefundedAmount))},
		{Label: "Card", Value: card, Mono: true},
		{Label: "Cardholder", Value: deref(o.CardHolder)},
		{Label: "Card token", Value: deref(o.CardToken), Mono: true},
		{Label: "Decline", Value: decline},
		{Label: "RRN", Value: deref(o.RRN), Mono: true},
		{Label: "Approval code", Value: deref(o.ApprovalCode), Mono: true},
		{Label: "Language", Value: o.Language},
		{Label: "Save card requested", Value: saveCard},
		{Label: "OTP attempts", Value: opt(o.OTPAttempts != 0, strconv.Itoa(o.OTPAttempts))},
		{Label: "Customer", Value: o.CustomerCompact(), Mono: true},
		{Label: "Created", Value: formatDateTime(o.CreatedAt)},
		{Label: "Updated", Value: formatDateTime(o.UpdatedAt)},
		{Label: "Paid", Value: paid},
		{Label: "Expires", Value: formatDateTime(o.ExpiresAt)},
		{Label: "Return URL", Value: deref(o.ReturnURL), Mono: true},
		{Label: "Callback URL", Value: deref(o.CallbackURL), Mono: true},
	}
	checkoutURL := ""
	if o.Kind == KindCheckout {
		checkoutURL = a.Orders.PaymentURL(o.ID)
	}

	type webhookRow struct {
		Created, Event, Status, LastHTTP, Next string
		Attempts                               int
	}
	whRows := make([]webhookRow, 0, len(hooks))
	for _, w := range hooks {
		last := "—"
		if w.LastStatusCode != nil {
			last = strconv.Itoa(*w.LastStatusCode)
		}
		next := "—"
		if w.Status == WebhookPending && w.NextAttemptAt != nil {
			next = formatDateTime(*w.NextAttemptAt)
		}
		whRows = append(whRows, webhookRow{formatDateTime(w.CreatedAt), w.Event, w.Status, last, next, w.Attempts})
	}
	type deliveryRow struct {
		Created, Event, Error, URL, ResponseBody, RequestBody string
		Attempt, Status, DurationMS                           int
		HasStatus, OK                                         bool
	}
	dRows := make([]deliveryRow, 0, len(deliveries))
	for _, d := range deliveries {
		row := deliveryRow{Created: formatDateTime(d.CreatedAt), Event: d.Event, Error: deref(d.Error), URL: d.URL,
			ResponseBody: deref(d.ResponseBody), RequestBody: prettyJSON(d.RequestBody), Attempt: d.Attempt, DurationMS: d.DurationMS}
		if row.ResponseBody == "" {
			row.ResponseBody = "(empty)"
		}
		if d.ResponseStatus != nil {
			row.HasStatus, row.Status = true, *d.ResponseStatus
			row.OK = row.Status >= 200 && row.Status < 300
		}
		dRows = append(dRows, row)
	}
	type refundRow struct{ ID, Created, Source, Reason, Amount string }
	rRows := make([]refundRow, 0, len(refunds))
	for _, r := range refunds {
		rRows = append(rRows, refundRow{r.ID, formatDateTime(r.CreatedAt), r.Source, deref(r.Reason), money(r.Amount)})
	}
	type timelineRow struct{ Created, Type, Message string }
	tRows := make([]timelineRow, 0, len(timeline))
	for _, e := range timeline {
		tRows = append(tRows, timelineRow{formatDateTime(e.CreatedAt), e.Type, e.Message})
	}
	resendEvent := ""
	if ev := EventForStatus(o.Status); ev != "" && o.CallbackURL != nil && *o.CallbackURL != "" {
		resendEvent = ev
	}
	remaining := o.Amount - o.RefundedAmount
	return struct {
		adminLayout
		Order          *Order
		Amount         string
		Fields         []detailField
		CheckoutURL    string
		Webhooks       []webhookRow
		Deliveries     []deliveryRow
		HasCallback    bool
		JSON           string
		ResendEvent    string
		Refundable     bool
		RemainingMajor string
		Remaining      string
		Refunds        []refundRow
		Timeline       []timelineRow
	}{
		adminLayout:    l,
		Order:          o,
		Amount:         money(o.Amount),
		Fields:         fields,
		CheckoutURL:    checkoutURL,
		Webhooks:       whRows,
		Deliveries:     dRows,
		HasCallback:    o.CallbackURL != nil && *o.CallbackURL != "",
		JSON:           MarshalIndentJSON(j),
		ResendEvent:    resendEvent,
		Refundable:     o.Status == StatusApproved || o.Status == StatusPartiallyRefunded,
		RemainingMajor: fmt.Sprintf("%d.%02d", remaining/100, remaining%100),
		Remaining:      money(remaining),
		Refunds:        rRows,
		Timeline:       tRows,
	}, nil
}
