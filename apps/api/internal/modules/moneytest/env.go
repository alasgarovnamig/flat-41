// Package moneytest is the integration-test harness of the money modules (wallet, payments, promotions,
// subscriptions, bookings): a real Postgres (MONEY_TEST_DATABASE_URL, else TEST_DATABASE_URL, default
// postgres://evtap:evtap@localhost:5432/evtap_go_money_test), the real router via httptest and a fake bank
// implementing docs/MOCKBANK.md. Imported by tests only. Tests skip when the database is unreachable.
package moneytest

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/modules/bookings"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments"
	"github.com/alasgarovnamig/evtap/api/internal/modules/promotions"
	"github.com/alasgarovnamig/evtap/api/internal/modules/subscriptions"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/server"
)

const defaultDB = "postgres://evtap:evtap@localhost:5432/evtap_go_money_test"

var (
	poolOnce sync.Once
	pool     *pgxpool.Pool
	poolErr  error
)

func dbURL() string {
	for _, k := range []string{"MONEY_TEST_DATABASE_URL", "TEST_DATABASE_URL"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return defaultDB
}

func sharedPool() (*pgxpool.Pool, error) {
	poolOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		pool, poolErr = db.Connect(ctx, dbURL())
		if poolErr != nil {
			return
		}
		if poolErr = db.Migrate(pool); poolErr != nil {
			return
		}
		poolErr = settings.EnsureDefaults(ctx, pool)
	})
	return pool, poolErr
}

// Env is one isolated API instance (own Deps, payment engine and rate limiters) on the shared test database.
type Env struct {
	T     *testing.T
	D     *app.Deps
	Srv   *httptest.Server
	Bank  *FakeBank
	Pay   *payments.Service
	Book  *bookings.Service
	Subs  *subscriptions.Service
	Promo *promotions.Service
	Wal   *wallet.Service
	// HTTP client that never follows redirects (evtap:// targets).
	Client *http.Client
}

// New builds the environment. Skips the test when the database is unreachable.
func New(t *testing.T) *Env {
	t.Helper()
	p, err := sharedPool()
	if err != nil {
		t.Skipf("test database unavailable: %v", err)
	}
	bank := NewFakeBank()
	t.Cleanup(bank.Close)

	cfg := &config.Config{Env: "test", WebURL: "http://localhost:3000", AdminURL: "http://localhost:3001", CORSOrigins: []string{"*"}}
	cfg.JWT.AccessSecret, cfg.JWT.AccessTTL = "test-secret", 900
	cfg.Storage.Driver, cfg.Storage.UploadDir = "local", os.TempDir()
	cfg.SMS.Provider, cfg.Push.Provider, cfg.Mail.Provider = "console", "console", "console"
	cfg.Payments.Provider = "mockbank"
	cfg.Payments.MockBank.URL, cfg.Payments.MockBank.MerchantID, cfg.Payments.MockBank.Secret = bank.URL(), "evtap", "evtap-mockbank-secret"

	srv := httptest.NewUnstartedServer(nil)
	cfg.APIPublicURL = "http://" + srv.Listener.Addr().String()
	cfg.APIInternalURL = cfg.APIPublicURL

	d := app.Build(cfg, p)
	mods := server.Modules(d)
	srv.Config.Handler = server.New(d, mods)
	srv.Start()
	t.Cleanup(func() { srv.Close(); d.Bus.Wait() })

	e := &Env{T: t, D: d, Srv: srv, Bank: bank, Pay: payments.Engine(d), Wal: wallet.NewService(p),
		Client: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	for _, m := range mods {
		switch m := m.(type) {
		case *bookings.Module:
			e.Book = m.Svc
		case *subscriptions.Module:
			e.Subs = m.Svc
		case *promotions.Module:
			e.Promo = m.Svc
		}
	}
	return e
}

func rnd(n int64) int64 {
	v, _ := rand.Int(rand.Reader, big.NewInt(n))
	return v.Int64()
}

// User creates an ACTIVE user and returns its id and an access token.
func (e *Env) User(name string) (string, string) {
	e.T.Helper()
	var id string
	phone := fmt.Sprintf("+99451%07d", rnd(10_000_000))
	if err := e.D.Pool.QueryRow(context.Background(), `insert into users (name, phone) values ($1, $2) returning id`, name, phone).Scan(&id); err != nil {
		e.T.Fatal(err)
	}
	return id, e.Token(id, "USER")
}

// Admin creates an ADMIN user.
func (e *Env) Admin() (string, string) {
	id, _ := e.User("Admin")
	e.Exec(`update users set role = 'ADMIN' where id = $1`, id)
	return id, e.Token(id, "ADMIN")
}

func (e *Env) Token(id, role string) string {
	tok, err := e.D.Signer.Sign(auth.User{ID: id, Role: role, AccountType: "INDIVIDUAL"})
	if err != nil {
		e.T.Fatal(err)
	}
	return tok
}

// ListingOpts customise Listing.
type ListingOpts struct {
	DealType, Status string
	Price            int
	MaxGuests        int
}

// Listing inserts a listing directly (the listings module belongs to another workstream).
func (e *Env) Listing(owner string, o ListingOpts) string {
	e.T.Helper()
	if o.DealType == "" {
		o.DealType = "RENT_DAILY"
	}
	if o.Status == "" {
		o.Status = "ACTIVE"
	}
	if o.Price == 0 {
		o.Price = 80
	}
	if o.MaxGuests == 0 {
		o.MaxGuests = 3
	}
	var id string
	err := e.D.Pool.QueryRow(context.Background(), `insert into listings (owner_id, deal_type, property_type, title, description, price, city_id, area, rooms,
		contact_name, contact_phone, status, max_guests, min_nights) values ($1,$2,'APARTMENT','Dəniz kənarında mənzil','Integration test listing',$3,'baku',50,2,
		'Host','+994501234567',$4,$5,1) returning id`, owner, o.DealType, o.Price, o.Status, o.MaxGuests).Scan(&id)
	if err != nil {
		e.T.Fatal(err)
	}
	return id
}

// Exec runs SQL on the test database.
func (e *Env) Exec(sql string, args ...any) {
	e.T.Helper()
	if _, err := e.D.Pool.Exec(context.Background(), sql, args...); err != nil {
		e.T.Fatal(err)
	}
}

// Scalar runs a single-value query.
func (e *Env) Scalar(sql string, dst any, args ...any) {
	e.T.Helper()
	if err := e.D.Pool.QueryRow(context.Background(), sql, args...).Scan(dst); err != nil {
		e.T.Fatalf("%s: %v", sql, err)
	}
}

// Fund credits a wallet (TOPUP).
func (e *Env) Fund(userID string, amount int) {
	e.T.Helper()
	if err := e.Wal.Credit(context.Background(), nil, userID, amount, "TOPUP", "test", app.WalletOpts{}); err != nil {
		e.T.Fatal(err)
	}
}

// Wallet returns the wallet DTO.
func (e *Env) Wallet(userID string) wallet.Wallet {
	e.T.Helper()
	w, err := e.Wal.Get(context.Background(), nil, userID)
	if err != nil {
		e.T.Fatal(err)
	}
	return w
}

// Res is a decoded HTTP response.
type Res struct {
	Status int
	Body   map[string]any
	Raw    []byte
	Header http.Header
}

// Code returns the ApiError code of an error response.
func (r Res) Code() string { s, _ := r.Body["code"].(string); return s }

// S / N read string / number fields of the body.
func (r Res) S(k string) string { s, _ := r.Body[k].(string); return s }
func (r Res) N(k string) int    { f, _ := r.Body[k].(float64); return int(f) }

// Call performs a JSON request against the API (path relative to /api/v1).
func (e *Env) Call(method, path string, body any, token string) Res {
	e.T.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.Srv.URL+"/api/v1"+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return e.Do(req)
}

// Do sends a request without following redirects.
func (e *Env) Do(req *http.Request) Res {
	e.T.Helper()
	res, err := e.Client.Do(req)
	if err != nil {
		e.T.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := Res{Status: res.StatusCode, Raw: raw, Header: res.Header}
	if len(raw) > 0 && strings.HasPrefix(strings.TrimSpace(string(raw)), "{") {
		_ = json.Unmarshal(raw, &out.Body)
	}
	return out
}

// PayCard drives the fake bank checkout (card + optional extra query, e.g. "&webhook=0") and follows the bank redirect
// to the API return endpoint. Returns the final client redirect Location.
func (e *Env) PayCard(paymentURL, card, extra string) string {
	e.T.Helper()
	req, _ := http.NewRequest(http.MethodGet, paymentURL+"?card="+card+extra, nil)
	r1 := e.Do(req)
	if r1.Status != http.StatusFound {
		e.T.Fatalf("bank checkout: %d %s", r1.Status, r1.Raw)
	}
	req, _ = http.NewRequest(http.MethodGet, r1.Header.Get("Location"), nil)
	r2 := e.Do(req)
	if r2.Status != http.StatusFound {
		e.T.Fatalf("api return: %d %s", r2.Status, r2.Raw)
	}
	return r2.Header.Get("Location")
}

// Payment loads a payment row.
func (e *Env) Payment(id string) *payments.Row {
	e.T.Helper()
	p, err := e.Pay.GetRow(context.Background(), nil, id)
	if err != nil || p == nil {
		e.T.Fatalf("payment %s: %v", id, err)
	}
	return p
}

// Notifications returns the notification types of a user (oldest first).
func (e *Env) Notifications(userID string) []string {
	e.T.Helper()
	e.D.Bus.Wait()
	rows, err := e.D.Pool.Query(context.Background(), `select type from notifications where user_id = $1 order by created_at, id`, userID)
	if err != nil {
		e.T.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		out = append(out, s)
	}
	return out
}

// Day returns the local date n days from today (YYYY-MM-DD).
func Day(n int) string { return time.Now().In(bookings.Local).AddDate(0, 0, n).Format("2006-01-02") }
