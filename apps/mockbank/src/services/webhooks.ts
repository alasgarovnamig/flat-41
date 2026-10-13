import type { Config } from '../config';
import { mapRow, type Db, type Queryable } from '../db';
import type { Logger } from '../lib/logger';
import { signedHeaders } from '../lib/signature';
import type { OrderJson, WebhookEvent } from '../lib/types';
import { newId } from '../lib/util';
import { addEvent } from './orderStore';
import type { MerchantService } from './merchants';

/** Delays before retry #1..#6 (docs/MOCKBANK.md): 5 s, 30 s, 2 min, 10 min, 1 h, 6 h. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000, 21_600_000];
/** Initial attempt + 6 retries. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** While an attempt is in flight its row is leased so the scheduler won't pick it up concurrently. */
const LEASE_MS = 120_000;
const MAX_LOGGED_BODY = 4_000;

export type WebhookStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export interface WebhookRow {
  id: string;
  orderId: string;
  merchantId: string;
  event: WebhookEvent;
  url: string;
  body: string;
  status: WebhookStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface DeliveryRow {
  id: number;
  webhookId: string;
  orderId: string;
  event: string;
  attempt: number;
  url: string;
  requestBody: string;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  createdAt: Date;
}

export class WebhookService {
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly merchants: MerchantService,
    private readonly log: Logger,
  ) {}

  /**
   * Queues a webhook (call inside the transaction that changed the order). The row is created
   * leased; call {@link deliverNow} after commit for the immediate first attempt. If the process
   * dies before that, the scheduler picks it up once the lease expires.
   */
  async enqueue(q: Queryable, merchantId: string, url: string, event: WebhookEvent, order: OrderJson): Promise<string> {
    const id = newId('wh');
    const body = JSON.stringify({ event, order });
    await q.query(
      `INSERT INTO webhooks (id, order_id, merchant_id, event, url, body, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' milliseconds')::interval)`,
      [id, order.orderId, merchantId, event, url, body, String(LEASE_MS)],
    );
    return id;
  }

  /** First attempt right away. Awaitable (checkout: webhook before redirect) or fire-and-forget via {@link dispatch}. */
  async deliverNow(webhookId: string): Promise<void> {
    const { rows } = await this.db.query(`SELECT * FROM webhooks WHERE id = $1 AND status = 'PENDING'`, [webhookId]);
    if (rows[0]) await this.attempt(mapRow<WebhookRow>(rows[0]));
  }

  /** Fire-and-forget delivery that is still awaited on shutdown. */
  dispatch(webhookId: string): void {
    this.track(this.deliverNow(webhookId));
  }

  /** Scheduler tick: claims due webhooks (SKIP LOCKED, safe with several instances) and attempts them. */
  async processDue(limit = 20): Promise<number> {
    const { rows } = await this.db.query(
      `UPDATE webhooks SET next_attempt_at = now() + ($2 || ' milliseconds')::interval
       WHERE id IN (
         SELECT id FROM webhooks WHERE status = 'PENDING' AND next_attempt_at <= now()
         ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [limit, String(LEASE_MS)],
    );
    await Promise.all(rows.map((r) => this.track(this.attempt(mapRow<WebhookRow>(r)))));
    return rows.length;
  }

  async listForOrder(orderId: string): Promise<{ webhooks: WebhookRow[]; deliveries: DeliveryRow[] }> {
    const [w, d] = await Promise.all([
      this.db.query('SELECT * FROM webhooks WHERE order_id = $1 ORDER BY created_at DESC', [orderId]),
      this.db.query('SELECT * FROM webhook_deliveries WHERE order_id = $1 ORDER BY id DESC', [orderId]),
    ]);
    return { webhooks: w.rows.map((r) => mapRow<WebhookRow>(r)), deliveries: d.rows.map((r) => mapRow<DeliveryRow>(r)) };
  }

  /** Waits for fire-and-forget deliveries (graceful shutdown / tests). */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private track<T>(p: Promise<T>): Promise<T | void> {
    const tracked = p.catch((err: unknown) => this.log.error('webhook delivery crashed', { err: String(err) }));
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
    return tracked;
  }

  private async attempt(wh: WebhookRow): Promise<void> {
    const merchant = await this.merchants.get(wh.merchantId);
    const attempt = wh.attempts + 1;
    const started = Date.now();
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    if (!merchant) error = `Unknown merchant ${wh.merchantId}`;
    else {
      try {
        const res = await fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'MockBank-Webhooks/1.0',
            ...signedHeaders(merchant.id, merchant.secret, wh.body),
          },
          body: wh.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.config.webhookTimeoutMs),
        });
        status = res.status;
        responseBody = (await res.text().catch(() => '')).slice(0, MAX_LOGGED_BODY);
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${(err.cause as Error | undefined)?.message ?? err.message}` : String(err);
      }
    }
    const durationMs = Date.now() - started;
    const ok = status !== null && status >= 200 && status < 300;

    await this.db.query(
      `INSERT INTO webhook_deliveries (webhook_id, order_id, event, attempt, url, request_body, response_status, response_body, error, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [wh.id, wh.orderId, wh.event, attempt, wh.url, wh.body, status, responseBody, error, durationMs],
    );

    if (ok) {
      await this.db.query(
        `UPDATE webhooks SET status = 'DELIVERED', attempts = $2, last_status_code = $3, delivered_at = now(), next_attempt_at = NULL WHERE id = $1`,
        [wh.id, attempt, status],
      );
      await addEvent(this.db, wh.orderId, 'WEBHOOK_DELIVERED', `Webhook ${wh.event} delivered (HTTP ${status}, attempt ${attempt})`);
      this.log.info('webhook delivered', { id: wh.id, event: wh.event, attempt, status });
      return;
    }

    const outcome = error ?? `HTTP ${status}`;
    if (attempt >= MAX_ATTEMPTS) {
      await this.db.query(
        `UPDATE webhooks SET status = 'FAILED', attempts = $2, last_status_code = $3, next_attempt_at = NULL WHERE id = $1`,
        [wh.id, attempt, status],
      );
      await addEvent(this.db, wh.orderId, 'WEBHOOK_FAILED', `Webhook ${wh.event} failed permanently after ${attempt} attempts (${outcome})`);
      this.log.warn('webhook failed permanently', { id: wh.id, event: wh.event, attempt, outcome });
      return;
    }
    const delay = Math.max(0, Math.round(RETRY_DELAYS_MS[attempt - 1]! * this.config.webhookRetryScale));
    await this.db.query(
      `UPDATE webhooks SET attempts = $2, last_status_code = $3, next_attempt_at = now() + ($4 || ' milliseconds')::interval WHERE id = $1`,
      [wh.id, attempt, status, String(delay)],
    );
    await addEvent(this.db, wh.orderId, 'WEBHOOK_RETRY', `Webhook ${wh.event} attempt ${attempt} failed (${outcome}); retry in ${formatDelay(delay)}`);
    this.log.warn('webhook attempt failed', { id: wh.id, event: wh.event, attempt, outcome, retryInMs: delay });
  }
}

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}
