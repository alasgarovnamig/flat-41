// Package app is the mock bank: merchant API, hosted checkout (3-D Secure), signed webhooks
// with a DB-backed retry queue, order expiry and the bank admin UI.
package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/config"
	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

// App wires the services together.
type App struct {
	Config    *config.Config
	DB        *pgxpool.Pool
	Log       *slog.Logger
	Merchants *MerchantService
	Tokens    *TokenService
	Webhooks  *WebhookService
	Orders    *OrderService
	Scheduler *Scheduler
	views     *views
}

// NewLogger returns a slog logger for debug | info | warn | error | silent.
func NewLogger(level string) *slog.Logger {
	var l slog.Level
	switch strings.ToLower(level) {
	case "silent":
		return slog.New(slog.NewTextHandler(io.Discard, nil))
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: l})).With("service", "mockbank")
}

// New creates the services (does not touch the database; see Init).
func New(cfg *config.Config, db *pgxpool.Pool, log *slog.Logger) *App {
	if log == nil {
		log = NewLogger(cfg.LogLevel)
	}
	merchants := NewMerchantService(db)
	tokens := &TokenService{db: db}
	webhooks := NewWebhookService(db, merchants, log, cfg.WebhookTimeout, cfg.WebhookRetryScale)
	orders := &OrderService{db: db, cfg: cfg, tokens: tokens, webhooks: webhooks, log: log}
	return &App{
		Config:    cfg,
		DB:        db,
		Log:       log,
		Merchants: merchants,
		Tokens:    tokens,
		Webhooks:  webhooks,
		Orders:    orders,
		Scheduler: &Scheduler{orders: orders, webhooks: webhooks, interval: cfg.SchedulerInterval, log: log},
		views:     mustLoadViews(),
	}
}

// Init migrates the schema and seeds the merchants.
func (a *App) Init(ctx context.Context) error {
	if err := Migrate(ctx, a.DB); err != nil {
		return err
	}
	return a.Merchants.Seed(ctx, a.Config.Merchants)
}

// Handler builds the HTTP router.
func (a *App) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(stripTrailingSlash)
	r.Use(middleware.GetHead) // HEAD on GET routes, like Express
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "same-origin")
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					a.Log.Error("unhandled error", "err", rec)
					textResponse(w, http.StatusInternalServerError, "Internal error")
				}
			}()
			next.ServeHTTP(w, req)
		})
	})
	r.NotFound(notFoundJSON)
	r.MethodNotAllowed(notFoundJSON)

	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, struct {
			Service  string `json:"service"`
			Checkout string `json:"checkout"`
			Admin    string `json:"admin"`
			Health   string `json:"health"`
			API      string `json:"api"`
		}{"mockbank", "/checkout/:orderId", "/admin", "/health", "/api/v1"})
	})
	r.Get("/health", a.health)
	r.Mount("/api/v1", a.merchantAPI())
	r.Mount("/checkout", a.checkoutRouter())
	r.Mount("/admin", a.adminRouter())
	return r
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var one int
	if err := a.DB.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, struct {
			Status  string `json:"status"`
			Service string `json:"service"`
			DB      string `json:"db"`
			Message string `json:"message"`
		}{"error", "mockbank", "down", err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Status  string `json:"status"`
		Service string `json:"service"`
		DB      string `json:"db"`
		Time    string `json:"time"`
	}{"ok", "mockbank", "ok", ISO(time.Now())})
}

// stripTrailingSlash makes "/x/" route like "/x" (Express' non-strict routing).
func stripTrailingSlash(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := r.URL.Path; len(p) > 1 && strings.HasSuffix(p, "/") {
			r2 := r.Clone(r.Context())
			r2.URL.Path = strings.TrimRight(p, "/")
			if r2.URL.Path == "" {
				r2.URL.Path = "/"
			}
			r2.URL.RawPath = ""
			r = r2
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------- response helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, err := MarshalJSON(v)
	if err != nil {
		textResponse(w, http.StatusInternalServerError, "Internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func textResponse(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

func htmlResponse(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func notFoundJSON(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
}

// redirect sends a redirect with the Location encoded like Express (encodeurl).
func redirect(w http.ResponseWriter, status int, location string) {
	w.Header().Set("Location", util.EncodeURL(location))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, http.StatusText(status)+". Redirecting to "+util.EncodeURL(location))
}

// internalError logs and answers 500 (text/plain), like the Express app-level error handler.
func (a *App) internalError(w http.ResponseWriter, err error) {
	a.Log.Error("unhandled error", "err", err.Error())
	textResponse(w, http.StatusInternalServerError, "Internal error")
}
