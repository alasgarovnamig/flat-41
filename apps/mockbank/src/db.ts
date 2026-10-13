import pg from 'pg';

// BIGINT (int8) and NUMERIC come back as strings by default; amounts are safe integers here.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/**
 * Idempotent schema bootstrap. Card data rule: never persist a full PAN or CVV —
 * only mask, brand and holder name are stored.
 */
export const SCHEMA_SQL = `
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
`;

export async function migrate(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    // Serialise concurrent boots (e.g. several replicas) on the same database.
    await client.query('SELECT pg_advisory_lock(41004100)');
    await client.query(SCHEMA_SQL);
  } finally {
    await client.query('SELECT pg_advisory_unlock(41004100)').catch(() => undefined);
    client.release();
  }
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Maps a snake_case row to a camelCase object. */
export function mapRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
