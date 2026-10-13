package app

import (
	"context"
	"crypto/subtle"
	"fmt"
	"html/template"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/mockbank/internal/cards"
	"github.com/alasgarovnamig/evtap/mockbank/internal/i18n"
	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

const maxFormBody = 16 * 1024

// ReturnStatus is the status reported to the merchant's returnUrl (contract: APPROVED | DECLINED | CANCELLED).
func ReturnStatus(o *Order) string {
	switch o.Status {
	case StatusApproved, StatusRefunded, StatusPartiallyRefunded:
		return "APPROVED"
	case StatusDeclined:
		return "DECLINED"
	}
	return "CANCELLED"
}

// BuildReturnURL is returnUrl + ?orderId=…&merchantOrderId=…&status=… ("&" when it already has a query).
func BuildReturnURL(o *Order) string {
	return util.AppendQuery(deref(o.ReturnURL),
		util.KV{Key: "orderId", Value: o.ID},
		util.KV{Key: "merchantOrderId", Value: o.MerchantOrderID},
		util.KV{Key: "status", Value: ReturnStatus(o)})
}

func nonceOK(o *Order, provided string, present bool) bool {
	return present && subtle.ConstantTimeCompare([]byte(o.FormNonce), []byte(provided)) == 1
}

// formValue returns a urlencoded form field (present=false when missing).
func formValue(r *http.Request, key string) (string, bool) {
	v, ok := r.PostForm[key]
	if !ok || len(v) == 0 {
		return "", false
	}
	return strings.Join(v, ","), true
}

func (a *App) checkoutRouter() http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if req.Method == http.MethodPost {
				req.Body = http.MaxBytesReader(w, req.Body, maxFormBody)
				if err := req.ParseForm(); err != nil {
					a.internalError(w, err)
					return
				}
			}
			next.ServeHTTP(w, req)
		})
	})
	r.NotFound(notFoundJSON)
	r.MethodNotAllowed(notFoundJSON)

	r.Get("/{orderId}", a.checkoutHandler(a.cardPage))
	r.Post("/{orderId}/pay", a.checkoutHandler(a.pay))
	r.Post("/{orderId}/cancel", a.checkoutHandler(a.customerCancel))
	r.Get("/{orderId}/3ds", a.checkoutHandler(a.threeDSPage))
	r.Post("/{orderId}/3ds", a.checkoutHandler(a.threeDSSubmit))
	r.Post("/{orderId}/3ds/resend", a.checkoutHandler(a.threeDSResend))
	r.Post("/{orderId}/3ds/cancel", a.checkoutHandler(a.threeDSCancel))
	r.Get("/{orderId}/return", a.checkoutHandler(a.backToMerchant))
	return r
}

// checkoutHandler loads the order (expiring it when overdue) and renders 404 for unknown ids.
func (a *App) checkoutHandler(fn func(w http.ResponseWriter, r *http.Request, o *Order) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			o, err := a.Orders.Get(r.Context(), urlParam(r, "orderId"))
			if err != nil {
				return err
			}
			if o == nil || o.Kind != KindCheckout || o.ReturnURL == nil {
				return a.renderNotFound(w, a.pageContext(r, nil, r.URL.Path))
			}
			if o, err = a.Orders.ExpireIfDue(context.WithoutCancel(r.Context()), o); err != nil {
				return err
			}
			return fn(w, r, o)
		}()
		if err != nil {
			a.internalError(w, err)
		}
	}
}

func (a *App) pageContext(r *http.Request, o *Order, path string) pageCtx {
	override := ""
	if v := r.URL.Query()["lang"]; len(v) == 1 && i18n.IsLanguage(v[0]) {
		override = v[0]
	}
	lang := override
	if lang == "" {
		orderLang := ""
		if o != nil {
			orderLang = o.Language
		}
		lang = i18n.Resolve(orderLang, "az")
	}
	return pageCtx{Lang: lang, LangOverride: override, IsProd: a.Config.IsProd, Path: path, tr: i18n.Translator{Lang: lang}}
}

// goTo answers 303 → the order's checkout page (keeping ?lang=).
func (a *App) goTo(w http.ResponseWriter, r *http.Request, o *Order, suffix string) error {
	ctx := a.pageContext(r, o, "")
	redirect(w, http.StatusSeeOther, ctx.WithLang("/checkout/"+o.ID+suffix))
	return nil
}

func (a *App) merchantName(ctx context.Context, o *Order) (string, error) {
	m, err := a.Merchants.Get(ctx, o.MerchantID)
	if err != nil {
		return "", err
	}
	if m == nil {
		return o.MerchantID, nil
	}
	return m.Name, nil
}

func (a *App) sendPage(w http.ResponseWriter, status int, t *template.Template, data any) error {
	b, err := render(t, data)
	if err != nil {
		return err
	}
	htmlResponse(w, status, b)
	return nil
}

// ---------------------------------------------------------------- 1. card form / final result

func (a *App) cardPage(w http.ResponseWriter, r *http.Request, o *Order) error {
	ctx := a.pageContext(r, o, "/checkout/"+o.ID)
	switch o.Status {
	case StatusProcessing:
		return a.goTo(w, r, o, "/3ds")
	case StatusCreated:
		return a.renderCardForm(w, r.Context(), http.StatusOK, ctx, o, cardFormState{Values: cardFormValues{SaveCard: true}})
	}
	auto := o.Status == StatusApproved || o.Status == StatusDeclined || o.Status == StatusCancelled
	return a.renderResult(w, r.Context(), ctx, o, "/checkout/"+o.ID+"/return", auto)
}

// ---------------------------------------------------------------- 2. card submitted

func (a *App) pay(w http.ResponseWriter, r *http.Request, o *Order) error {
	if o.Status != StatusCreated {
		return a.goTo(w, r, o, "")
	}
	ctx := a.pageContext(r, o, "/checkout/"+o.ID)
	number, _ := formValue(r, "number")
	expiry, _ := formValue(r, "expiry")
	holder, _ := formValue(r, "holder")
	save, _ := formValue(r, "saveCard")
	values := cardFormValues{
		Number:   util.JSSlice(number, 30),
		Expiry:   util.JSSlice(expiry, 10),
		Holder:   util.JSSlice(holder, 80),
		SaveCard: save == "1" || save == "on" || save == "true",
	}
	nonce, hasNonce := formValue(r, "nonce")
	if !nonceOK(o, nonce, hasNonce) {
		return a.renderCardForm(w, r.Context(), http.StatusForbidden, ctx, o, cardFormState{Values: values, Alert: ctx.T("staleForm")})
	}
	cvv, _ := formValue(r, "cvv")
	card, errs := cards.Validate(cards.Input{Number: values.Number, Expiry: values.Expiry, CVV: cvv, Holder: values.Holder}, time.Now())
	if card == nil {
		return a.renderCardForm(w, r.Context(), http.StatusUnprocessableEntity, ctx, o, cardFormState{Values: values, Errors: errs, Alert: ctx.T("formError")})
	}
	updated, err := a.Orders.SubmitCard(context.WithoutCancel(r.Context()), o.ID, card, values.SaveCard)
	if err != nil {
		return err
	}
	if updated == nil {
		if updated, err = a.Orders.Get(r.Context(), o.ID); err != nil {
			return err
		}
	}
	suffix := ""
	if updated.Status == StatusProcessing {
		suffix = "/3ds"
	}
	return a.goTo(w, r, updated, suffix)
}

// Cancel button on the card form → CANCELLED, webhook, back to the merchant.
func (a *App) customerCancel(w http.ResponseWriter, r *http.Request, o *Order) error {
	nonce, has := formValue(r, "nonce")
	if o.Status != StatusCreated || !nonceOK(o, nonce, has) {
		return a.goTo(w, r, o, "")
	}
	cancelled, err := a.Orders.CancelByCustomer(context.WithoutCancel(r.Context()), o.ID)
	if err != nil {
		return err
	}
	if cancelled == nil {
		return a.goTo(w, r, o, "")
	}
	redirect(w, http.StatusFound, BuildReturnURL(cancelled))
	return nil
}

// ---------------------------------------------------------------- 3. 3-D Secure (ACS)

func (a *App) threeDSPage(w http.ResponseWriter, r *http.Request, o *Order) error {
	if o.Status != StatusProcessing {
		return a.goTo(w, r, o, "")
	}
	return a.renderThreeDS(w, r.Context(), http.StatusOK, a.pageContext(r, o, "/checkout/"+o.ID+"/3ds"), o, "", "")
}

func (a *App) threeDSSubmit(w http.ResponseWriter, r *http.Request, o *Order) error {
	if o.Status != StatusProcessing {
		return a.goTo(w, r, o, "")
	}
	ctx := a.pageContext(r, o, "/checkout/"+o.ID+"/3ds")
	nonce, has := formValue(r, "nonce")
	if !nonceOK(o, nonce, has) {
		return a.renderThreeDS(w, r.Context(), http.StatusForbidden, ctx, o, ctx.T("staleForm"), "")
	}
	otp, _ := formValue(r, "otp")
	result, err := a.Orders.SubmitOTP(context.WithoutCancel(r.Context()), o.ID, otp)
	if err != nil {
		return err
	}
	if result != nil && result.Order.Status == StatusProcessing {
		return a.renderThreeDS(w, r.Context(), http.StatusUnprocessableEntity, ctx, result.Order, ctx.T("wrongOtp", "n", result.AttemptsLeft), "")
	}
	if result != nil {
		return a.goTo(w, r, result.Order, "")
	}
	return a.goTo(w, r, o, "")
}

func (a *App) threeDSResend(w http.ResponseWriter, r *http.Request, o *Order) error {
	nonce, has := formValue(r, "nonce")
	if o.Status != StatusProcessing || !nonceOK(o, nonce, has) {
		return a.goTo(w, r, o, "")
	}
	ctx := a.pageContext(r, o, "/checkout/"+o.ID+"/3ds")
	return a.renderThreeDS(w, r.Context(), http.StatusOK, ctx, o, "", ctx.T("resent"))
}

func (a *App) threeDSCancel(w http.ResponseWriter, r *http.Request, o *Order) error {
	nonce, has := formValue(r, "nonce")
	if o.Status == StatusProcessing && nonceOK(o, nonce, has) {
		declined, err := a.Orders.Abort3DS(context.WithoutCancel(r.Context()), o.ID)
		if err != nil {
			return err
		}
		if declined != nil {
			return a.goTo(w, r, declined, "")
		}
	}
	return a.goTo(w, r, o, "")
}

// ---------------------------------------------------------------- 4. back to the merchant

// backToMerchant: 302 → returnUrl?orderId=…&merchantOrderId=…&status=…
func (a *App) backToMerchant(w http.ResponseWriter, r *http.Request, o *Order) error {
	if o.Status == StatusCreated || o.Status == StatusProcessing {
		return a.goTo(w, r, o, "")
	}
	redirect(w, http.StatusFound, BuildReturnURL(o))
	return nil
}

// ---------------------------------------------------------------- page rendering

type cardFormValues struct {
	Number, Expiry, Holder string
	SaveCard               bool
}

type cardFormState struct {
	Values cardFormValues
	Errors map[string]string
	Alert  string
}

type testCardRow struct{ PAN, Grouped, Kind, Code string }

type cardFormPage struct {
	checkoutLayout
	cardFormState
	Initial, MerchantName, Description, Amount, ShortOrderID string
	ExpiresAtMS                                              int64
	PayAction, CancelAction, Nonce                           string
	SaveCardOffered                                          bool
	TestCards                                                []testCardRow
	I18nJSON, Script                                         template.JS
}

// FieldClass is "field" or "field err".
func (p cardFormPage) FieldClass(f string) string {
	if p.Errors[f] != "" {
		return "field err"
	}
	return "field"
}

// FieldErr is the translated error of a field ("" when valid).
func (p cardFormPage) FieldErr(f string) string {
	if k := p.Errors[f]; k != "" {
		return p.T(k)
	}
	return ""
}

func groupPAN(pan string) string {
	var sb strings.Builder
	for i, c := range pan {
		if i > 0 && i%4 == 0 {
			sb.WriteByte(' ')
		}
		sb.WriteRune(c)
	}
	return sb.String()
}

func firstUpper(s string) string {
	for _, r := range s {
		return strings.ToUpper(string(r))
	}
	return ""
}

func shortOrderID(id string) string {
	r := []rune(id)
	if util.JSLen(id) > 18 && len(r) > 14 {
		return string(r[:8]) + "…" + string(r[len(r)-6:])
	}
	return id
}

func (a *App) renderCardForm(w http.ResponseWriter, rctx context.Context, status int, ctx pageCtx, o *Order, state cardFormState) error {
	name, err := a.merchantName(rctx, o)
	if err != nil {
		return err
	}
	amount := util.FormatMoney(o.Amount, o.Currency)
	desc := o.Description
	if desc == "" {
		desc = ctx.T("order")
	}
	var tcs []testCardRow
	for _, c := range cards.TestCards {
		tcs = append(tcs, testCardRow{PAN: c.PAN, Grouped: groupPAN(c.PAN), Kind: c.Outcome.Kind, Code: c.Outcome.Code})
	}
	now := time.Now()
	page := cardFormPage{
		checkoutLayout:  a.views.layout(ctx, ctx.T("htmlTitle"), "", true),
		cardFormState:   state,
		Initial:         firstUpper(name),
		MerchantName:    name,
		Description:     desc,
		Amount:          amount,
		ShortOrderID:    shortOrderID(o.MerchantOrderID),
		ExpiresAtMS:     o.ExpiresAt.UnixMilli(),
		PayAction:       ctx.WithLang("/checkout/" + o.ID + "/pay"),
		CancelAction:    ctx.WithLang("/checkout/" + o.ID + "/cancel"),
		Nonce:           o.FormNonce,
		SaveCardOffered: o.SaveCard,
		TestCards:       tcs,
		I18nJSON: jsonScript(struct {
			NumberInvalid string `json:"numberInvalid"`
			ExpiryInvalid string `json:"expiryInvalid"`
			ExpiryPast    string `json:"expiryPast"`
			CVVInvalid    string `json:"cvvInvalid"`
			HolderInvalid string `json:"holderInvalid"`
			Processing    string `json:"processing"`
			TestExpiry    string `json:"testExpiry"`
		}{ctx.T("numberInvalid"), ctx.T("expiryInvalid"), ctx.T("expiryPast"), ctx.T("cvvInvalid"), ctx.T("holderInvalid"),
			ctx.T("processing"), fmt.Sprintf("12/%02d", (now.Year()+3)%100)}),
		Script: a.views.checkoutJS,
	}
	return a.sendPage(w, status, a.views.cardForm, page)
}

type threeDSPage struct {
	checkoutLayout
	Phone, MerchantName, Amount, Date, Card      string
	Error, Info                                  string
	OTPAction, ResendAction, CancelAction, Nonce string
	Script                                       template.JS
}

var phoneStrip = regexp.MustCompile(`[^\d+]`)

func maskPhone(phone *string) string {
	if phone == nil {
		return ""
	}
	d := phoneStrip.ReplaceAllString(*phone, "")
	if len(d) < 6 {
		return ""
	}
	return fmt.Sprintf(" %s ** *** %s %s", d[:4], d[len(d)-4:len(d)-2], d[len(d)-2:])
}

var acsMaskRe = regexp.MustCompile(`^(\d{4})(\d{2})\*+(\d{4})$`)

const otpScript = `(function(){var o=document.getElementById('otp');o&&o.addEventListener('input',function(){o.value=o.value.replace(/\D+/g,'').slice(0,6)})})();`

func (a *App) renderThreeDS(w http.ResponseWriter, rctx context.Context, status int, ctx pageCtx, o *Order, errText, info string) error {
	name, err := a.merchantName(rctx, o)
	if err != nil {
		return err
	}
	var phone *string
	if c := o.Customer(); c != nil {
		phone = c.Phone
	}
	page := threeDSPage{
		checkoutLayout: a.views.layout(ctx, ctx.T("acsTitle"), a.views.acsCSS, false),
		Phone:          maskPhone(phone),
		MerchantName:   name,
		Amount:         util.FormatMoney(o.Amount, o.Currency),
		Date:           formatDateTime(time.Now()),
		Card:           acsMaskRe.ReplaceAllString(deref(o.CardMask), "$1 $2** **** $3"),
		Error:          errText,
		Info:           info,
		OTPAction:      ctx.WithLang("/checkout/" + o.ID + "/3ds"),
		ResendAction:   ctx.WithLang("/checkout/" + o.ID + "/3ds/resend"),
		CancelAction:   ctx.WithLang("/checkout/" + o.ID + "/3ds/cancel"),
		Nonce:          o.FormNonce,
		Script:         template.JS(otpScript),
	}
	return a.sendPage(w, status, a.views.threeDS, page)
}

type kvRow struct{ K, V string }

type resultPage struct {
	checkoutLayout
	Kind, Amount, Subtitle, MerchantName, ReturnHref string
	Rows                                             []kvRow
	AutoRedirect                                     bool
}

func (a *App) renderResult(w http.ResponseWriter, rctx context.Context, ctx pageCtx, o *Order, returnHref string, auto bool) error {
	name, err := a.merchantName(rctx, o)
	if err != nil {
		return err
	}
	kind := "neutral"
	switch o.Status {
	case StatusApproved:
		kind = "ok"
	case StatusDeclined:
		kind = "no"
	}
	var title, subtitle string
	switch o.Status {
	case StatusApproved:
		title = ctx.T("approvedTitle")
	case StatusDeclined:
		title = ctx.T("declinedTitle")
		subtitle = i18n.Decline(ctx.Lang, deref(o.DeclineCode))
	case StatusCancelled:
		title, subtitle = ctx.T("cancelledTitle"), ctx.T("cancelledText")
	case StatusExpired:
		title, subtitle = ctx.T("expiredTitle"), ctx.T("expiredText")
	default:
		title = ctx.T("refundedTitle")
	}
	rows := []kvRow{{ctx.T("merchant"), name}}
	if o.Description != "" {
		rows = append(rows, kvRow{ctx.T("description"), o.Description})
	}
	if o.CardMask != nil && *o.CardMask != "" {
		m := *o.CardMask
		last4 := m
		if len(m) > 4 {
			last4 = m[len(m)-4:]
		}
		rows = append(rows, kvRow{ctx.T("card"), strings.TrimSpace(deref(o.CardBrand) + " •••• " + last4)})
	}
	if o.ApprovalCode != nil && *o.ApprovalCode != "" {
		rows = append(rows, kvRow{ctx.T("approvalCode"), *o.ApprovalCode})
	}
	if o.RRN != nil && *o.RRN != "" {
		rows = append(rows, kvRow{ctx.T("rrn"), *o.RRN})
	}
	when := o.UpdatedAt
	if o.PaidAt != nil {
		when = *o.PaidAt
	}
	rows = append(rows, kvRow{ctx.T("date"), formatDateTime(when)})

	layout := a.views.layout(ctx, title, a.views.resultCSS, true)
	if auto {
		layout.RefreshURL = returnHref
	}
	page := resultPage{
		checkoutLayout: layout,
		Kind:           kind,
		Amount:         util.FormatMoney(o.Amount, o.Currency),
		Subtitle:       subtitle,
		MerchantName:   name,
		ReturnHref:     returnHref,
		Rows:           rows,
		AutoRedirect:   auto,
	}
	return a.sendPage(w, http.StatusOK, a.views.result, page)
}

type notFoundPage struct{ checkoutLayout }

func (a *App) renderNotFound(w http.ResponseWriter, ctx pageCtx) error {
	return a.sendPage(w, http.StatusNotFound, a.views.notFound, notFoundPage{a.views.layout(ctx, ctx.T("notFoundTitle"), "", true)})
}
