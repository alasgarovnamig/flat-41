import type pg from 'pg';
import type { Config } from '../config';
import { mapRow, withTransaction, type Db } from '../db';
import { cardOutcome, type ValidatedCard } from '../lib/cards';
import { ApiError, orderNotFound } from '../lib/errors';
import type { Logger } from '../lib/logger';
import type { DeclineCode, Merchant, OrderJson, OrderRow, OrderStatus } from '../lib/types';
import { formatMoney, newApprovalCode, newId, newNonce, newRrn } from '../lib/util';
import type { ChargeTokenInput, CreateOrderInput, RefundInput } from '../lib/validation';
import {
  DECLINE_REASONS,
  NOW,
  addEvent,
  eventForStatus,
  findOrder,
  findRefunds,
  loadOrderJson,
  toOrderJson,
  transition,
} from './orderStore';
import type { TokenService } from './tokens';
import type { WebhookService } from './webhooks';

export const TEST_OTP = '111111';
export const MAX_OTP_ATTEMPTS = 3;

/** How webhooks raised by an operation are sent after commit. */
type Delivery = 'await' | 'background';

export interface OrderListFilter {
  status?: string;
  merchantId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export class OrderService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly tokens: TokenService,
    private readonly webhooks: WebhookService,
    private readonly log: Logger,
  ) {}

  // ---------------------------------------------------------------- reads

  async get(orderId: string): Promise<OrderRow | null> {
    return findOrder(this.db, orderId);
  }

  async getForMerchant(merchantId: string, orderId: string): Promise<OrderRow> {
    const order = await findOrder(this.db, orderId);
    if (!order || order.merchantId !== merchantId) throw orderNotFound();
    return order;
  }

  async toJson(order: OrderRow): Promise<OrderJson> {
    return loadOrderJson(this.db, order);
  }

  paymentUrl(orderId: string): string {
    return `${this.config.publicUrl}/checkout/${orderId}`;
  }

  // ---------------------------------------------------------------- merchant API

  /** POST /orders — idempotent on (merchant, merchantOrderId). */
  async create(merchant: Merchant, input: CreateOrderInput): Promise<{ order: OrderRow; created: boolean }> {
    const id = newId('ord');
    const { rows } = await this.db.query(
      `INSERT INTO orders (id, merchant_id, merchant_order_id, kind, amount, currency, description, language,
         return_url, callback_url, save_card, customer, status, form_nonce, expires_at)
       VALUES ($1, $2, $3, 'CHECKOUT', $4, $5, $6, $7, $8, $9, $10, $11, 'CREATED', $12, now() + ($13 || ' minutes')::interval)
       ON CONFLICT (merchant_id, merchant_order_id) DO NOTHING
       RETURNING *`,
      [
        id,
        merchant.id,
        input.merchantOrderId,
        input.amount,
        input.currency,
        input.description,
        input.language,
        input.returnUrl,
        input.callbackUrl,
        input.saveCard,
        input.customer ? JSON.stringify(input.customer) : null,
        newNonce(),
        String(this.config.orderTtlMinutes),
      ],
    );
    if (rows[0]) {
      const order = mapRow<OrderRow>(rows[0]);
      await addEvent(this.db, order.id, 'CREATED', `Order created for ${formatMoney(order.amount, order.currency)}`, {
        merchantOrderId: order.merchantOrderId,
        saveCard: order.saveCard,
        language: order.language,
      });
      this.log.info('order created', { orderId: order.id, merchantOrderId: order.merchantOrderId });
      return { order, created: true };
    }
    const existing = await this.findByMerchantOrderId(this.db, merchant.id, input.merchantOrderId);
    if (!existing) throw new ApiError(500, 'INTERNAL_ERROR', 'Idempotent lookup failed');
    return { order: existing, created: false };
  }

  /** POST /orders/charge-token — synchronous merchant-initiated charge of a saved card. */
  async chargeToken(merchant: Merchant, input: ChargeTokenInput): Promise<OrderRow> {
    const { order, webhookId } = await withTransaction(this.db, async (client) => {
      const existing = await this.findByMerchantOrderId(client, merchant.id, input.merchantOrderId);
      if (existing) return { order: existing, webhookId: null };

      const token = await this.tokens.find(client, input.cardToken, merchant.id, { forUpdate: true });
      let status: OrderStatus = 'APPROVED';
      let declineCode: DeclineCode | null = null;
      if (!token) declineCode = 'TOKEN_INVALID';
      else if (token.forceInsufficientFunds) declineCode = 'INSUFFICIENT_FUNDS';
      if (declineCode) status = 'DECLINED';
      const approved = status === 'APPROVED';

      const { rows } = await client.query(
        `INSERT INTO orders (id, merchant_id, merchant_order_id, kind, amount, currency, description, language,
           callback_url, status, card_mask, card_brand, card_token, decline_code, decline_reason, rrn, approval_code,
           form_nonce, paid_at, expires_at)
         VALUES ($1, $2, $3, 'TOKEN', $4, $5, $6, 'en', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
           CASE WHEN $8 = 'APPROVED' THEN now() END, now() + ($17 || ' minutes')::interval)
         ON CONFLICT (merchant_id, merchant_order_id) DO NOTHING
         RETURNING *`,
        [
          newId('ord'),
          merchant.id,
          input.merchantOrderId,
          input.amount,
          input.currency,
          input.description,
          input.callbackUrl,
          status,
          token?.mask ?? null,
          token?.brand ?? null,
          token?.token ?? null,
          declineCode,
          declineCode ? DECLINE_REASONS[declineCode] : null,
          approved ? newRrn() : null,
          approved ? newApprovalCode() : null,
          newNonce(),
          String(this.config.orderTtlMinutes),
        ],
      );
      if (!rows[0]) {
        // Concurrent request with the same merchantOrderId won the race.
        const raced = await this.findByMerchantOrderId(client, merchant.id, input.merchantOrderId);
        return { order: raced!, webhookId: null };
      }
      const order = mapRow<OrderRow>(rows[0]);
      if (token) await this.tokens.touch(client, token.token);
      await addEvent(client, order.id, 'CREATED', `Token charge ${formatMoney(order.amount, order.currency)} with ${input.cardToken}`);
      await addEvent(
        client,
        order.id,
        order.status,
        approved ? `Approved (RRN ${order.rrn}, auth ${order.approvalCode})` : `Declined: ${declineCode} — ${order.declineReason}`,
      );
      return { order, webhookId: await this.queueWebhook(client, order) };
    });
    await this.send(webhookId, 'background');
    return order;
  }

  /** POST /orders/:id/refund (also used by the admin UI). */
  async refund(orderId: string, input: RefundInput, opts: { merchantId?: string; source: 'API' | 'ADMIN' }): Promise<OrderRow> {
    const { order, webhookId } = await withTransaction(this.db, async (client) => {
      const current = await findOrder(client, orderId, { forUpdate: true });
      if (!current || (opts.merchantId && current.merchantId !== opts.merchantId)) throw orderNotFound();
      if (current.status !== 'APPROVED' && current.status !== 'PARTIALLY_REFUNDED') {
        throw new ApiError(409, 'NOT_REFUNDABLE', `Order in status ${current.status} cannot be refunded`);
      }
      const remaining = current.amount - current.refundedAmount;
      const amount = input.amount ?? remaining;
      if (amount > remaining) {
        throw new ApiError(409, 'NOT_REFUNDABLE', `Refund amount ${amount} exceeds the refundable remainder ${remaining}`);
      }
      const refundedAmount = current.refundedAmount + amount;
      const status: OrderStatus = refundedAmount >= current.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      const refundId = newId('rf');
      await client.query('INSERT INTO refunds (id, order_id, amount, reason, source) VALUES ($1, $2, $3, $4, $5)', [
        refundId,
        current.id,
        amount,
        input.reason,
        opts.source,
      ]);
      const order = (await transition(client, current.id, [current.status], { status, refunded_amount: refundedAmount }))!;
      await addEvent(
        client,
        order.id,
        'REFUNDED',
        `Refund ${refundId} ${formatMoney(amount, order.currency)} via ${opts.source}${input.reason ? ` — ${input.reason}` : ''} → ${status}`,
        { refundId, amount },
      );
      return { order, webhookId: await this.queueWebhook(client, order) };
    });
    await this.send(webhookId, opts.source === 'API' ? 'background' : 'await');
    return order;
  }

  /** POST /orders/:id/cancel — merchant cancels an unpaid order. */
  async cancel(merchantId: string, orderId: string): Promise<OrderRow> {
    const existing = await this.getForMerchant(merchantId, orderId);
    const result = await this.finish(existing.id, ['CREATED'], 'CANCELLED', {}, 'Cancelled by merchant', 'background');
    if (!result) {
      const fresh = (await findOrder(this.db, orderId))!;
      throw new ApiError(409, 'NOT_CANCELLABLE', `Order in status ${fresh.status} cannot be cancelled`);
    }
    return result;
  }

  // ---------------------------------------------------------------- hosted checkout

  /** Customer pressed Cancel on the card form. */
  async cancelByCustomer(orderId: string): Promise<OrderRow | null> {
    return this.finish(orderId, ['CREATED'], 'CANCELLED', {}, 'Cancelled by cardholder on the payment page', 'await');
  }

  /** Card form submitted (already validated). Returns the order in its new state. */
  async submitCard(orderId: string, card: ValidatedCard, saveRequested: boolean): Promise<OrderRow | null> {
    const outcome = cardOutcome(card.pan);
    const cardFields = { card_mask: card.mask, card_brand: card.brand, card_holder: card.holder };
    const { order, webhookId } = await withTransaction(this.db, async (client) => {
      const current = await findOrder(client, orderId, { forUpdate: true });
      if (!current || current.status !== 'CREATED') return { order: null, webhookId: null };
      const save = current.saveCard && saveRequested;
      await addEvent(client, orderId, 'CARD_SUBMITTED', `Card ${card.mask} (${card.brand}) submitted${save ? ', save card requested' : ''}`);

      if (outcome.kind === '3DS') {
        const order = await transition(client, orderId, ['CREATED'], {
          ...cardFields,
          status: 'PROCESSING',
          save_card_requested: save,
          otp_attempts: 0,
        });
        await addEvent(client, orderId, '3DS_STARTED', '3-D Secure challenge started');
        return { order, webhookId: null };
      }
      if (outcome.kind === 'DECLINE') {
        const order = (await transition(client, orderId, ['CREATED'], {
          ...cardFields,
          status: 'DECLINED',
          decline_code: outcome.code,
          decline_reason: DECLINE_REASONS[outcome.code],
        }))!;
        await addEvent(client, orderId, 'DECLINED', `Declined by issuer: ${outcome.code} — ${DECLINE_REASONS[outcome.code]}`);
        return { order, webhookId: await this.queueWebhook(client, order) };
      }
      const order = await this.approve(client, current, ['CREATED'], { ...cardFields, save }, 'Approved (frictionless)');
      return { order, webhookId: await this.queueWebhook(client, order) };
    });
    await this.send(webhookId, 'await');
    return order;
  }

  /** 3-D Secure OTP submitted. */
  async submitOtp(orderId: string, otp: string): Promise<{ order: OrderRow; attemptsLeft: number } | null> {
    const { result, webhookId } = await withTransaction(this.db, async (client) => {
      const current = await findOrder(client, orderId, { forUpdate: true });
      if (!current || current.status !== 'PROCESSING') return { result: null, webhookId: null };

      if (otp.trim() === TEST_OTP) {
        await addEvent(client, orderId, '3DS_PASSED', '3-D Secure authentication successful');
        const order = await this.approve(client, current, ['PROCESSING'], { save: current.saveCardRequested }, 'Approved after 3-D Secure');
        return { result: { order, attemptsLeft: 0 }, webhookId: await this.queueWebhook(client, order) };
      }

      const attempts = current.otpAttempts + 1;
      const attemptsLeft = Math.max(0, MAX_OTP_ATTEMPTS - attempts);
      await addEvent(client, orderId, '3DS_WRONG_OTP', `Wrong one-time password (attempt ${attempts}/${MAX_OTP_ATTEMPTS})`);
      if (attemptsLeft > 0) {
        const order = (await transition(client, orderId, ['PROCESSING'], { otp_attempts: attempts }))!;
        return { result: { order, attemptsLeft }, webhookId: null };
      }
      const order = (await transition(client, orderId, ['PROCESSING'], {
        otp_attempts: attempts,
        status: 'DECLINED',
        decline_code: '3DS_FAILED',
        decline_reason: DECLINE_REASONS['3DS_FAILED'],
      }))!;
      await addEvent(client, orderId, 'DECLINED', `Declined: 3DS_FAILED — ${MAX_OTP_ATTEMPTS} wrong one-time passwords`);
      return { result: { order, attemptsLeft: 0 }, webhookId: await this.queueWebhook(client, order) };
    });
    await this.send(webhookId, 'await');
    return result;
  }

  /** Cardholder cancelled the 3-D Secure challenge → authentication failed. */
  async abort3ds(orderId: string): Promise<OrderRow | null> {
    return this.finish(
      orderId,
      ['PROCESSING'],
      'DECLINED',
      { decline_code: '3DS_FAILED', decline_reason: 'Authentication cancelled by cardholder' },
      'Declined: 3DS_FAILED — authentication cancelled by cardholder',
      'await',
    );
  }

  // ---------------------------------------------------------------- expiry

  /** Expires one order if its time is up (used when the customer opens a stale checkout link). */
  async expireIfDue(order: OrderRow): Promise<OrderRow> {
    if ((order.status !== 'CREATED' && order.status !== 'PROCESSING') || new Date(order.expiresAt).getTime() > Date.now()) return order;
    const expired = await this.finish(order.id, ['CREATED', 'PROCESSING'], 'EXPIRED', {}, `Not paid within ${this.config.orderTtlMinutes} min — expired`, 'await');
    return expired ?? (await findOrder(this.db, order.id))!;
  }

  /** Scheduler tick: expires overdue unpaid orders and queues `order.expired` webhooks. */
  async expireDue(limit = 50): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT id FROM orders WHERE status IN ('CREATED','PROCESSING') AND expires_at <= now() ORDER BY expires_at LIMIT $1`,
      [limit],
    );
    let count = 0;
    for (const { id } of rows as { id: string }[]) {
      const order = await this.finish(id, ['CREATED', 'PROCESSING'], 'EXPIRED', {}, `Not paid within ${this.config.orderTtlMinutes} min — expired`, 'background', true);
      if (order) count++;
    }
    return count;
  }

  // ---------------------------------------------------------------- admin

  /** Re-sends the webhook for the order's current status (admin "Resend webhook"). */
  async resendWebhook(orderId: string): Promise<void> {
    const webhookId = await withTransaction(this.db, async (client) => {
      const order = await findOrder(client, orderId, { forUpdate: true });
      if (!order) throw orderNotFound();
      const event = eventForStatus(order.status);
      if (!event || !order.callbackUrl) throw new ApiError(409, 'NOTHING_TO_SEND', 'Order has no final status or no callbackUrl');
      await addEvent(client, orderId, 'WEBHOOK_RESEND', `Webhook ${event} re-sent manually`);
      return this.queueWebhook(client, order);
    });
    await this.send(webhookId, 'await');
  }

  async list(filter: OrderListFilter): Promise<{ items: OrderRow[]; total: number; page: number; pageSize: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.merchantId) {
      params.push(filter.merchantId);
      where.push(`merchant_id = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q.trim()}%`);
      where.push(`(id ILIKE $${params.length} OR merchant_order_id ILIKE $${params.length} OR card_mask ILIKE $${params.length})`);
    }
    const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
    const page = Math.max(filter.page ?? 1, 1);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ rows }, count] = await Promise.all([
      this.db.query(`SELECT * FROM orders ${whereSql} ORDER BY created_at DESC, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
      this.db.query(`SELECT count(*)::int AS n FROM orders ${whereSql}`, params),
    ]);
    return { items: rows.map((r) => mapRow<OrderRow>(r)), total: count.rows[0].n as number, page, pageSize };
  }

  async timeline(orderId: string) {
    const { rows } = await this.db.query('SELECT * FROM events WHERE order_id = $1 ORDER BY id', [orderId]);
    return rows.map((r) => mapRow<{ id: number; type: string; message: string; data: unknown; createdAt: Date }>(r));
  }

  async refunds(orderId: string) {
    return findRefunds(this.db, orderId);
  }

  // ---------------------------------------------------------------- internals

  private async findByMerchantOrderId(q: pg.PoolClient | Db, merchantId: string, merchantOrderId: string): Promise<OrderRow | null> {
    const { rows } = await q.query('SELECT * FROM orders WHERE merchant_id = $1 AND merchant_order_id = $2', [merchantId, merchantOrderId]);
    return rows[0] ? mapRow<OrderRow>(rows[0]) : null;
  }

  private async approve(
    client: pg.PoolClient,
    current: OrderRow,
    from: OrderStatus[],
    data: { save: boolean; card_mask?: string; card_brand?: string; card_holder?: string },
    message: string,
  ): Promise<OrderRow> {
    const { save, ...cardFields } = data;
    let token: string | null = null;
    if (save) {
      token = await this.tokens.create(client, {
        merchantId: current.merchantId,
        mask: cardFields.card_mask ?? current.cardMask ?? '',
        brand: cardFields.card_brand ?? current.cardBrand ?? 'UNKNOWN',
        customerId: current.customer?.id ?? null,
      });
    }
    const order = (await transition(client, current.id, from, {
      ...cardFields,
      status: 'APPROVED',
      card_token: token,
      decline_code: null,
      decline_reason: null,
      rrn: newRrn(),
      approval_code: newApprovalCode(),
      paid_at: NOW,
    }))!;
    await addEvent(client, order.id, 'APPROVED', `${message} — RRN ${order.rrn}, auth code ${order.approvalCode}`);
    if (token) await addEvent(client, order.id, 'TOKEN_CREATED', `Card saved as ${token}`);
    return order;
  }

  /** Generic final transition + timeline event + webhook. Returns null when the order was not in `from`. */
  private async finish(
    orderId: string,
    from: OrderStatus[],
    status: OrderStatus,
    patch: Record<string, unknown>,
    message: string,
    delivery: Delivery,
    skipLocked = false,
  ): Promise<OrderRow | null> {
    const { order, webhookId } = await withTransaction(this.db, async (client) => {
      if (skipLocked) {
        const lock = await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE SKIP LOCKED', [orderId]);
        if (!lock.rows[0]) return { order: null, webhookId: null };
      }
      const order = await transition(client, orderId, from, { ...patch, status });
      if (!order) return { order: null, webhookId: null };
      await addEvent(client, orderId, status, message);
      return { order, webhookId: await this.queueWebhook(client, order) };
    });
    await this.send(webhookId, delivery);
    return order;
  }

  private async queueWebhook(client: pg.PoolClient, order: OrderRow): Promise<string | null> {
    const event = eventForStatus(order.status);
    if (!event || !order.callbackUrl) return null;
    const json = toOrderJson(order, await findRefunds(client, order.id));
    return this.webhooks.enqueue(client, order.merchantId, order.callbackUrl, event, json);
  }

  private async send(webhookId: string | null, delivery: Delivery): Promise<void> {
    if (!webhookId) return;
    if (delivery === 'background') return this.webhooks.dispatch(webhookId);
    // A failing first attempt must never break the customer's flow; the scheduler retries it.
    await this.webhooks.deliverNow(webhookId).catch((err: unknown) => this.log.error('webhook delivery error', { webhookId, err: String(err) }));
  }
}
