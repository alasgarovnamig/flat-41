import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, count, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { planPrice, type BillingPeriod, type PlanDef, type Subscription } from '@evtap/shared';
import { Database, InjectDb, Tx } from '../../db/db.module';
import { agencies, subscriptions, users } from '../../db/schema';
import { AppError, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';
import { NotificationsService } from '../notifications/notifications.service';
import type { PaymentRow } from '../payments/payment.mapper';
import { PaymentsService } from '../payments/payments.service';
import { QuotaService, SettingsService } from '../settings/settings.service';
import { runEffects } from '../wallet/tx';

type SubRow = typeof subscriptions.$inferSelect;

export const MAX_RENEWAL_ATTEMPTS = 3;
const DAY = 86_400_000;

/** Calendar-aware period arithmetic (Jan 31 + 1 month → Feb 28/29). Pure — exported for tests. */
export const addPeriod = (d: Date, period: BillingPeriod, n = 1) => {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + (period === 'YEAR' ? 12 * n : n));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
};

const credits = (plan: PlanDef | null) => ({
  bumpsLeft: plan?.monthlyBumps ?? 0, vipCreditsLeft: plan?.monthlyVipCredits ?? 0, premiumCreditsLeft: plan?.monthlyPremiumCredits ?? 0,
});

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class SubscriptionsService {
  private readonly log = new Logger(SubscriptionsService.name);
  private running = false;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly quota: QuotaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {
    this.payments.registerHandler('SUBSCRIPTION', {
      fulfil: (p, tx) => this.fulfil(p, tx),
      reverse: async (p, amount, tx) => {
        // Full refund of the payment that paid the current period → the subscription ends now.
        if (p.refundedAmount + amount < p.amount) return;
        await tx.update(subscriptions).set({ status: 'EXPIRED', autoRenew: false, currentPeriodEnd: new Date() }).where(and(eq(subscriptions.lastPaymentId, p.id), inArray(subscriptions.status, ['ACTIVE', 'CANCELLED', 'PAST_DUE'])));
      },
    });
  }

  // ───────────────────────────── Fulfilment ─────────────────────────────

  /** SUBSCRIPTION paid: renew / extend / create the subscription, grant plan credits, user becomes BUSINESS. */
  private async fulfil(p: PaymentRow, tx: Tx) {
    const meta = p.metadata as { planCode: string; period: BillingPeriod; autoRenew?: boolean; renewal?: boolean; subscriptionId?: string };
    const plan = await this.settings.getPlan(meta.planCode);
    const now = new Date();
    const [user] = await tx.select().from(users).where(eq(users.id, p.userId));
    const card = p.method === 'CARD' && p.cardToken ? { cardToken: p.cardToken, cardMask: p.cardMask } : {};

    if (meta.renewal && meta.subscriptionId) {
      const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.id, meta.subscriptionId)).for('update');
      if (!s) return { refundReason: 'Abunəlik tapılmadı' };
      if (s.lastPaymentId === p.id) return; // already applied
      const start = s.status === 'PAST_DUE' || s.currentPeriodEnd < new Date(now.getTime() - DAY) ? now : s.currentPeriodEnd;
      const end = addPeriod(start, meta.period);
      await tx.update(subscriptions).set({
        status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end, ...credits(plan), creditsResetAt: start,
        renewalAttempts: 0, lastRenewalAttemptAt: null, lastPaymentId: p.id, ...card,
      }).where(eq(subscriptions.id, s.id));
      return {
        after: () => this.notifications.notify(p.userId, 'SUBSCRIPTION_RENEWED', 'Abunəlik yeniləndi',
          `${plan?.name.az ?? meta.planCode} planı ${fmtDate(end)} tarixinədək uzadıldı.`, { subscriptionId: s.id }),
      };
    }

    const [existing] = await tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, p.userId), inArray(subscriptions.status, ['ACTIVE', 'CANCELLED', 'PAST_DUE'])))
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1)
      .for('update');
    const autoRenew = meta.autoRenew ?? true;
    const status = autoRenew ? 'ACTIVE' : 'CANCELLED';

    if (existing && existing.planCode === meta.planCode && existing.period === meta.period && existing.status !== 'PAST_DUE' && existing.currentPeriodEnd > now) {
      // Same plan bought again → extend the period and add one period of credits.
      const end = addPeriod(existing.currentPeriodEnd, meta.period);
      const c = credits(plan);
      await tx.update(subscriptions).set({
        status, autoRenew, currentPeriodEnd: end, lastPaymentId: p.id, ...card,
        bumpsLeft: existing.bumpsLeft + c.bumpsLeft, vipCreditsLeft: existing.vipCreditsLeft + c.vipCreditsLeft, premiumCreditsLeft: existing.premiumCreditsLeft + c.premiumCreditsLeft,
      }).where(eq(subscriptions.id, existing.id));
    } else {
      // New plan (or plan change): the previous subscription ends now (no proration in the MVP).
      if (existing) await tx.update(subscriptions).set({ status: 'EXPIRED', autoRenew: false, currentPeriodEnd: now }).where(eq(subscriptions.id, existing.id));
      await tx.insert(subscriptions).values({
        userId: p.userId, agencyId: user?.agencyId ?? null, planCode: meta.planCode, period: meta.period, status, autoRenew,
        currentPeriodStart: now, currentPeriodEnd: addPeriod(now, meta.period), ...credits(plan), creditsResetAt: now,
        cardToken: card.cardToken ?? null, cardMask: card.cardMask ?? null, lastPaymentId: p.id,
      });
    }
    await tx.update(users).set({ accountType: 'BUSINESS' }).where(eq(users.id, p.userId));
  }

  // ───────────────────────────── User endpoints ─────────────────────────────

  private async current(userId: string): Promise<SubRow | null> {
    const [s] = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ['ACTIVE', 'CANCELLED', 'PAST_DUE'])))
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1);
    return s ?? null;
  }

  /** Own subscription, or the agency's one for agency members. */
  async me(userId: string): Promise<Subscription | null> {
    let s = await this.current(userId);
    if (!s) {
      const [u] = await this.db.select({ agencyId: users.agencyId }).from(users).where(eq(users.id, userId));
      s = u?.agencyId ? await this.quota.getActiveSubscription(userId, u.agencyId) : null;
    }
    return s ? this.quota.toSubscriptionDto(s) : null;
  }

  async cancel(userId: string): Promise<Subscription> {
    const s = await this.current(userId);
    if (!s) throw notFound('Subscription');
    const [u] = await this.db.update(subscriptions).set({ autoRenew: false, status: s.status === 'ACTIVE' ? 'CANCELLED' : s.status }).where(eq(subscriptions.id, s.id)).returning();
    return this.quota.toSubscriptionDto(u);
  }

  async resume(userId: string): Promise<Subscription> {
    const s = await this.current(userId);
    if (!s) throw notFound('Subscription');
    if (s.status === 'CANCELLED' && s.currentPeriodEnd <= new Date()) throw new AppError('SUBSCRIPTION_ENDED', 'Subscription period has ended', HttpStatus.CONFLICT);
    const [u] = await this.db.update(subscriptions).set({ autoRenew: true, status: s.status === 'CANCELLED' ? 'ACTIVE' : s.status }).where(eq(subscriptions.id, s.id)).returning();
    return this.quota.toSubscriptionDto(u);
  }

  async adminList(status: string | undefined, page: number, pageSize: number) {
    const where = status ? eq(subscriptions.status, status) : undefined;
    const rows = await this.db
      .select({ s: subscriptions, user: { id: users.id, name: users.name, phone: users.phone, email: users.email }, agency: agencies })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .leftJoin(agencies, eq(agencies.id, subscriptions.agencyId))
      .where(where)
      .orderBy(desc(subscriptions.createdAt))
      .limit(pageSize)
      .offset(pageArgs(page, pageSize).offset);
    const [{ total }] = await this.db.select({ total: count() }).from(subscriptions).where(where);
    const items = await Promise.all(rows.map(async (r) => ({
      ...(await this.quota.toSubscriptionDto(r.s)),
      user: r.user,
      agency: r.agency ? { id: r.agency.id, name: r.agency.name, slug: r.agency.slug, logoUrl: r.agency.logoUrl, type: r.agency.type, verified: r.agency.verified } : null,
      renewalAttempts: r.s.renewalAttempts,
      createdAt: iso(r.s.createdAt),
    })));
    return paginated(items, total, page, pageSize);
  }

  // ───────────────────────────── Cron ─────────────────────────────

  /**
   * Hourly: (1) non-renewing subscriptions past their end → EXPIRED; (2) auto-renew at period end — saved card token
   * (or wallet when no token) → extend + reset credits + SUBSCRIPTION_RENEWED; failure → PAST_DUE, retried once a day,
   * EXPIRED after 3 failed attempts; (3) yearly plans get their monthly credits reset every month.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'subscriptions-renewal' })
  async processRenewals(now = new Date()) {
    if (this.running) return { expired: 0, renewed: 0, failed: 0 };
    this.running = true;
    const stats = { expired: 0, renewed: 0, failed: 0 };
    try {
      const ended = await this.db
        .update(subscriptions)
        .set({ status: 'EXPIRED' })
        .where(and(inArray(subscriptions.status, ['ACTIVE', 'CANCELLED', 'PAST_DUE']), eq(subscriptions.autoRenew, false), lte(subscriptions.currentPeriodEnd, now)))
        .returning();
      for (const s of ended) {
        stats.expired++;
        await this.onExpired(s);
      }

      const due = await this.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(
          inArray(subscriptions.status, ['ACTIVE', 'PAST_DUE']), eq(subscriptions.autoRenew, true), lte(subscriptions.currentPeriodEnd, now),
          or(isNull(subscriptions.lastRenewalAttemptAt), lte(subscriptions.lastRenewalAttemptAt, new Date(now.getTime() - DAY + 5 * 60_000))),
        ))
        .limit(500);
      for (const { id } of due) {
        const r = await this.renew(id, now);
        if (r === 'RENEWED') stats.renewed++;
        else if (r) stats.failed++;
      }

      const yearly = await this.db
        .select()
        .from(subscriptions)
        .where(and(inArray(subscriptions.status, ['ACTIVE', 'CANCELLED']), eq(subscriptions.period, 'YEAR'), gt(subscriptions.currentPeriodEnd, now)));
      for (const s of yearly) {
        const last = s.creditsResetAt ?? s.currentPeriodStart;
        if (addPeriod(last, 'MONTH') > now) continue;
        const plan = await this.settings.getPlan(s.planCode);
        await this.db.update(subscriptions).set({ ...credits(plan), creditsResetAt: addPeriod(last, 'MONTH') }).where(eq(subscriptions.id, s.id));
      }
      return stats;
    } finally {
      this.running = false;
    }
  }

  /** One renewal attempt. Returns RENEWED / PAST_DUE / EXPIRED, or null when the subscription was not due. */
  async renew(subscriptionId: string, now = new Date()): Promise<'RENEWED' | 'PAST_DUE' | 'EXPIRED' | null> {
    // Claim the attempt (row lock, skip if another worker holds it).
    const s = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for('update', { skipLocked: true });
      if (!row || !['ACTIVE', 'PAST_DUE'].includes(row.status) || !row.autoRenew || row.currentPeriodEnd > now) return null;
      const [claimed] = await tx.update(subscriptions).set({ lastRenewalAttemptAt: now, renewalAttempts: row.renewalAttempts + 1 }).where(eq(subscriptions.id, row.id)).returning();
      return claimed;
    });
    if (!s) return null;

    const plan = await this.settings.getPlan(s.planCode);
    let failure = 'Plan artıq mövcud deyil';
    if (plan?.active) {
      const amount = planPrice(plan, s.period as BillingPeriod);
      const description = `${plan.name.az} abunəliyinin yenilənməsi`;
      const base = {
        userId: s.userId, purpose: 'SUBSCRIPTION' as const, amount, description, items: [{ code: `${plan.code}_${s.period}`, name: description, amount }],
        metadata: { planCode: plan.code, period: s.period, autoRenew: true, renewal: true, subscriptionId: s.id },
      };
      try {
        if (s.cardToken) {
          const p = await this.payments.chargeSavedCard({ ...base, cardToken: s.cardToken });
          if (p.status === 'SUCCEEDED') return 'RENEWED';
          failure = p.failureReason ?? 'Kartdan ödəniş alınmadı';
        } else {
          await this.payments.startPayment({ ...base, method: 'WALLET' });
          return 'RENEWED';
        }
      } catch (e) {
        const code = e instanceof AppError ? (e.getResponse() as { code?: string }).code : undefined;
        failure = code === 'INSUFFICIENT_FUNDS' ? 'Balansda kifayət qədər vəsait yoxdur' : (e as Error).message;
        if (!s.cardToken) {
          await this.notifications.notify(s.userId, 'PAYMENT_FAILED', 'Abunəlik yenilənmədi', `${description}: ${failure}. Balansınızı artırın.`, { subscriptionId: s.id });
        }
      }
    }

    const expire = s.renewalAttempts >= MAX_RENEWAL_ATTEMPTS || !plan?.active;
    const [u] = await this.db
      .update(subscriptions)
      .set({ status: expire ? 'EXPIRED' : 'PAST_DUE' })
      .where(and(eq(subscriptions.id, s.id), inArray(subscriptions.status, ['ACTIVE', 'PAST_DUE']), lte(subscriptions.currentPeriodEnd, now)))
      .returning();
    this.log.warn(`Renewal of ${s.id} failed (attempt ${s.renewalAttempts}): ${failure}`);
    if (u && expire) await this.onExpired(u);
    return u ? (expire ? 'EXPIRED' : 'PAST_DUE') : null;
  }

  private async onExpired(s: SubRow) {
    await runEffects([
      () => this.notifications.notify(s.userId, 'SUBSCRIPTION_EXPIRED', 'Abunəliyin müddəti bitdi',
        'Biznes abunəliyinizin müddəti başa çatdı. Üstünlüklərdən istifadəni davam etdirmək üçün abunəliyi yeniləyin.', { subscriptionId: s.id }),
      async () => {
        // Back to INDIVIDUAL unless the user still has another active subscription or belongs to an agency.
        const [u] = await this.db.select({ agencyId: users.agencyId }).from(users).where(eq(users.id, s.userId));
        if (u?.agencyId) return;
        if (await this.quota.getActiveSubscription(s.userId, null)) return;
        await this.db.update(users).set({ accountType: 'INDIVIDUAL' }).where(eq(users.id, s.userId));
      },
    ], (e) => this.log.error(e));
  }
}
