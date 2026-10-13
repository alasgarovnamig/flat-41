package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/alasgarovnamig/evtap/mockbank/internal/i18n"
	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

// APIError is rendered by the merchant API as { error: code, message, details? }.
type APIError struct {
	Status  int
	Code    string
	Message string
	Details []string
}

func (e *APIError) Error() string { return e.Message }

func errInvalidSignature() *APIError {
	return &APIError{Status: 401, Code: "INVALID_SIGNATURE", Message: "Invalid merchant signature"}
}
func errOrderNotFound() *APIError {
	return &APIError{Status: 404, Code: "ORDER_NOT_FOUND", Message: "Order not found"}
}
func errValidation(details []string) *APIError {
	return &APIError{Status: 400, Code: "VALIDATION_ERROR", Message: strings.Join(details, "; "), Details: details}
}

// asAPIError unwraps an *APIError.
func asAPIError(err error) (*APIError, bool) {
	var e *APIError
	ok := errors.As(err, &e)
	return e, ok
}

// parseJSON parses a request body like JSON.parse (numbers kept exact as json.Number).
func parseJSON(raw string) (any, error) {
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("trailing data")
	}
	return v, nil
}

// CreateOrderInput is the validated body of POST /orders.
type CreateOrderInput struct {
	Amount          int64
	Currency        string
	MerchantOrderID string
	Description     string
	Language        string
	ReturnURL       string
	CallbackURL     string
	SaveCard        bool
	Customer        *Customer
}

// ChargeTokenInput is the validated body of POST /orders/charge-token.
type ChargeTokenInput struct {
	Amount          int64
	Currency        string
	MerchantOrderID string
	Description     string
	CardToken       string
	CallbackURL     *string
}

// RefundInput is the validated body of POST /orders/:id/refund.
type RefundInput struct {
	Amount *int64
	Reason *string
}

const maxAmount = 100_000_000_00 // 100M major units
const maxSafeInteger = 1<<53 - 1

type validator struct{ errors []string }

func (v *validator) add(format string, args ...any) {
	v.errors = append(v.errors, fmt.Sprintf(format, args...))
}

func asObject(body any) (map[string]any, error) {
	m, ok := body.(map[string]any)
	if !ok {
		return nil, errValidation([]string{"body must be a JSON object"})
	}
	return m, nil
}

// isSet mirrors `v !== undefined && v !== null`.
func isSet(m map[string]any, key string) bool {
	v, ok := m[key]
	return ok && v != nil
}

func (v *validator) amount(raw any, field string) int64 {
	n, ok := raw.(json.Number)
	if !ok {
		v.add("%s must be a positive integer (minor units)", field)
		return 0
	}
	f, err := n.Float64()
	if err != nil || math.IsInf(f, 0) || f != math.Trunc(f) || math.Abs(f) > maxSafeInteger || f <= 0 {
		v.add("%s must be a positive integer (minor units)", field)
		return 0
	}
	if f > maxAmount {
		v.add("%s is too large", field)
		return 0
	}
	return int64(f)
}

func (v *validator) currency(raw any) string {
	s, ok := raw.(string)
	if ok {
		for _, c := range Currencies {
			if c == s {
				return s
			}
		}
	}
	v.add("currency must be one of %s", strings.Join(Currencies, ", "))
	return s
}

func (v *validator) requiredString(raw any, field string, max int) string {
	s, ok := raw.(string)
	if !ok || util.JSTrim(s) == "" {
		v.add("%s is required", field)
	} else if util.JSLen(s) > max {
		v.add("%s must be at most %d characters", field, max)
	}
	return util.JSTrim(s)
}

func (v *validator) optionalString(raw any, field string, max int) *string {
	if raw == nil {
		return nil
	}
	s, ok := raw.(string)
	if !ok {
		v.add("%s must be a string", field)
		return nil
	}
	if util.JSLen(s) > max {
		v.add("%s must be at most %d characters", field, max)
	}
	return &s
}

func (v *validator) err() error {
	if len(v.errors) > 0 {
		return errValidation(v.errors)
	}
	return nil
}

// ParseCreateOrder validates POST /orders.
func ParseCreateOrder(body any) (*CreateOrderInput, error) {
	b, err := asObject(body)
	if err != nil {
		return nil, err
	}
	v := &validator{}
	out := &CreateOrderInput{
		Amount:          v.amount(b["amount"], "amount"),
		Currency:        v.currency(b["currency"]),
		MerchantOrderID: v.requiredString(b["merchantOrderId"], "merchantOrderId", 128),
		Language:        "az",
	}
	if d := v.optionalString(b["description"], "description", 500); d != nil {
		out.Description = *d
	}
	if isSet(b, "language") {
		s, ok := b["language"].(string)
		if !ok || !i18n.IsLanguage(s) {
			v.add("language must be one of %s", strings.Join(i18n.Languages, ", "))
		} else {
			out.Language = s
		}
	}
	ret, _ := b["returnUrl"].(string)
	if _, isStr := b["returnUrl"].(string); !isStr || !util.IsValidURL(ret, true) {
		v.add("returnUrl must be a valid absolute URL")
	}
	cb, _ := b["callbackUrl"].(string)
	if _, isStr := b["callbackUrl"].(string); !isStr || !util.IsValidURL(cb, false) {
		v.add("callbackUrl must be a valid http(s) URL")
	}
	out.ReturnURL, out.CallbackURL = ret, cb
	if isSet(b, "saveCard") {
		if sc, ok := b["saveCard"].(bool); !ok {
			v.add("saveCard must be a boolean")
		} else {
			out.SaveCard = sc
		}
	}
	if isSet(b, "customer") {
		c, ok := b["customer"].(map[string]any)
		if !ok {
			v.add("customer must be an object")
		} else {
			out.Customer = &Customer{
				ID:    v.optionalString(c["id"], "customer.id", 255),
				Phone: v.optionalString(c["phone"], "customer.phone", 255),
				Email: v.optionalString(c["email"], "customer.email", 255),
			}
		}
	}
	if err := v.err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ParseChargeToken validates POST /orders/charge-token.
func ParseChargeToken(body any) (*ChargeTokenInput, error) {
	b, err := asObject(body)
	if err != nil {
		return nil, err
	}
	v := &validator{}
	out := &ChargeTokenInput{
		Amount:          v.amount(b["amount"], "amount"),
		Currency:        v.currency(b["currency"]),
		MerchantOrderID: v.requiredString(b["merchantOrderId"], "merchantOrderId", 128),
	}
	if d := v.optionalString(b["description"], "description", 500); d != nil {
		out.Description = *d
	}
	out.CardToken = v.requiredString(b["cardToken"], "cardToken", 128)
	if isSet(b, "callbackUrl") {
		cb, ok := b["callbackUrl"].(string)
		if !ok || !util.IsValidURL(cb, false) {
			v.add("callbackUrl must be a valid http(s) URL")
		} else {
			out.CallbackURL = &cb
		}
	}
	if err := v.err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ParseRefund validates POST /orders/:id/refund (empty body = full refund).
func ParseRefund(body any) (*RefundInput, error) {
	b := map[string]any{}
	if body != nil {
		var err error
		if b, err = asObject(body); err != nil {
			return nil, err
		}
	}
	v := &validator{}
	out := &RefundInput{Reason: v.optionalString(b["reason"], "reason", 500)}
	if isSet(b, "amount") {
		a := v.amount(b["amount"], "amount")
		out.Amount = &a
	}
	if err := v.err(); err != nil {
		return nil, err
	}
	return out, nil
}

// compactJSON re-encodes a value without HTML escaping (used for customer JSONB).
func compactJSON(v any) string {
	b, err := MarshalJSON(v)
	if err != nil {
		return "null"
	}
	return string(bytes.TrimSpace(b))
}
