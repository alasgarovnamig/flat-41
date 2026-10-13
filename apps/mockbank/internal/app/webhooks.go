package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/sig"
	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

// RetryDelays are the delays before retry #1..#6 (docs/MOCKBANK.md): 5 s, 30 s, 2 min, 10 min, 1 h, 6 h.
var RetryDelays = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour, 6 * time.Hour}

// MaxAttempts is the initial attempt + 6 retries.
var MaxAttempts = len(RetryDelays) + 1

// While an attempt is in flight its row is leased so the scheduler won't pick it up concurrently.
const leaseMS = 120_000
const maxLoggedBody = 4_000

// Webhook statuses.
const (
	WebhookPending   = "PENDING"
	WebhookDelivered = "DELIVERED"
	WebhookFailed    = "FAILED"
)

// Webhook is a row of the webhooks table.
type Webhook struct {
	ID             string
	OrderID        string
	MerchantID     string
	Event          string
	URL            string
	Body           string
	Status         string
	Attempts       int
	NextAttemptAt  *time.Time
	LastStatusCode *int
	CreatedAt      time.Time
	DeliveredAt    *time.Time
}

// Delivery is a row of webhook_deliveries (one HTTP attempt).
type Delivery struct {
	ID             int64
	WebhookID      string
	OrderID        string
	Event          string
	Attempt        int
	URL            string
	RequestBody    string
	ResponseStatus *int
	ResponseBody   *string
	Error          *string
	DurationMS     int
	CreatedAt      time.Time
}

const webhookCols = `id, order_id, merchant_id, event, url, body, status, attempts, next_attempt_at, last_status_code, created_at, delivered_at`

func scanWebhook(row rowScanner) (*Webhook, error) {
	var w Webhook
	err := row.Scan(&w.ID, &w.OrderID, &w.MerchantID, &w.Event, &w.URL, &w.Body, &w.Status, &w.Attempts,
		&w.NextAttemptAt, &w.LastStatusCode, &w.CreatedAt, &w.DeliveredAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// WebhookService is the DB-backed outgoing webhook queue.
type WebhookService struct {
	db        *pgxpool.Pool
	merchants *MerchantService
	log       *slog.Logger
	client    *http.Client
	scale     atomic.Uint64 // float64 bits of the retry-scale multiplier
	inFlight  sync.WaitGroup
}

// NewWebhookService creates the service.
func NewWebhookService(db *pgxpool.Pool, merchants *MerchantService, log *slog.Logger, timeout time.Duration, retryScale float64) *WebhookService {
	transport := &http.Transport{
		// Like Node's fetch: no HTTP(S)_PROXY from the environment.
		Proxy:               nil,
		DialContext:         (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:        50,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	s := &WebhookService{
		db:        db,
		merchants: merchants,
		log:       log,
		client: &http.Client{
			Transport: transport,
			Timeout:   timeout,
			// redirect: 'manual' — a 3xx is a failed attempt, never followed.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	s.SetRetryScale(retryScale)
	return s
}

// SetRetryScale changes the retry-schedule multiplier at runtime (tests).
func (s *WebhookService) SetRetryScale(v float64) { s.scale.Store(math.Float64bits(v)) }

// RetryScale returns the current retry-schedule multiplier.
func (s *WebhookService) RetryScale() float64 { return math.Float64frombits(s.scale.Load()) }

// Enqueue queues a webhook (call inside the transaction that changed the order). The row is
// created leased; call DeliverNow after commit for the immediate first attempt. If the process
// dies before that, the scheduler picks it up once the lease expires.
func (s *WebhookService) Enqueue(ctx context.Context, q Querier, merchantID, callbackURL, event string, order OrderJSON) (string, error) {
	id := util.NewID("wh", 12)
	body, err := MarshalJSON(struct {
		Event string    `json:"event"`
		Order OrderJSON `json:"order"`
	}{event, order})
	if err != nil {
		return "", err
	}
	_, err = q.Exec(ctx, `INSERT INTO webhooks (id, order_id, merchant_id, event, url, body, next_attempt_at)
		VALUES ($1, $2, $3, $4, $5, $6, now() + $7::bigint * interval '1 millisecond')`,
		id, order.OrderID, merchantID, event, callbackURL, string(body), int64(leaseMS))
	return id, err
}

// DeliverNow makes the first attempt right away (awaited: checkout sends the webhook before redirecting).
func (s *WebhookService) DeliverNow(ctx context.Context, webhookID string) error {
	w, err := scanWebhook(s.db.QueryRow(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE id = $1 AND status = 'PENDING'`, webhookID))
	if err != nil {
		if isNoRows(err) {
			return nil
		}
		return err
	}
	return s.attempt(ctx, w)
}

// Dispatch delivers in the background; Drain waits for it on shutdown.
func (s *WebhookService) Dispatch(webhookID string) {
	s.inFlight.Add(1)
	go func() {
		defer s.inFlight.Done()
		if err := s.DeliverNow(context.Background(), webhookID); err != nil {
			s.log.Error("webhook delivery crashed", "webhookId", webhookID, "err", err.Error())
		}
	}()
}

// ProcessDue claims due webhooks (SKIP LOCKED, safe with several instances) and attempts them.
func (s *WebhookService) ProcessDue(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Query(ctx, `UPDATE webhooks SET next_attempt_at = now() + $2::bigint * interval '1 millisecond'
		WHERE id IN (
		  SELECT id FROM webhooks WHERE status = 'PENDING' AND next_attempt_at <= now()
		  ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
		RETURNING `+webhookCols, limit, int64(leaseMS))
	if err != nil {
		return 0, err
	}
	var due []*Webhook
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			rows.Close()
			return 0, err
		}
		due = append(due, w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var wg sync.WaitGroup
	for _, w := range due {
		wg.Add(1)
		s.inFlight.Add(1)
		go func(w *Webhook) {
			defer wg.Done()
			defer s.inFlight.Done()
			if err := s.attempt(context.Background(), w); err != nil {
				s.log.Error("webhook delivery crashed", "webhookId", w.ID, "err", err.Error())
			}
		}(w)
	}
	wg.Wait()
	return len(due), nil
}

// ListForOrder returns the order's webhooks (newest first) and every delivery attempt (newest first).
func (s *WebhookService) ListForOrder(ctx context.Context, orderID string) ([]Webhook, []Delivery, error) {
	rows, err := s.db.Query(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE order_id = $1 ORDER BY created_at DESC`, orderID)
	if err != nil {
		return nil, nil, err
	}
	var hooks []Webhook
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			rows.Close()
			return nil, nil, err
		}
		hooks = append(hooks, *w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT id, webhook_id, order_id, event, attempt, url, request_body, response_status,
		response_body, error, duration_ms, created_at FROM webhook_deliveries WHERE order_id = $1 ORDER BY id DESC`, orderID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var deliveries []Delivery
	for rows.Next() {
		var d Delivery
		if err := rows.Scan(&d.ID, &d.WebhookID, &d.OrderID, &d.Event, &d.Attempt, &d.URL, &d.RequestBody, &d.ResponseStatus,
			&d.ResponseBody, &d.Error, &d.DurationMS, &d.CreatedAt); err != nil {
			return nil, nil, err
		}
		deliveries = append(deliveries, d)
	}
	return hooks, deliveries, rows.Err()
}

// Drain waits for background deliveries (graceful shutdown / tests).
func (s *WebhookService) Drain() { s.inFlight.Wait() }

func describeError(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Client.Timeout") {
		return "TimeoutError: The operation was aborted due to timeout"
	}
	return "FetchError: " + err.Error()
}

func (s *WebhookService) attempt(ctx context.Context, w *Webhook) error {
	merchant, err := s.merchants.Get(ctx, w.MerchantID)
	if err != nil {
		return err
	}
	attempt := w.Attempts + 1
	started := time.Now()
	var status *int
	var responseBody, errText *string

	if merchant == nil {
		errText = strPtr("Unknown merchant " + w.MerchantID)
	} else {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, strings.NewReader(w.Body))
		if err != nil {
			errText = strPtr(describeError(err))
		} else {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("User-Agent", "MockBank-Webhooks/1.0")
			sig.SetHeaders(req.Header, merchant.ID, merchant.Secret, w.Body, time.Now())
			res, err := s.client.Do(req)
			if err != nil {
				errText = strPtr(describeError(err))
			} else {
				code := res.StatusCode
				status = &code
				b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
				res.Body.Close()
				body := util.JSSlice(util.SanitizeText(string(b)), maxLoggedBody)
				responseBody = &body
			}
		}
	}
	durationMS := int(time.Since(started).Milliseconds())
	ok := status != nil && *status >= 200 && *status < 300

	if _, err := s.db.Exec(ctx, `INSERT INTO webhook_deliveries (webhook_id, order_id, event, attempt, url, request_body, response_status, response_body, error, duration_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		w.ID, w.OrderID, w.Event, attempt, w.URL, w.Body, status, responseBody, errText, durationMS); err != nil {
		return err
	}

	if ok {
		if _, err := s.db.Exec(ctx, `UPDATE webhooks SET status = 'DELIVERED', attempts = $2, last_status_code = $3, delivered_at = now(), next_attempt_at = NULL WHERE id = $1`,
			w.ID, attempt, status); err != nil {
			return err
		}
		if err := addEvent(ctx, s.db, w.OrderID, "WEBHOOK_DELIVERED", fmt.Sprintf("Webhook %s delivered (HTTP %d, attempt %d)", w.Event, *status, attempt), nil); err != nil {
			return err
		}
		s.log.Info("webhook delivered", "id", w.ID, "event", w.Event, "attempt", attempt, "status", *status)
		return nil
	}

	outcome := ""
	if errText != nil {
		outcome = *errText
	} else {
		outcome = fmt.Sprintf("HTTP %d", *status)
	}
	if attempt >= MaxAttempts {
		if _, err := s.db.Exec(ctx, `UPDATE webhooks SET status = 'FAILED', attempts = $2, last_status_code = $3, next_attempt_at = NULL WHERE id = $1`,
			w.ID, attempt, status); err != nil {
			return err
		}
		if err := addEvent(ctx, s.db, w.OrderID, "WEBHOOK_FAILED", fmt.Sprintf("Webhook %s failed permanently after %d attempts (%s)", w.Event, attempt, outcome), nil); err != nil {
			return err
		}
		s.log.Warn("webhook failed permanently", "id", w.ID, "event", w.Event, "attempt", attempt, "outcome", outcome)
		return nil
	}
	delay := int64(math.Max(0, math.Round(float64(RetryDelays[attempt-1].Milliseconds())*s.RetryScale())))
	if _, err := s.db.Exec(ctx, `UPDATE webhooks SET attempts = $2, last_status_code = $3, next_attempt_at = now() + $4::bigint * interval '1 millisecond' WHERE id = $1`,
		w.ID, attempt, status, delay); err != nil {
		return err
	}
	if err := addEvent(ctx, s.db, w.OrderID, "WEBHOOK_RETRY", fmt.Sprintf("Webhook %s attempt %d failed (%s); retry in %s", w.Event, attempt, outcome, formatDelay(delay)), nil); err != nil {
		return err
	}
	s.log.Warn("webhook attempt failed", "id", w.ID, "event", w.Event, "attempt", attempt, "outcome", outcome, "retryInMs", delay)
	return nil
}

func formatDelay(ms int64) string {
	round := func(v float64) int64 { return int64(math.Floor(v + 0.5)) }
	switch {
	case ms < 1000:
		return fmt.Sprintf("%d ms", ms)
	case ms < 60_000:
		return fmt.Sprintf("%d s", round(float64(ms)/1000))
	case ms < 3_600_000:
		return fmt.Sprintf("%d min", round(float64(ms)/60_000))
	}
	return fmt.Sprintf("%d h", round(float64(ms)/3_600_000))
}
