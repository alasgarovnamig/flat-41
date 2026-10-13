import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, count, desc, eq, lt } from 'drizzle-orm';
import { formatMoney, type CheckoutResponse, type Currency, type Paginated, type Payment, type PaymentMethod, type PaymentPurpose } from '@evtap/shared';
import { config } from '../../config';
import { Database, InjectDb, Tx } from '../../db/db.module';
import { payments, walletTransactions } from '../../db/schema';
import { AppError, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { EVENTS, NotificationsService } from '../notifications/notifications.service';
import { PromotionsService } from '../promotions/promotions.service';
import { runEffects, withTx } from '../wallet/tx';
import { WalletService } from '../wallet/wallet.service';
import { ListingFulfilment } from './listing-fulfilment';
import { PaymentRow, toPaymentDto } from './payment.mapper';
import {
  PAID_STATUSES, PAYMENT_PROVIDER, PaymentProvider, ProviderError, ProviderOrder, UNPAID_FINAL_STATUSES,
} from './providers';

export type Effect = () => Promise<unknown>;

/** What a purpose handler hands back to the payment engine. */
export interface FulfilmentResult {
  /** Runs after the transaction committed (notifications, events). */
  after?: Effect;
  /** The goods can no longer be delivered (e.g. booking dates taken meanwhile) → the payment is refunded in full. */
  refundReason?: string;
}

/**
 * Per-purpose business logic plugged into the payment engine. Payments own WALLET_TOPUP / PROMOTION / LISTING_FEE /
 * VERIFICATION; subscriptions and bookings register theirs on startup (avoids circular module imports).
 * Every method runs inside the payment's transaction with the payment row locked.
 */
export interface PurposeHandler {
  fulfil(payment: PaymentRow, tx: Tx): Promise<FulfilmentResult | void>;
  onFailed?(payment: PaymentRow, tx: Tx): Promise<FulfilmentResult | void>;
  /** Admin refund: undo what was granted where it makes sense (may throw to abort the refund). */
  reverse?(payment: PaymentRow, amount: number, tx: Tx, ctx: { actorId?: string | null; reason?: string }): Promise<FulfilmentResult | void>;
}

export interface StartPaymentInput {
  userId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: number;
  currency?: Currency;
  description: string;
  items: { code: string; name: string; amount: number }[];
  metadata?: Record<string, unknown>;
  listingId?: string | null;
  bookingId?: string | null;
  /** Client return URL (validated). Default `${WEB_URL}/payment/result`. */
  returnUrl?: string;
  saveCard?: boolean;
  language?: 'az' | 'ru' | 'en';
  customer?: { phone?: string | null; email?: string | null };
  /** WALLET only: run debit + fulfilment inside the caller's transaction. The caller must then run `afterCommit()`. */
  tx?: Tx;
}

export interface StartedPayment { checkout: CheckoutResponse; payment: PaymentRow; afterCommit: () => Promise<void> }

export interface RefundInput {
  amount?: number;
  reason?: string;
  actorId?: string | null;
  /** Also undo the fulfilment (admin refunds). */
  reverse?: boolean;
  tx?: Tx;
  /** With `tx`: post-commit side effects are appended here instead of being run immediately. */
  effects?: Effect[];
}

const MIN = 60_000;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Allowed client return targets: our web/admin origins, CORS origins, the mobile scheme (and localhost in dev). */
export const isAllowedReturnUrl = (url: string) => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (['evtap:', 'exp:', 'exps:'].includes(u.protocol)) return true;
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const origins = [config.webUrl, config.adminUrl, config.apiPublicUrl, ...config.corsOrigins.filter((o) => o !== '*')]
    .map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (origins.includes(u.origin)) return true;
  return !config.isProd && ['localhost', '127.0.0.1'].includes(u.hostname);
};

/** Appends paymentId & status to the client return URL (works for https:// and evtap:// alike). */
export const buildClientReturn = (returnUrl: string | null, paymentId: string, status: string) => {
  const u = new URL(returnUrl || `${config.webUrl}/payment/result`);
  u.searchParams.set('paymentId', paymentId);
  u.searchParams.set('status', status);
  return u.toString();
};

/**
 * Payment engine: wallet & card payments, provider finalisation (webhook / return / reconciliation),
 * idempotent fulfilment (`payments.fulfilled_at` under a row lock) and refunds.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  private readonly handlers = new Map<string, PurposeHandler>();
  private reconciling = false;

  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
    private readonly wallet: WalletService,
    private readonly promotions: PromotionsService,
    private readonly listingFulfilment: ListingFulfilment,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {
    this.registerCoreHandlers();
  }

  registerHandler(purpose: PaymentPurpose, handler: PurposeHandler) {
    this.handlers.set(purpose, handler);
  }

  private handler(purpose: string): PurposeHandler {
    const h = this.handlers.get(purpose);
    if (!h) throw new Error(`No fulfilment handler registered for ${purpose}`);
    return h;
  }

  get callbackUrl() {
    return `${config.apiInternalUrl}/api/v1/payments/webhook/${this.provider.name}`;
  }

  resolveReturnUrl(url?: string) {
    if (!url) return `${config.webUrl}/payment/result`;
    if (!isAllowedReturnUrl(url)) throw new AppError('RETURN_URL_NOT_ALLOWED', 'returnUrl is not an allowed EvTap address');
    return url;
  }

  // ───────────────────────────── Start ─────────────────────────────

  async startPayment(input: StartPaymentInput): Promise<StartedPayment> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError('INVALID_AMOUNT', 'Amount must be a positive integer');
    const currency = input.currency ?? 'AZN';
    const returnUrl = this.resolveReturnUrl(input.returnUrl);
    const base = {
      userId: input.userId, purpose: input.purpose, method: input.method, amount: input.amount, currency, description: input.description,
      listingId: input.listingId ?? null, bookingId: input.bookingId ?? null, items: input.items, metadata: input.metadata ?? {}, returnUrl,
    };

    if (input.method === 'WALLET') {
      if (currency !== 'AZN') throw new AppError('CURRENCY_NOT_SUPPORTED', 'Wallet payments are only available in AZN');
      const effects: Effect[] = [];
      const payment = await withTx(this.db, input.tx, async (tx) => {
        const [p] = await tx.insert(payments).values({ ...base, status: 'PENDING' }).returning();
        await this.wallet.debit(input.userId, input.amount, input.description, { paymentId: p.id, bookingId: base.bookingId, tx });
        const now = new Date();
        const [paid] = await tx.update(payments).set({ status: 'SUCCEEDED', paidAt: now }).where(eq(payments.id, p.id)).returning();
        const r = (await this.handler(p.purpose).fulfil(paid, tx)) || {};
        if (r.refundReason) throw new AppError('FULFILMENT_FAILED', r.refundReason, HttpStatus.CONFLICT); // rolls back the debit too
        const [done] = await tx.update(payments).set({ fulfilledAt: now }).where(eq(payments.id, p.id)).returning();
        if (r.after) effects.push(r.after);
        effects.push(() => this.publish(done));
        return done;
      });
      const afterCommit = () => runEffects(effects, (e) => this.log.error(e));
      if (!input.tx) await afterCommit();
      return {
        checkout: { paymentId: payment.id, status: 'SUCCEEDED', amount: payment.amount, currency: payment.currency as Currency, paymentUrl: null },
        payment,
        afterCommit: input.tx ? afterCommit : async () => {},
      };
    }

    // CARD — the payment row must be committed before the bank can call our webhook.
    if (input.tx) throw new Error('Card payments cannot run inside an outer transaction');
    const [p] = await this.db.insert(payments).values({ ...base, status: 'PENDING', provider: this.provider.name }).returning();
    try {
      const order = await this.provider.createOrder({
        amount: p.amount, currency, merchantOrderId: p.id, description: p.description, language: input.language ?? 'az',
        returnUrl: `${config.apiPublicUrl}/api/v1/payments/return/${this.provider.name}?paymentId=${p.id}`,
        callbackUrl: this.callbackUrl, saveCard: input.saveCard || undefined,
        customer: { id: input.userId, phone: input.customer?.phone ?? undefined, email: input.customer?.email ?? undefined },
      });
      const [updated] = await this.db
        .update(payments)
        .set({ providerOrderId: order.orderId, providerData: { paymentUrl: order.paymentUrl, expiresAt: order.expiresAt, status: order.status } })
        .where(eq(payments.id, p.id))
        .returning();
      return {
        checkout: { paymentId: p.id, status: 'PENDING', amount: p.amount, currency: p.currency as Currency, paymentUrl: order.paymentUrl },
        payment: updated,
        afterCommit: async () => {},
      };
    } catch (e) {
      this.log.error(`createOrder failed for payment ${p.id}: ${(e as Error).message}`);
      await this.markFailed(p.id, 'Bank xidməti əlçatan deyil', { notify: false });
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Payment provider is unavailable, try again later', HttpStatus.BAD_GATEWAY);
    }
  }

  /** Merchant-initiated charge of a saved card (subscription renewals). Returns the finalised payment row. */
  async chargeSavedCard(input: Omit<StartPaymentInput, 'method' | 'tx' | 'returnUrl' | 'saveCard'> & { cardToken: string }): Promise<PaymentRow> {
    const currency = input.currency ?? 'AZN';
    const [p] = await this.db.insert(payments).values({
      userId: input.userId, purpose: input.purpose, method: 'CARD', amount: input.amount, currency, description: input.description,
      listingId: input.listingId ?? null, bookingId: input.bookingId ?? null, items: input.items, metadata: input.metadata ?? {},
      status: 'PENDING', provider: this.provider.name,
    }).returning();
    let order: ProviderOrder;
    try {
      order = await this.provider.chargeToken({ amount: p.amount, currency, merchantOrderId: p.id, description: p.description, cardToken: input.cardToken, callbackUrl: this.callbackUrl });
    } catch (e) {
      const body = (e as ProviderError).body as { error?: string; declineReason?: string } | undefined;
      return (await this.markFailed(p.id, body?.declineReason ?? body?.error ?? 'Kartdan ödəniş alınmadı')) ?? p;
    }
    return (await this.applyProviderOrder(order)) ?? p;
  }

  // ───────────────────────────── Finalise ─────────────────────────────

  /**
   * Applies a provider order state to our payment (webhook, return redirect, reconciliation, token charges).
   * Idempotent and race-safe: the payment row is locked and `fulfilledAt` guards fulfilment.
   */
  async applyProviderOrder(order: ProviderOrder): Promise<PaymentRow | null> {
    if (!isUuid(order.merchantOrderId)) return null;
    const effects: Effect[] = [];
    const result = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, order.merchantOrderId)).for('update');
      if (!p || p.method !== 'CARD' || p.provider !== this.provider.name) return null;
      if (p.providerOrderId && p.providerOrderId !== order.orderId) {
        this.log.warn(`Order ${order.orderId} does not belong to payment ${p.id} (expected ${p.providerOrderId})`);
        return p;
      }
      const providerData = { ...(p.providerData ?? {}), order: order.raw };
      const now = new Date();

      if (PAID_STATUSES.includes(order.status)) {
        if (order.amount !== p.amount || order.currency !== p.currency) {
          this.log.error(`Amount mismatch for payment ${p.id}: bank ${order.amount} ${order.currency}, ours ${p.amount} ${p.currency}`);
          if (p.fulfilledAt || !['PENDING', 'CREATED'].includes(p.status)) return p;
          return this.failInTx(tx, p, 'Məbləğ uyğunsuzluğu (AMOUNT_MISMATCH)', effects, { providerOrderId: order.orderId, providerData });
        }
        if (p.fulfilledAt) {
          // Already fulfilled. Only sync refunds performed on the bank side (bank admin → order.refunded webhook).
          if (order.refundedAmount > p.refundedAmount) {
            const status = order.refundedAmount >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            const [u] = await tx.update(payments).set({ refundedAmount: order.refundedAmount, status, providerData }).where(eq(payments.id, p.id)).returning();
            effects.push(() => this.publish(u, false));
            return u;
          }
          return p;
        }
        // PENDING → SUCCEEDED (also a late approval of a payment we had already marked FAILED / CANCELLED).
        const [paid] = await tx
          .update(payments)
          .set({
            status: 'SUCCEEDED', paidAt: order.paidAt ? new Date(order.paidAt) : now, providerOrderId: order.orderId, providerData,
            cardMask: order.card?.mask ?? p.cardMask, cardToken: order.card?.token ?? p.cardToken, failureReason: null,
          })
          .where(eq(payments.id, p.id))
          .returning();
        const r = (await this.handler(p.purpose).fulfil(paid, tx)) || {};
        const [done] = await tx.update(payments).set({ fulfilledAt: now }).where(eq(payments.id, p.id)).returning();
        if (r.after) effects.push(r.after);
        effects.push(() => this.publish(done));
        if (r.refundReason) effects.push(() => this.autoRefund(done.id, r.refundReason!));
        return done;
      }

      if (UNPAID_FINAL_STATUSES.includes(order.status)) {
        if (!['PENDING', 'CREATED'].includes(p.status)) return p;
        const reason = order.status === 'EXPIRED' ? 'Ödəniş müddəti bitdi' : order.status === 'CANCELLED' ? 'Ödəniş ləğv edildi' : (order.declineReason ?? order.declineCode ?? 'Bank ödənişi rədd etdi');
        return this.failInTx(tx, p, reason, effects, { providerOrderId: order.orderId, providerData, status: order.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED', declineCode: order.declineCode });
      }

      // CREATED / PROCESSING — remember the order id, nothing else to do yet.
      if (!p.providerOrderId) {
        const [u] = await tx.update(payments).set({ providerOrderId: order.orderId }).where(eq(payments.id, p.id)).returning();
        return u;
      }
      return p;
    });
    await runEffects(effects, (e) => this.log.error(e));
    return result;
  }

  private async failInTx(
    tx: Tx, p: PaymentRow, reason: string, effects: Effect[],
    extra: { providerOrderId?: string; providerData?: Record<string, unknown>; status?: 'FAILED' | 'CANCELLED'; declineCode?: string | null; notify?: boolean } = {},
  ) {
    const [failed] = await tx
      .update(payments)
      .set({
        status: extra.status ?? 'FAILED', failureReason: extra.declineCode ? `${reason} (${extra.declineCode})` : reason,
        ...(extra.providerOrderId ? { providerOrderId: extra.providerOrderId } : {}), ...(extra.providerData ? { providerData: extra.providerData } : {}),
      })
      .where(eq(payments.id, p.id))
      .returning();
    const r = (await this.handlers.get(p.purpose)?.onFailed?.(failed, tx)) || {};
    if (r.after) effects.push(r.after);
    effects.push(() => this.publish(failed, extra.notify ?? true));
    return failed;
  }

  /** PENDING → FAILED (provider unreachable, timeout). No-op for any other status. */
  async markFailed(paymentId: string, reason: string, opts: { notify?: boolean } = {}): Promise<PaymentRow | null> {
    const effects: Effect[] = [];
    const row = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p || !['PENDING', 'CREATED'].includes(p.status)) return p ?? null;
      return this.failInTx(tx, p, reason, effects, { notify: opts.notify });
    });
    await runEffects(effects, (e) => this.log.error(e));
    return row;
  }

  /** Bank return redirect: re-fetch the order (never trust query params), finalise, give back the payment. */
  async handleReturn(providerName: string, paymentId: string | undefined): Promise<PaymentRow | null> {
    if (!paymentId || !isUuid(paymentId) || providerName !== this.provider.name) return null;
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) return null;
    if (p.status === 'PENDING' && p.providerOrderId) {
      try {
        return (await this.applyProviderOrder(await this.provider.getOrder(p.providerOrderId))) ?? p;
      } catch (e) {
        this.log.warn(`Return: could not fetch order ${p.providerOrderId}: ${(e as Error).message}`);
      }
    }
    return p;
  }

  /** Cron (10 min): PENDING card payments older than 15 min → ask the bank; no answer for 24 h → FAILED. */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'payments-reconciliation' })
  async reconcile(now = new Date()) {
    if (this.reconciling) return 0;
    this.reconciling = true;
    let touched = 0;
    try {
      const stale = await this.db
        .select()
        .from(payments)
        .where(and(eq(payments.status, 'PENDING'), eq(payments.method, 'CARD'), lt(payments.createdAt, new Date(now.getTime() - 15 * MIN))))
        .orderBy(asc(payments.createdAt))
        .limit(200);
      for (const p of stale) {
        const dead = p.createdAt.getTime() < now.getTime() - 24 * 60 * MIN;
        let updated: PaymentRow | null = null;
        if (p.providerOrderId && p.provider === this.provider.name) {
          try {
            updated = await this.applyProviderOrder(await this.provider.getOrder(p.providerOrderId));
          } catch (e) {
            this.log.warn(`Reconcile ${p.id}: ${(e as Error).message}`);
          }
        }
        if ((!updated || updated.status === 'PENDING') && dead) updated = await this.markFailed(p.id, 'Bankdan cavab alınmadı');
        if (updated && updated.status !== 'PENDING') touched++;
      }
      return touched;
    } finally {
      this.reconciling = false;
    }
  }

  // ───────────────────────────── Refunds ─────────────────────────────

  /**
   * Refunds (part of) a payment to its original method: card → provider refund API, wallet → REFUND credit
   * (the bonus share goes back to the bonus balance). `reverse` also undoes the fulfilment (admin refunds).
   */
  async refund(paymentId: string, input: RefundInput = {}): Promise<PaymentRow> {
    const effects: Effect[] = [];
    const row = await withTx(this.db, input.tx, async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p) throw notFound('Payment');
      if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw new AppError('NOT_REFUNDABLE', `Payment in status ${p.status} cannot be refunded`, HttpStatus.CONFLICT);
      const remaining = p.amount - p.refundedAmount;
      const amount = input.amount ?? remaining;
      if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) throw new AppError('REFUND_AMOUNT_INVALID', `Refund amount must be between 1 and ${remaining}`);
      const reason = input.reason ?? 'Geri qaytarma';

      if (input.reverse) {
        const r = (await this.handlers.get(p.purpose)?.reverse?.(p, amount, tx, { actorId: input.actorId, reason })) || {};
        if (r.after) effects.push(r.after);
      }

      let providerData = p.providerData;
      if (p.method === 'CARD') {
        if (!p.providerOrderId) throw new AppError('NOT_REFUNDABLE', 'Payment has no bank order', HttpStatus.CONFLICT);
        try {
          const order = await this.provider.refund(p.providerOrderId, amount, reason);
          providerData = { ...(p.providerData ?? {}), order: order.raw };
        } catch (e) {
          const err = e as ProviderError;
          if (err.status === 409) throw new AppError('REFUND_REJECTED', 'The bank rejected the refund', HttpStatus.CONFLICT);
          throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', `Refund failed: ${err.message}`, HttpStatus.BAD_GATEWAY);
        }
      } else {
        // Give the bonus part back as bonus (bonus money is never converted into real money).
        const [spent] = await tx
          .select({ bonus: walletTransactions.bonusAmount })
          .from(walletTransactions)
          .where(and(eq(walletTransactions.paymentId, p.id), eq(walletTransactions.type, 'SPEND')));
        const spentBonus = Math.abs(spent?.bonus ?? 0);
        const bonusAmount = Math.min(amount, Math.floor((amount * spentBonus) / p.amount));
        await this.wallet.credit(p.userId, amount, 'REFUND', `Geri qaytarma: ${p.description}`, { bonusAmount, paymentId: p.id, bookingId: p.bookingId, actorId: input.actorId, tx });
      }

      const refundedAmount = p.refundedAmount + amount;
      const refunds = [...((p.metadata.refunds as unknown[]) ?? []), { amount, reason, actorId: input.actorId ?? null, at: new Date().toISOString() }];
      const [u] = await tx
        .update(payments)
        .set({ refundedAmount, status: refundedAmount >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED', providerData, metadata: { ...p.metadata, refunds } })
        .where(eq(payments.id, p.id))
        .returning();
      effects.push(() => this.publish(u, false));
      effects.push(() =>
        this.notifications.notify(u.userId, 'SYSTEM', 'Vəsait geri qaytarıldı',
          `${u.description}: ${formatMoney(amount, u.currency as Currency)} ${u.method === 'CARD' ? 'kartınıza' : 'balansınıza'} qaytarıldı.`, { paymentId: u.id, amount }),
      );
      return u;
    });
    // Inside a caller's transaction the caller runs the effects after its commit.
    if (input.effects) input.effects.push(...effects);
    else await runEffects(effects, (e) => this.log.error(e));
    return row;
  }

  private async autoRefund(paymentId: string, reason: string) {
    try {
      await this.refund(paymentId, { reason });
    } catch (e) {
      this.log.error(`Automatic refund of ${paymentId} failed (${reason}): ${(e as Error).message}`);
    }
  }

  // ───────────────────────────── Queries ─────────────────────────────

  async list(userId: string, page: number, pageSize: number): Promise<Paginated<Payment>> {
    const where = eq(payments.userId, userId);
    const rows = await this.db.select().from(payments).where(where).orderBy(desc(payments.createdAt)).limit(pageSize).offset(pageArgs(page, pageSize).offset);
    const [{ total }] = await this.db.select({ total: count() }).from(payments).where(where);
    return paginated(rows.map(toPaymentDto), total, page, pageSize);
  }

  async getOwn(userId: string, id: string): Promise<Payment> {
    const [p] = await this.db.select().from(payments).where(and(eq(payments.id, id), eq(payments.userId, userId)));
    if (!p) throw notFound('Payment');
    return toPaymentDto(p);
  }

  async getRow(id: string) {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, id));
    return p ?? null;
  }

  // ───────────────────────────── Side effects ─────────────────────────────

  /** Socket event + (optionally) PAYMENT_SUCCEEDED / PAYMENT_FAILED notification. */
  private async publish(p: PaymentRow, notify = true) {
    this.events.emit(EVENTS.paymentUpdated, { userId: p.userId, payment: toPaymentDto(p) });
    if (!notify) return;
    const data = { paymentId: p.id, purpose: p.purpose, listingId: p.listingId, bookingId: p.bookingId };
    if (p.status === 'SUCCEEDED') {
      await this.notifications.notify(p.userId, 'PAYMENT_SUCCEEDED', 'Ödəniş uğurla tamamlandı', `${p.description} — ${formatMoney(p.amount, p.currency as Currency)}`, data);
    } else if (p.status === 'FAILED' || p.status === 'CANCELLED') {
      await this.notifications.notify(p.userId, 'PAYMENT_FAILED', p.status === 'CANCELLED' ? 'Ödəniş ləğv edildi' : 'Ödəniş alınmadı', `${p.description}: ${p.failureReason ?? 'ödəniş tamamlanmadı'}`, data);
    }
  }

  // ───────────────────────────── Core purpose handlers ─────────────────────────────

  private registerCoreHandlers() {
    this.registerHandler('WALLET_TOPUP', {
      fulfil: async (p, tx) => {
        await this.wallet.credit(p.userId, p.amount, 'TOPUP', 'Balansın artırılması (kart)', { paymentId: p.id, tx });
        const bonus = Number(p.metadata.bonus ?? 0);
        if (bonus > 0) await this.wallet.credit(p.userId, bonus, 'BONUS', 'Balans artırma bonusu', { paymentId: p.id, tx });
      },
      // Refunding a top-up takes the money back out of the wallet (fails with INSUFFICIENT_FUNDS if already spent)
      // and revokes the proportional part of the bonus.
      reverse: async (p, amount, tx, ctx) => {
        await this.wallet.debit(p.userId, amount, 'Balans artırılmasının geri qaytarılması', { type: 'REFUND', source: 'REAL_ONLY', paymentId: p.id, actorId: ctx.actorId, tx });
        const bonus = Math.floor((Number(p.metadata.bonus ?? 0) * amount) / p.amount);
        await this.wallet.revokeBonus(p.userId, bonus, 'Bonusun ləğvi (geri qaytarma)', { paymentId: p.id, actorId: ctx.actorId, tx });
      },
    });

    this.registerHandler('PROMOTION', {
      fulfil: async (p, tx) => {
        if (!p.listingId) return { refundReason: 'Elan artıq mövcud deyil' };
        for (const code of (p.metadata.serviceCodes as string[]) ?? []) await this.promotions.apply(p.listingId, code, 'PAYMENT', p.id, tx);
      },
      // Promotions already shown are not revoked on refund (goodwill / partial compensation); money only.
    });

    this.registerHandler('LISTING_FEE', {
      fulfil: async (p, tx) => {
        if (!p.listingId || !(await this.listingFulfilment.markListingFeePaid(p.listingId, tx))) return { refundReason: 'Elan artıq mövcud deyil' };
      },
    });

    this.registerHandler('VERIFICATION', {
      fulfil: async (p, tx) => {
        if (!p.listingId || !(await this.listingFulfilment.markVerified(p.listingId, true, tx))) return { refundReason: 'Elan artıq mövcud deyil' };
      },
      reverse: async (p, amount, tx) => {
        if (p.listingId && p.refundedAmount + amount >= p.amount) await this.listingFulfilment.markVerified(p.listingId, false, tx);
      },
    });
  }

}
