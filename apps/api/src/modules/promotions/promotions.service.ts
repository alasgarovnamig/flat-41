import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, gt, isNotNull, lt, lte, or } from 'drizzle-orm';
import type { PromotionType } from '@evtap/shared';
import { Database, InjectDb, Tx } from '../../db/db.module';
import { listingPromotions, listings, subscriptions, users } from '../../db/schema';
import { AppError, forbidden, notFound } from '../../common/errors';
import { addDays } from '../../common/util';
import { NotificationsService } from '../notifications/notifications.service';
import { QuotaService, SettingsService } from '../settings/settings.service';
import { runEffects, withTx } from '../wallet/tx';
import { toMyListing } from './listing-view';

export type PromotionSource = 'PAYMENT' | 'CREDIT' | 'ADMIN';

/** Listing column that holds the "active until" timestamp of each timed promotion type. */
export const UNTIL_COLUMN = {
  AUTO_BUMP: 'autoBumpUntil',
  VIP: 'vipUntil',
  PREMIUM: 'premiumUntil',
  HIGHLIGHT: 'highlightUntil',
  URGENT: 'urgentUntil',
} as const satisfies Partial<Record<PromotionType, keyof typeof listings.$inferSelect>>;

const PROMO_NAME_AZ: Record<keyof typeof UNTIL_COLUMN, string> = {
  AUTO_BUMP: 'Avto-qaldırma', VIP: 'VIP', PREMIUM: 'Premium', HIGHLIGHT: 'Rəngli fon', URGENT: '"Təcili" nişanı',
};

/** Stacking rule: a new period starts at max(now, current end). Pure — exported for tests. */
export const extendUntil = (current: Date | null, days: number, now = new Date()) => addDays(current && current > now ? current : now, days);

/** Subscription credit → catalog service applied with it. */
export const CREDIT_SERVICE = { BUMP: 'BUMP_1', VIP_7: 'VIP_7', PREMIUM_7: 'PREMIUM_7' } as const;
export type CreditKind = keyof typeof CREDIT_SERVICE;
const CREDIT_COLUMN = { BUMP: 'bumpsLeft', VIP_7: 'vipCreditsLeft', PREMIUM_7: 'premiumCreditsLeft' } as const;

@Injectable()
export class PromotionsService {
  private readonly log = new Logger(PromotionsService.name);
  private running = { expire: false, autoBump: false };

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly quota: QuotaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Applies a catalog service to a listing (locks the listing row).
   * BUMP → bumpedAt = now · AUTO_BUMP → autoBumpUntil extended + immediate bump ·
   * VIP / PREMIUM / HIGHLIGHT / URGENT → *Until = max(now, current) + durationDays (purchases stack).
   */
  async apply(listingId: string, serviceCode: string, source: PromotionSource, paymentId?: string, tx?: Tx): Promise<void> {
    const service = await this.settings.getService(serviceCode); // inactive services still apply (already paid)
    if (!service?.promotionType) throw new AppError('INVALID_SERVICE', `Service ${serviceCode} is not a listing promotion`);
    const type = service.promotionType;
    await withTx(this.db, tx, async (t) => {
      const [l] = await t.select().from(listings).where(eq(listings.id, listingId)).for('update');
      if (!l) throw notFound('Listing');
      const now = new Date();
      let endsAt: Date | null = null;
      const patch: Partial<typeof listings.$inferInsert> = {};
      if (type === 'BUMP') {
        patch.bumpedAt = now;
      } else {
        const col = UNTIL_COLUMN[type];
        endsAt = extendUntil(l[col], service.durationDays, now);
        patch[col] = endsAt;
        if (type === 'AUTO_BUMP') patch.bumpedAt = now;
      }
      await t.update(listings).set(patch).where(eq(listings.id, listingId));
      await t.insert(listingPromotions).values({ listingId, type, serviceCode, startsAt: now, endsAt, paymentId: paymentId ?? null, source });
    });
  }

  /** POST /listings/:id/apply-credit — spends one subscription credit of the owner (or their agency). */
  async applyCredit(userId: string, listingId: string, credit: CreditKind) {
    const [l] = await this.db.select().from(listings).where(eq(listings.id, listingId));
    if (!l) throw notFound('Listing');
    if (l.ownerId !== userId) throw forbidden('Not your listing');
    if (!['ACTIVE', 'PENDING'].includes(l.status)) throw new AppError('LISTING_NOT_ACTIVE', 'Only active or pending listings can be promoted', HttpStatus.CONFLICT);
    const [u] = await this.db.select({ agencyId: users.agencyId }).from(users).where(eq(users.id, userId));
    const sub = await this.quota.getActiveSubscription(userId, u?.agencyId ?? null);
    if (!sub) throw new AppError('NO_SUBSCRIPTION', 'An active business subscription is required', HttpStatus.PAYMENT_REQUIRED);
    const col = CREDIT_COLUMN[credit];
    await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.id, sub.id)).for('update');
      if (!s || s[col] <= 0) throw new AppError('NO_CREDITS', 'No credits left for this period', HttpStatus.PAYMENT_REQUIRED);
      await tx.update(subscriptions).set({ [col]: s[col] - 1 }).where(eq(subscriptions.id, s.id));
      await this.apply(listingId, CREDIT_SERVICE[credit], 'CREDIT', undefined, tx);
    });
    const [fresh] = await this.db.select().from(listings).where(eq(listings.id, listingId));
    return toMyListing(this.db, fresh);
  }

  /** Cron (10 min): clears past *Until columns and notifies the owner once (the column is nulled, so never twice). */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'promotions-expiry' })
  async expirePromotions(now = new Date()) {
    if (this.running.expire) return 0;
    this.running.expire = true;
    try {
      const expiredAny = or(...Object.values(UNTIL_COLUMN).map((c) => and(isNotNull(listings[c]), lte(listings[c], now))));
      const candidates = await this.db.select({ id: listings.id }).from(listings).where(expiredAny).limit(1000);
      const effects: Array<() => Promise<unknown>> = [];
      for (const { id } of candidates) {
        await this.db.transaction(async (tx) => {
          const [l] = await tx.select().from(listings).where(eq(listings.id, id)).for('update', { skipLocked: true });
          if (!l) return;
          const patch: Partial<typeof listings.$inferInsert> = {};
          const expired: string[] = [];
          for (const [type, col] of Object.entries(UNTIL_COLUMN) as [keyof typeof UNTIL_COLUMN, (typeof UNTIL_COLUMN)[keyof typeof UNTIL_COLUMN]][]) {
            if (l[col] && l[col]! <= now) {
              patch[col] = null;
              expired.push(PROMO_NAME_AZ[type]);
            }
          }
          if (!expired.length) return;
          await tx.update(listings).set(patch).where(eq(listings.id, id));
          effects.push(() =>
            this.notifications.notify(l.ownerId, 'PROMOTION_EXPIRED', 'Reklam xidmətinin müddəti bitdi',
              `"${l.title}" elanı üçün ${expired.join(', ')} xidmətinin müddəti başa çatdı. Elanınızı yenidən irəli çəkə bilərsiniz.`, { listingId: id }),
          );
        });
      }
      await runEffects(effects, (e) => this.log.error(e));
      return effects.length;
    } finally {
      this.running.expire = false;
    }
  }

  /** Cron (hourly): AUTO_BUMP — bump active listings once every 24 h while autoBumpUntil is in the future. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'promotions-auto-bump' })
  async autoBump(now = new Date()) {
    if (this.running.autoBump) return 0;
    this.running.autoBump = true;
    try {
      const rows = await this.db
        .update(listings)
        .set({ bumpedAt: now })
        .where(and(eq(listings.status, 'ACTIVE'), gt(listings.autoBumpUntil, now), lt(listings.bumpedAt, new Date(now.getTime() - 24 * 3_600_000 + 60_000))))
        .returning({ id: listings.id });
      return rows.length;
    } finally {
      this.running.autoBump = false;
    }
  }
}
