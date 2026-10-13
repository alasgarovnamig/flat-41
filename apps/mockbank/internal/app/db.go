package app

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SchemaSQL is the idempotent schema bootstrap (same tables / columns as the former Node
// implementation, so an existing database keeps working). Card data rule: never persist a
// full PAN or CVV — only mask, brand and holder name are stored.
const SchemaSQL = `
CREATE TABLE IF NOT EXISTS merchants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  secret      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                   TEXT PRIMARY KEY,
  merchant_id          TEXT NOT NULL REFERENCES merchants(id),
  merchant_order_id    TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'CHECKOUT',
  amount               BIGINT NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  language             TEXT NOT NULL DEFAULT 'az',
  return_url           TEXT,
  callback_url         TEXT,
  save_card            BOOLEAN NOT NULL DEFAULT false,
  customer             JSONB,
  status               TEXT NOT NULL,
  refunded_amount      BIGINT NOT NULL DEFAULT 0,
  card_mask            TEXT,
  card_brand           TEXT,
  card_token           TEXT,
  card_holder          TEXT,
  save_card_requested  BOOLEAN NOT NULL DEFAULT false,
  decline_code         TEXT,
  decline_reason       TEXT,
  rrn                  TEXT,
  approval_code        TEXT,
  otp_attempts         INTEGER NOT NULL DEFAULT 0,
  form_nonce           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at              TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (merchant_id, merchant_order_id)
);
CREATE INDEX IF NOT EXISTS orders_status_expires_idx ON orders (status, expires_at);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS refunds (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount      BIGINT NOT NULL CHECK (amount > 0),
  reason      TEXT,
  source      TEXT NOT NULL DEFAULT 'API',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds (order_id, created_at);

CREATE TABLE IF NOT EXISTS card_tokens (
  token                     TEXT PRIMARY KEY,
  merchant_id               TEXT NOT NULL REFERENCES merchants(id),
  mask                      TEXT NOT NULL,
  brand                     TEXT NOT NULL,
  customer_id               TEXT,
  force_insufficient_funds  BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at              TIMESTAMPTZ
);

-- Outgoing webhook notifications (queue). Each HTTP attempt is logged in webhook_deliveries.
CREATE TABLE IF NOT EXISTS webhooks (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  merchant_id      TEXT NOT NULL REFERENCES merchants(id),
  event            TEXT NOT NULL,
  url              TEXT NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING',
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ,
  last_status_code INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webhooks_due_idx ON webhooks (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhooks_order_idx ON webhooks (order_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               BIGSERIAL PRIMARY KEY,
  webhook_id       TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event            TEXT NOT NULL,
  attempt          INTEGER NOT NULL,
  url              TEXT NOT NULL,
  request_body     TEXT NOT NULL,
  response_status  INTEGER,
  response_body    TEXT,
  error            TEXT,
  duration_ms      INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_order_idx ON webhook_deliveries (order_id, created_at);

-- Order timeline.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS events_order_idx ON events (order_id, id);
`

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// NewPool opens a pgx pool (max 10 connections, like the Node version).
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if cfg.MaxConns > 10 || cfg.MaxConns == 0 {
		cfg.MaxConns = 10
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}

// Migrate creates the tables (idempotent), serialising concurrent boots on the same database.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock(41004100)"); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock(41004100)") //nolint:errcheck
	// No arguments → simple protocol, so the multi-statement script runs in one round trip.
	_, err = conn.Exec(ctx, SchemaSQL)
	return err
}

// withTx runs fn in a transaction (committed when fn returns nil).
func withTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(context.Background())
		return err
	}
	return tx.Commit(ctx)
}
