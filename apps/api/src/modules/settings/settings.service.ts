import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  BUNDLES, DEFAULT_SETTINGS, PLANS, SERVICE_CATALOG,
  type Catalog, type ListingQuota, type PlanDef, type PlatformSettings, type ServiceDef, type Subscription,
} from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { listings, plans, services, settings, subscriptions } from '../../db/schema';
import { iso } from '../../common/util';

const KEY = 'platform';

/**
 * Platform settings + monetization catalog (services, bundles, plans) stored in DB,
 * seeded from @evtap/shared defaults. Cached in memory for 30s.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: { at: number; settings: PlatformSettings; services: ServiceDef[]; plans: PlanDef[] } | null = null;
  constructor(@InjectDb() private readonly db: Database) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  /** Inserts default settings / services / plans when missing (idempotent). */
  async ensureDefaults() {
    await this.db.insert(settings).values({ key: KEY, value: DEFAULT_SETTINGS }).onConflictDoNothing();
    for (const s of SERVICE_CATALOG) {
      await this.db.insert(services).values({ ...s }).onConflictDoNothing();
    }
    for (const p of PLANS) {
      await this.db.insert(plans).values({ ...p }).onConflictDoNothing();
    }
  }

  invalidate() {
    this.cache = null;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache;
    const [row] = await this.db.select().from(settings).where(eq(settings.key, KEY));
    const svc = await this.db.select().from(services).orderBy(asc(services.sortOrder));
    const pl = await this.db.select().from(plans).orderBy(asc(plans.priceMonthly));
    this.cache = {
      at: Date.now(),
      settings: { ...DEFAULT_SETTINGS, ...((row?.value as Partial<PlatformSettings>) ?? {}) },
      services: svc.map((s) => ({ code: s.code, promotionType: s.promotionType as ServiceDef['promotionType'], durationDays: s.durationDays, price: s.price, active: s.active, sortOrder: s.sortOrder, name: s.name, description: s.description })),
      plans: pl.map((p) => ({
        code: p.code as PlanDef['code'], priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, listingQuota: p.listingQuota, monthlyBumps: p.monthlyBumps,
        monthlyVipCredits: p.monthlyVipCredits, monthlyPremiumCredits: p.monthlyPremiumCredits, maxAgents: p.maxAgents, features: p.features, active: p.active, name: p.name,
      })),
    };
    return this.cache;
  }

  async getSettings(): Promise<PlatformSettings> {
    return (await this.load()).settings;
  }

  async updateSettings(patch: Partial<PlatformSettings>): Promise<PlatformSettings> {
    const next = { ...(await this.getSettings()), ...patch };
    await this.db.insert(settings).values({ key: KEY, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
    this.invalidate();
    return next;
  }

  async getServices(includeInactive = false) {
    const s = (await this.load()).services;
    return includeInactive ? s : s.filter((x) => x.active);
  }
  async getService(code: string) {
    return (await this.load()).services.find((s) => s.code === code) ?? null;
  }
  async getPlans(includeInactive = false) {
    const p = (await this.load()).plans;
    return includeInactive ? p : p.filter((x) => x.active);
  }
  async getPlan(code: string) {
    return (await this.load()).plans.find((p) => p.code === code) ?? null;
  }

  async getCatalog(includeInactive = false): Promise<Catalog> {
    const s = await this.getSettings();
    return {
      services: await this.getServices(includeInactive),
      bundles: BUNDLES,
      plans: await this.getPlans(includeInactive),
      settings: {
        freeListingsPerMonth: s.freeListingsPerMonth, listingFee: s.listingFee, listingLifetimeDays: s.listingLifetimeDays,
        dailyRentGuestFeePercent: s.dailyRentGuestFeePercent, dailyRentHostFeePercent: s.dailyRentHostFeePercent,
        freeCancellationHours: s.freeCancellationHours, topupBonuses: s.topupBonuses, minTopup: s.minTopup, maxTopup: s.maxTopup,
      },
    };
  }
}

/**
 * Listing quota + active subscription lookup. Shared by listings (create), auth (/me) and billing.
 * Rules (see docs/BUSINESS_MODEL.md):
 *  - Business user with an active subscription (own or agency's): quota = plan.listingQuota simultaneous ACTIVE+PENDING listings.
 *  - Everyone else: `freeListingsPerMonth` free SALE / RENT_LONG listings per rolling 30 days; RENT_DAILY listings are free
 *    (we earn commission on bookings). Over quota → listing is created as DRAFT and needs LISTING_FEE.
 */
@Injectable()
export class QuotaService {
  constructor(@InjectDb() private readonly db: Database, private readonly settingsService: SettingsService) {}

  async getActiveSubscription(userId: string, agencyId: string | null) {
    const now = new Date();
    const owner = agencyId ? or(eq(subscriptions.userId, userId), eq(subscriptions.agencyId, agencyId)) : eq(subscriptions.userId, userId);
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(and(owner, inArray(subscriptions.status, ['ACTIVE', 'CANCELLED']), gt(subscriptions.currentPeriodEnd, now)))
      .orderBy(sql`${subscriptions.currentPeriodEnd} desc`)
      .limit(1);
    return sub ?? null;
  }

  async countBusinessActive(userId: string, agencyId: string | null) {
    const owner = agencyId ? eq(listings.agencyId, agencyId) : eq(listings.ownerId, userId);
    const [r] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listings).where(and(owner, inArray(listings.status, ['ACTIVE', 'PENDING'])));
    return r.c;
  }

  async getQuota(userId: string, agencyId: string | null): Promise<ListingQuota> {
    const s = await this.settingsService.getSettings();
    const sub = await this.getActiveSubscription(userId, agencyId);
    if (sub) {
      const plan = await this.settingsService.getPlan(sub.planCode);
      const limit = plan?.listingQuota ?? 0;
      const used = await this.countBusinessActive(userId, agencyId);
      return { freeLimit: limit, used, remaining: limit < 0 ? -1 : Math.max(0, limit - used), listingFee: s.listingFee };
    }
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [r] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.ownerId, userId), eq(listings.isFreeQuota, true), ne(listings.dealType, 'RENT_DAILY'), gt(listings.createdAt, since), notInArray(listings.status, ['DRAFT', 'REJECTED'])));
    const used = r.c;
    return { freeLimit: s.freeListingsPerMonth, used, remaining: Math.max(0, s.freeListingsPerMonth - used), listingFee: s.listingFee };
  }

  async toSubscriptionDto(sub: typeof subscriptions.$inferSelect): Promise<Subscription> {
    const plan = await this.settingsService.getPlan(sub.planCode);
    const activeListings = await this.countBusinessActive(sub.userId, sub.agencyId);
    return {
      id: sub.id, planCode: sub.planCode as Subscription['planCode'], period: sub.period as Subscription['period'], status: sub.status as Subscription['status'],
      autoRenew: sub.autoRenew, currentPeriodStart: iso(sub.currentPeriodStart)!, currentPeriodEnd: iso(sub.currentPeriodEnd)!,
      usage: { activeListings, listingQuota: plan?.listingQuota ?? 0, bumpsLeft: sub.bumpsLeft, vipCreditsLeft: sub.vipCreditsLeft, premiumCreditsLeft: sub.premiumCreditsLeft },
      cardMask: sub.cardMask,
    };
  }
}
