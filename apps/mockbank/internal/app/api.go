package app

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/mockbank/internal/sig"
	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

const maxAPIBody = 256 * 1024

type ctxKey int

const ctxBody ctxKey = 0

// signedRequest is what the signature middleware hands to the handlers.
type signedRequest struct {
	merchant *Merchant
	json     any // parsed body (nil when the body was empty)
}

func signed(r *http.Request) signedRequest {
	return r.Context().Value(ctxBody).(signedRequest)
}

var timestampRe = regexp.MustCompile(`^\d{10,16}$`)

// urlParam returns a decoded route parameter.
func urlParam(r *http.Request, name string) string {
	v := chi.URLParam(r, name)
	if d, err := url.PathUnescape(v); err == nil {
		return d
	}
	return v
}

// merchantAPI — every request must carry X-Merchant-Id / X-Timestamp / X-Signature where
// signature = hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`)), rawBody = "" for GET.
func (a *App) merchantAPI() http.Handler {
	r := chi.NewRouter()
	r.Use(a.verifySignature)
	notFound := func(w http.ResponseWriter, _ *http.Request) {
		a.apiError(w, &APIError{Status: 404, Code: "NOT_FOUND", Message: "Unknown endpoint"})
	}
	r.NotFound(notFound)
	r.MethodNotAllowed(notFound)

	r.Post("/orders", a.apiHandler(func(r *http.Request) (int, any, error) {
		req := signed(r)
		in, err := ParseCreateOrder(req.json)
		if err != nil {
			return 0, nil, err
		}
		o, _, err := a.Orders.Create(r.Context(), req.merchant, in)
		if err != nil {
			return 0, nil, err
		}
		return http.StatusCreated, struct {
			OrderID    string `json:"orderId"`
			Status     string `json:"status"`
			PaymentURL string `json:"paymentUrl"`
			ExpiresAt  string `json:"expiresAt"`
		}{o.ID, o.Status, a.Orders.PaymentURL(o.ID), ISO(o.ExpiresAt)}, nil
	}))

	r.Post("/orders/charge-token", a.apiHandler(func(r *http.Request) (int, any, error) {
		req := signed(r)
		in, err := ParseChargeToken(req.json)
		if err != nil {
			return 0, nil, err
		}
		o, err := a.Orders.ChargeToken(r.Context(), req.merchant, in)
		if err != nil {
			return 0, nil, err
		}
		return a.orderResponse(r.Context(), o)
	}))

	r.Get("/orders/{orderId}", a.apiHandler(func(r *http.Request) (int, any, error) {
		o, err := a.Orders.GetForMerchant(r.Context(), signed(r).merchant.ID, urlParam(r, "orderId"))
		if err != nil {
			return 0, nil, err
		}
		return a.orderResponse(r.Context(), o)
	}))

	r.Post("/orders/{orderId}/refund", a.apiHandler(func(r *http.Request) (int, any, error) {
		req := signed(r)
		in, err := ParseRefund(req.json)
		if err != nil {
			return 0, nil, err
		}
		o, err := a.Orders.Refund(r.Context(), urlParam(r, "orderId"), in, req.merchant.ID, SourceAPI)
		if err != nil {
			return 0, nil, err
		}
		return a.orderResponse(r.Context(), o)
	}))

	r.Post("/orders/{orderId}/cancel", a.apiHandler(func(r *http.Request) (int, any, error) {
		o, err := a.Orders.Cancel(r.Context(), signed(r).merchant.ID, urlParam(r, "orderId"))
		if err != nil {
			return 0, nil, err
		}
		return a.orderResponse(r.Context(), o)
	}))

	r.Delete("/tokens/{cardToken}", a.apiHandler(func(r *http.Request) (int, any, error) {
		if _, err := a.Tokens.Delete(r.Context(), urlParam(r, "cardToken"), signed(r).merchant.ID); err != nil {
			return 0, nil, err
		}
		return http.StatusOK, struct {
			OK bool `json:"ok"`
		}{true}, nil
	}))
	return r
}

func (a *App) orderResponse(ctx context.Context, o *Order) (int, any, error) {
	j, err := a.Orders.ToJSON(ctx, o)
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, j, nil
}

// apiHandler adapts (status, body, error) handlers; errors become { error, message, details? }.
func (a *App) apiHandler(fn func(r *http.Request) (int, any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status, body, err := fn(r)
		if err != nil {
			a.apiError(w, err)
			return
		}
		writeJSON(w, status, body)
	}
}

type apiErrorBody struct {
	Error   string   `json:"error"`
	Message string   `json:"message"`
	Details []string `json:"details,omitempty"`
}

func (a *App) apiError(w http.ResponseWriter, err error) {
	if e, ok := asAPIError(err); ok {
		writeJSON(w, e.Status, apiErrorBody{Error: e.Code, Message: e.Message, Details: e.Details})
		return
	}
	a.Log.Error("merchant api error", "err", err.Error())
	writeJSON(w, http.StatusInternalServerError, apiErrorBody{Error: "INTERNAL_ERROR", Message: "Internal error"})
}

// readRawBody reads the exact request bytes as a UTF-8 string (invalid bytes → U+FFFD, like
// Buffer#toString). tooLarge is set when the body exceeds the limit.
func readRawBody(r *http.Request, limit int64) (string, bool, error) {
	if r.ContentLength > limit {
		return "", true, nil
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return "", false, err
	}
	if int64(len(b)) > limit {
		return "", true, nil
	}
	s := string(b)
	if !utf8.ValidString(s) {
		var sb strings.Builder
		for _, c := range s {
			sb.WriteRune(c)
		}
		s = sb.String()
	}
	return s, false, nil
}

func (a *App) verifySignature(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Keep the exact bytes: the signature covers the raw body, so JSON is parsed only after verification.
		raw, tooLarge, err := readRawBody(r, maxAPIBody)
		if tooLarge {
			writeJSON(w, http.StatusRequestEntityTooLarge, apiErrorBody{Error: "PAYLOAD_TOO_LARGE", Message: "Request body too large"})
			return
		}
		if err != nil {
			a.apiError(w, err)
			return
		}
		merchantID := r.Header.Get(sig.HeaderMerchant)
		timestamp := r.Header.Get(sig.HeaderTimestamp)
		signature := r.Header.Get(sig.HeaderSignature)
		if merchantID == "" || timestamp == "" || signature == "" || !timestampRe.MatchString(timestamp) {
			a.apiError(w, errInvalidSignature())
			return
		}
		ts, _ := strconv.ParseInt(timestamp, 10, 64)
		if d := time.Now().UnixMilli() - ts; d > a.Config.SignatureTolerance.Milliseconds() || -d > a.Config.SignatureTolerance.Milliseconds() {
			a.apiError(w, errInvalidSignature())
			return
		}
		merchant, err := a.Merchants.Get(r.Context(), merchantID)
		if err != nil {
			a.apiError(w, err)
			return
		}
		if merchant == nil || !sig.Matches(sig.Sign(merchant.Secret, timestamp, raw), signature) {
			a.apiError(w, errInvalidSignature())
			return
		}
		var body any
		if util.JSTrim(raw) != "" {
			if body, err = parseJSON(raw); err != nil {
				a.apiError(w, errValidation([]string{"body must be valid JSON"}))
				return
			}
		}
		ctx := context.WithValue(r.Context(), ctxBody, signedRequest{merchant: merchant, json: body})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
