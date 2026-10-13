package wallet

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Effect is a post-commit side effect (notification, event, bank call). Mirrors runEffects() of the former API:
// effects run in order after the transaction committed and one failing effect never stops the others.
type Effect func(ctx context.Context) error

// RunEffects runs effects with a context detached from request cancellation (a client hanging up after the commit
// must not swallow the notification).
func RunEffects(ctx context.Context, effects []Effect) {
	ctx = context.WithoutCancel(ctx)
	for _, e := range effects {
		if e == nil {
			continue
		}
		func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("effect panic", "panic", r)
				}
			}()
			if err := e(ctx); err != nil {
				slog.Error("post-commit effect failed", "err", err)
			}
		}()
	}
}

var currencySymbols = map[string]string{"AZN": "₼", "USD": "$", "EUR": "€", "GEL": "₾"}

// FormatMoney formats a MINOR-unit amount like @evtap/shared formatMoney: 1050 → "10.50 ₼".
func FormatMoney(minor int, currency string) string {
	if currency == "" {
		currency = "AZN"
	}
	sym, ok := currencySymbols[currency]
	if !ok {
		sym = currency
	}
	return fmt.Sprintf("%.2f %s", float64(minor)/100, sym)
}

// ClientIP returns the caller IP for audit logs (chi's RealIP middleware already resolved X-Forwarded-For).
func ClientIP(r *http.Request) *string {
	ip := r.RemoteAddr
	if i := strings.LastIndex(ip, ":"); i > 0 && !strings.Contains(ip[i:], "]") {
		ip = ip[:i]
	}
	if ip == "" {
		return nil
	}
	return &ip
}

// AddDays adds whole days (24 h) like the former addDays helper.
func AddDays(t time.Time, days int) time.Time { return t.Add(time.Duration(days) * 24 * time.Hour) }

// Ptr returns a pointer to v.
func Ptr[T any](v T) *T { return &v }
