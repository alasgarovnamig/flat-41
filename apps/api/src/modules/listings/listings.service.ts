import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  getCity, getDistrict, getMetro, maskPhone,
  type ActivePromotion, type AgencySummary, type Availability, type CreateListingInput, type ListingCard, type ListingDetail, type ListingSearchParsed,
  type ListingStats, type MapPoint, type MyListing, type Paginated, type PricePeriod, type Review, type UpdateListingInput,
} from '@evtap/shared';
import { Database, InjectDb, Tx } from '../../db/db.module';
import {
  agencies, bookings, conversations, favorites, listingBlockedDates, listingDailyStats, listingImages, listingPromotions, listingReports,
  listings, messages, reviews, uploads, users,
} from '../../db/schema';
import type { AuthUser } from '../../common/decorators';
import { AppError, forbidden, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { addDays, iso, ymd } from '../../common/util';
import { QuotaService, SettingsService } from '../settings/settings.service';
import { toAgencySummary } from '../agencies/agency.mapper';
import { UsersService } from '../users/users.service';
import { cardColumns, CardRow, ListingRow, toCard, toImage, toMapPoint, toMyListing, toPromotion } from './listing.mapper';
import { searchOrderBy, searchWhere, type SearchFilters } from './listing-search';

type CreateInput = Omit<CreateListingInput, 'currency' | 'hasDocument' | 'mortgageAvailable' | 'amenities'> & {
  currency: string; hasDocument: boolean; mortgageAvailable: boolean; amenities: string[];
};
type Db = Database | Tx;

const PERIOD: Record<string, PricePeriod> = { SALE: 'TOTAL', RENT_LONG: 'MONTH', RENT_DAILY: 'DAY' };
const MAX_MAP_POINTS = 500;
const isStaff = (u?: AuthUser) => u?.role === 'ADMIN' || u?.role === 'MODERATOR';

/** Editable listing columns shared by create / update / admin update. */
const EDITABLE = [
  'dealType', 'propertyType', 'buildingType', 'title', 'description', 'price', 'currency', 'cityId', 'districtId', 'metroId', 'address',
  'lat', 'lng', 'area', 'landArea', 'rooms', 'bathrooms', 'floor', 'totalFloors', 'yearBuilt', 'ceilingHeight', 'repair', 'hasDocument',
  'mortgageAvailable', 'amenities', 'maxGuests', 'minNights', 'checkInTime', 'checkOutTime', 'houseRules', 'contactName', 'contactPhone',
] as const;

@Injectable()
export class ListingsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly quota: QuotaService,
    private readonly users: UsersService,
  ) {}

  /** Reusable card mapper (favorites, bookings, messaging…). Pass `coverImage` when the row has no joined cover. */
  toCard(row: CardRow, coverImage?: string | null): ListingCard {
    return toCard(row, coverImage);
  }

  // ───────────────────────────── Search ─────────────────────────────
  async search(q: ListingSearchParsed): Promise<Paginated<ListingCard>> {
    const where = searchWhere(q);
    const { limit, offset } = pageArgs(q.page, q.pageSize);
    const rows = await this.db.select(cardColumns).from(listings).where(where).orderBy(...searchOrderBy(q.sort)).limit(limit).offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listings).where(where);
    return paginated(rows.map((r) => toCard(r)), c, q.page, q.pageSize);
  }

  async featured(kind: 'vip' | 'premium', opts: { dealType?: string; cityId?: string; limit: number }): Promise<ListingCard[]> {
    const now = new Date();
    const col = kind === 'vip' ? listings.vipUntil : listings.premiumUntil;
    const rows = await this.db
      .select(cardColumns)
      .from(listings)
      .where(and(eq(listings.status, 'ACTIVE'), gt(col, now), opts.dealType ? eq(listings.dealType, opts.dealType) : undefined, opts.cityId ? eq(listings.cityId, opts.cityId) : undefined))
      .orderBy(sql`random()`)
      .limit(opts.limit);
    return rows.map((r) => toCard(r));
  }

  async mapPoints(q: ListingSearchParsed): Promise<MapPoint[]> {
    if (!q.bbox) throw new AppError('VALIDATION_ERROR', 'bbox is required');
    const rows = await this.db.select().from(listings).where(searchWhere(q)).orderBy(...searchOrderBy(q.sort)).limit(MAX_MAP_POINTS);
    return rows.map(toMapPoint);
  }

  /** Count of ACTIVE listings matching filters, published within (since, until]. Used by the saved-search matcher. */
  async countNewMatches(q: SearchFilters, since: Date, until: Date, excludeOwnerId?: string) {
    const [{ c }] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(searchWhere(q), gt(listings.publishedAt, since), lte(listings.publishedAt, until), excludeOwnerId ? ne(listings.ownerId, excludeOwnerId) : undefined));
    return c;
  }

  // ───────────────────────────── Detail ─────────────────────────────
  async getRow(id: string, db: Db = this.db): Promise<CardRow> {
    const [row] = await db.select(cardColumns).from(listings).where(eq(listings.id, id));
    if (!row) throw notFound('Listing');
    return row;
  }

  private async getOwned(id: string, user: AuthUser): Promise<CardRow> {
    const row = await this.getRow(id);
    if (row.ownerId !== user.id) throw forbidden('Not your listing');
    return row;
  }

  async activePromotions(listingId: string, db: Db = this.db): Promise<ActivePromotion[]> {
    const rows = await db
      .select()
      .from(listingPromotions)
      .where(and(eq(listingPromotions.listingId, listingId), gt(listingPromotions.endsAt, new Date())))
      .orderBy(desc(listingPromotions.startsAt));
    return rows.map(toPromotion);
  }

  async getDetail(id: string, user?: AuthUser, opts: { countView?: boolean } = {}): Promise<ListingDetail> {
    const row = await this.getRow(id);
    const isOwner = !!user && row.ownerId === user.id;
    const privileged = isOwner || isStaff(user);
    if (row.status !== 'ACTIVE' && !privileged) throw notFound('Listing');

    if (opts.countView && row.status === 'ACTIVE' && !isOwner) {
      await this.db.update(listings).set({ views: sql`${listings.views} + 1` }).where(eq(listings.id, id));
      await this.bumpDailyStat(id, 'views');
      row.views += 1;
    }
    const images = await this.db.select().from(listingImages).where(eq(listingImages.listingId, id)).orderBy(asc(listingImages.order));
    const owner = await this.users.getPublicUser(row.ownerId);
    const [fav] = user ? await this.db.select({ x: sql`1` }).from(favorites).where(and(eq(favorites.userId, user.id), eq(favorites.listingId, id))) : [];
    return {
      ...toCard(row),
      description: row.description,
      images: images.map(toImage),
      bathrooms: row.bathrooms,
      yearBuilt: row.yearBuilt,
      ceilingHeight: row.ceilingHeight,
      repair: (row.repair as ListingDetail['repair']) ?? null,
      amenities: row.amenities as ListingDetail['amenities'],
      maxGuests: row.maxGuests,
      minNights: row.minNights,
      checkInTime: row.checkInTime,
      checkOutTime: row.checkOutTime,
      houseRules: row.houseRules,
      contactName: row.contactName,
      contactPhoneMasked: maskPhone(row.contactPhone),
      contactPhone: privileged ? row.contactPhone : null,
      owner,
      agency: await this.agencySummary(row.agencyId, owner.agency),
      views: row.views,
      favoritesCount: row.favoritesCount,
      reviewsCount: row.reviewsCount,
      expiresAt: iso(row.expiresAt),
      rejectionReason: privileged ? row.rejectionReason : null,
      promotions: privileged ? await this.activePromotions(id) : [],
      isOwner,
      isFavorite: !!fav,
      updatedAt: iso(row.updatedAt)!,
    };
  }

  private async agencySummary(agencyId: string | null, ownerAgency: AgencySummary | null): Promise<AgencySummary | null> {
    if (!agencyId) return null;
    if (ownerAgency?.id === agencyId) return ownerAgency;
    const [a] = await this.db.select().from(agencies).where(eq(agencies.id, agencyId));
    return a ? toAgencySummary(a) : null;
  }

  private async bumpDailyStat(listingId: string, field: 'views' | 'phoneViews') {
    const col = field === 'views' ? listingDailyStats.views : listingDailyStats.phoneViews;
    await this.db
      .insert(listingDailyStats)
      .values({ listingId, date: ymd(), [field]: 1 })
      .onConflictDoUpdate({ target: [listingDailyStats.listingId, listingDailyStats.date], set: { [field]: sql`${col} + 1` } });
  }

  async revealPhone(id: string, user?: AuthUser) {
    const row = await this.getRow(id);
    const isOwner = !!user && row.ownerId === user.id;
    if (row.status !== 'ACTIVE' && !isOwner && !isStaff(user)) throw notFound('Listing');
    if (row.status === 'ACTIVE' && !isOwner) {
      await this.db.update(listings).set({ phoneViews: sql`${listings.phoneViews} + 1` }).where(eq(listings.id, id));
      await this.bumpDailyStat(id, 'phoneViews');
    }
    return { phone: row.contactPhone };
  }

  async similar(id: string): Promise<ListingCard[]> {
    const row = await this.getRow(id);
    const rows = await this.db
      .select(cardColumns)
      .from(listings)
      .where(and(eq(listings.status, 'ACTIVE'), ne(listings.id, id), eq(listings.dealType, row.dealType), eq(listings.propertyType, row.propertyType), eq(listings.cityId, row.cityId)))
      .orderBy(sql`(case when ${listings.districtId} = ${row.districtId ?? ''} then 0 else 1 end)`, sql`abs(${listings.price} - ${row.price})`)
      .limit(8);
    return rows.map((r) => toCard(r));
  }

  async reviews(id: string, page: number, pageSize: number): Promise<Paginated<Review>> {
    const { limit, offset } = pageArgs(page, pageSize);
    const rows = await this.db
      .select({ r: reviews, author: { id: users.id, name: users.name, avatarUrl: users.avatarUrl } })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(eq(reviews.listingId, id))
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(reviews).where(eq(reviews.listingId, id));
    return paginated(
      rows.map(({ r, author }) => ({ id: r.id, listingId: r.listingId, bookingId: r.bookingId, author, rating: r.rating, comment: r.comment, createdAt: iso(r.createdAt)!, hostReply: r.hostReply })),
      c, page, pageSize,
    );
  }

  // ───────────────────────────── Availability (daily rent) ─────────────────────────────
  async getAvailability(id: string, from?: string, to?: string): Promise<Availability> {
    await this.getRow(id);
    const start = from ?? ymd();
    const end = to ?? ymd(addDays(new Date(), 365));
    const blocked = await this.db
      .select({ date: listingBlockedDates.date })
      .from(listingBlockedDates)
      .where(and(eq(listingBlockedDates.listingId, id), gte(listingBlockedDates.date, start), lte(listingBlockedDates.date, end)))
      .orderBy(asc(listingBlockedDates.date));
    const booked = await this.db
      .select({ checkIn: bookings.checkIn, checkOut: bookings.checkOut })
      .from(bookings)
      .where(and(
        eq(bookings.listingId, id),
        or(eq(bookings.status, 'CONFIRMED'), and(eq(bookings.status, 'PENDING_PAYMENT'), or(isNull(bookings.holdExpiresAt), gt(bookings.holdExpiresAt, new Date())))),
        sql`${bookings.checkOut} > ${start}::date`, sql`${bookings.checkIn} <= ${end}::date`,
      ))
      .orderBy(asc(bookings.checkIn));
    return { listingId: id, blockedDates: blocked.map((b) => b.date), bookedRanges: booked };
  }

  /** Replaces the owner's blocked dates from today on with the given set (past dates are kept untouched). */
  async setAvailability(id: string, user: AuthUser, dates: string[]): Promise<Availability> {
    const row = await this.getOwned(id, user);
    if (row.dealType !== 'RENT_DAILY') throw new AppError('NOT_DAILY_RENT', 'Availability is only for daily rent listings');
    const today = ymd();
    const future = [...new Set(dates)].filter((d) => d >= today);
    await this.db.transaction(async (tx) => {
      await tx.delete(listingBlockedDates).where(and(eq(listingBlockedDates.listingId, id), gte(listingBlockedDates.date, today)));
      if (future.length) await tx.insert(listingBlockedDates).values(future.map((date) => ({ listingId: id, date }))).onConflictDoNothing();
    });
    return this.getAvailability(id);
  }

  // ───────────────────────────── Owner stats ─────────────────────────────
  async stats(id: string, user: AuthUser, days = 30): Promise<ListingStats> {
    const row = await this.getRow(id);
    if (row.ownerId !== user.id && !isStaff(user)) throw forbidden('Not your listing');
    const since = ymd(addDays(new Date(), -(days - 1)));
    const daily = await this.db.execute<{ date: string; views: number; phone_views: number }>(sql`
      select to_char(d, 'YYYY-MM-DD') as date, coalesce(s.views, 0)::int as views, coalesce(s.phone_views, 0)::int as phone_views
      from generate_series(${since}::date, current_date, interval '1 day') d
      left join listing_daily_stats s on s.listing_id = ${id} and s.date = d::date
      order by d`);
    const [msg] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.listingId, id), ne(messages.senderId, row.ownerId)));
    return {
      views: row.views,
      phoneViews: row.phoneViews,
      favorites: row.favoritesCount,
      messages: msg.c,
      daily: daily.rows.map((d) => ({ date: d.date, views: d.views, phoneViews: d.phone_views })),
    };
  }

  // ───────────────────────────── Create / update ─────────────────────────────
  private validateLocation(v: { cityId?: string; districtId?: string | null; metroId?: string | null }) {
    const city = v.cityId ? getCity(v.cityId) : undefined;
    if (v.cityId && !city) throw new AppError('INVALID_LOCATION', 'Unknown cityId');
    if (v.districtId && getDistrict(v.districtId)?.cityId !== v.cityId) throw new AppError('INVALID_LOCATION', 'districtId does not belong to cityId');
    if (v.metroId && getMetro(v.metroId)?.cityId !== v.cityId) throw new AppError('INVALID_LOCATION', 'metroId does not belong to cityId');
    return city;
  }

  /**
   * Resolves ordered image ids into listing_images values. Accepts upload ids owned by `ownerIds`
   * and — when editing — ids of images already attached to the listing (listing_images.id or their uploadId).
   */
  private async resolveImages(imageIds: string[], ownerIds: string[], listingId?: string) {
    const ids = [...new Set(imageIds)];
    const ups = await this.db.select().from(uploads).where(and(inArray(uploads.id, ids), inArray(uploads.userId, ownerIds)));
    const existing = listingId ? await this.db.select().from(listingImages).where(eq(listingImages.listingId, listingId)) : [];
    return ids.map((imgId, order) => {
      const u = ups.find((x) => x.id === imgId);
      if (u) return { uploadId: u.id, url: u.url, thumbUrl: u.thumbUrl, order };
      const e = existing.find((x) => x.id === imgId || x.uploadId === imgId);
      if (e) return { uploadId: e.uploadId, url: e.url, thumbUrl: e.thumbUrl, order };
      throw new AppError('INVALID_IMAGES', `Image ${imgId} not found or not yours`);
    });
  }

  private pick(input: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const k of EDITABLE) if (input[k] !== undefined) out[k] = input[k];
    return out as Partial<typeof listings.$inferInsert>;
  }

  /** Whether a new / renewed listing must pay LISTING_FEE. Daily rent is always free (commission model). */
  private async needsListingFee(userId: string, agencyId: string | null, dealType: string) {
    if (dealType === 'RENT_DAILY') return false;
    const q = await this.quota.getQuota(userId, agencyId);
    return q.remaining === 0;
  }

  private async publishState() {
    const s = await this.settings.getSettings();
    const now = new Date();
    return s.moderationEnabled
      ? { status: 'PENDING' as const }
      : { status: 'ACTIVE' as const, publishedAt: now, bumpedAt: now, expiresAt: addDays(now, s.listingLifetimeDays) };
  }

  async create(user: AuthUser, input: CreateInput): Promise<MyListing> {
    const [owner] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!owner || owner.status !== 'ACTIVE') throw forbidden('Account is not active');
    const city = this.validateLocation(input);
    const images = await this.resolveImages(input.imageIds, [user.id]);
    const requiresPayment = await this.needsListingFee(owner.id, owner.agencyId, input.dealType);
    const state = requiresPayment ? { status: 'DRAFT' as const } : await this.publishState();

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(listings)
        .values({
          ...(this.pick(input) as typeof listings.$inferInsert),
          ownerId: owner.id,
          agencyId: owner.agencyId,
          pricePeriod: PERIOD[input.dealType],
          country: city!.country,
          isFreeQuota: !requiresPayment,
          ...state,
        })
        .returning({ id: listings.id });
      await tx.insert(listingImages).values(images.map((i) => ({ ...i, listingId: row.id })));
      return row.id;
    });
    return this.getMine(id);
  }

  async getMine(id: string, db: Db = this.db): Promise<MyListing> {
    const row = await this.getRow(id, db);
    return toMyListing(row, await this.activePromotions(id, db));
  }

  /** Owner edit. ACTIVE (and REJECTED) listings go back to moderation when moderation is enabled. */
  async update(id: string, user: AuthUser, input: UpdateListingInput): Promise<MyListing> {
    const row = await this.getOwned(id, user);
    if (row.status === 'BLOCKED') throw new AppError('LISTING_BLOCKED', 'Blocked listings cannot be edited', HttpStatus.FORBIDDEN);
    if (row.status === 'ARCHIVED') throw new AppError('INVALID_STATUS', 'Restore the listing before editing');
    await this.applyUpdate(row, input, [row.ownerId]);
    if (row.status === 'ACTIVE' || row.status === 'REJECTED') {
      const s = await this.settings.getSettings();
      if (s.moderationEnabled) await this.db.update(listings).set({ status: 'PENDING', rejectionReason: null }).where(eq(listings.id, id));
      else if (row.status === 'REJECTED') await this.db.update(listings).set({ ...(await this.publishState()), rejectionReason: null }).where(eq(listings.id, id));
    }
    return this.getMine(id);
  }

  /** Field update shared by owner and admin edit (no status changes). */
  async applyUpdate(row: ListingRow, input: UpdateListingInput & { isVerified?: boolean }, imageOwnerIds: string[]) {
    const patch = this.pick(input as Record<string, unknown>);
    const merged = { cityId: row.cityId, districtId: row.districtId, metroId: row.metroId, ...patch } as { cityId: string; districtId?: string | null; metroId?: string | null };
    if (patch.cityId || patch.districtId !== undefined || patch.metroId !== undefined) {
      // Changing the city without new district/metro drops the old ones.
      if (patch.cityId && patch.cityId !== row.cityId) {
        if (patch.districtId === undefined) merged.districtId = null;
        if (patch.metroId === undefined) merged.metroId = null;
      }
      const city = this.validateLocation(merged);
      Object.assign(patch, { cityId: merged.cityId, districtId: merged.districtId ?? null, metroId: merged.metroId ?? null, country: city!.country });
    }
    if (patch.dealType) patch.pricePeriod = PERIOD[patch.dealType];
    const floor = patch.floor !== undefined ? patch.floor : row.floor;
    const total = patch.totalFloors !== undefined ? patch.totalFloors : row.totalFloors;
    if (floor != null && total != null && floor > total) throw new AppError('VALIDATION_ERROR', 'Floor cannot exceed total floors');
    if (input.isVerified !== undefined) patch.isVerified = input.isVerified;

    const images = input.imageIds ? await this.resolveImages(input.imageIds, imageOwnerIds, row.id) : null;
    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length) await tx.update(listings).set(patch).where(eq(listings.id, row.id));
      else await tx.update(listings).set({ updatedAt: new Date() }).where(eq(listings.id, row.id));
      if (images) {
        await tx.delete(listingImages).where(eq(listingImages.listingId, row.id));
        if (images.length) await tx.insert(listingImages).values(images.map((i) => ({ ...i, listingId: row.id })));
      }
    });
  }

  // ───────────────────────────── Status actions ─────────────────────────────
  async action(id: string, user: AuthUser, action: 'MARK_SOLD' | 'ARCHIVE' | 'RENEW' | 'RESTORE'): Promise<MyListing> {
    const row = await this.getOwned(id, user);
    const bad = () => new AppError('INVALID_STATUS_TRANSITION', `Cannot ${action} a listing in status ${row.status}`);
    const s = await this.settings.getSettings();
    const now = new Date();
    let patch: Partial<typeof listings.$inferInsert>;
    switch (action) {
      case 'MARK_SOLD':
        if (!['ACTIVE', 'EXPIRED'].includes(row.status)) throw bad();
        patch = { status: 'SOLD' };
        break;
      case 'ARCHIVE':
        if (['ARCHIVED', 'BLOCKED'].includes(row.status)) throw bad();
        patch = { status: 'ARCHIVED' };
        break;
      case 'RENEW': {
        if (!['EXPIRED', 'ACTIVE'].includes(row.status)) throw bad();
        if (row.status === 'EXPIRED') {
          const [owner] = await this.db.select().from(users).where(eq(users.id, row.ownerId));
          if (await this.needsListingFee(owner.id, owner.agencyId, row.dealType)) {
            patch = { status: 'DRAFT', isFreeQuota: false };
            break;
          }
        }
        patch = { status: 'ACTIVE', expiresAt: addDays(now, s.listingLifetimeDays), bumpedAt: now, publishedAt: row.publishedAt ?? now };
        break;
      }
      case 'RESTORE':
        if (!['ARCHIVED', 'SOLD'].includes(row.status)) throw bad();
        patch = { status: 'PENDING', rejectionReason: null };
        if (!s.moderationEnabled) patch = { ...patch, ...(await this.publishState()) };
        break;
    }
    await this.db.update(listings).set(patch).where(eq(listings.id, id));
    return this.getMine(id);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.getOwned(id, user);
    if (row.status !== 'ARCHIVED') await this.db.update(listings).set({ status: 'ARCHIVED' }).where(eq(listings.id, id));
    return { ok: true as const };
  }

  async report(id: string, user: AuthUser | undefined, reason: string, comment?: string) {
    await this.getRow(id);
    if (user) {
      const [dup] = await this.db
        .select({ id: listingReports.id })
        .from(listingReports)
        .where(and(eq(listingReports.listingId, id), eq(listingReports.reporterId, user.id), eq(listingReports.status, 'OPEN')));
      if (dup) return { ok: true as const };
    }
    await this.db.insert(listingReports).values({ listingId: id, reporterId: user?.id ?? null, reason, comment: comment ?? null });
    return { ok: true as const };
  }

  async myListings(userId: string, status: string | undefined, page: number, pageSize: number): Promise<Paginated<MyListing>> {
    const where = and(eq(listings.ownerId, userId), status ? eq(listings.status, status) : undefined);
    const { limit, offset } = pageArgs(page, pageSize);
    const rows = await this.db.select(cardColumns).from(listings).where(where).orderBy(desc(listings.createdAt)).limit(limit).offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listings).where(where);
    const ids = rows.map((r) => r.id);
    const promos = ids.length
      ? await this.db.select().from(listingPromotions).where(and(inArray(listingPromotions.listingId, ids), gt(listingPromotions.endsAt, new Date())))
      : [];
    return paginated(rows.map((r) => toMyListing(r, promos.filter((p) => p.listingId === r.id).map(toPromotion))), c, page, pageSize);
  }

  // ───────────────────────────── Cross-module contract (payments) ─────────────────────────────
  /** LISTING_FEE paid: DRAFT → PENDING (or ACTIVE when moderation is disabled). Idempotent. */
  async markListingFeePaid(listingId: string, tx?: Tx): Promise<void> {
    const db: Db = tx ?? this.db;
    const [row] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listingId));
    if (!row) throw notFound('Listing');
    if (row.status !== 'DRAFT') return;
    await db.update(listings).set({ ...(await this.publishState()), isFreeQuota: false }).where(and(eq(listings.id, listingId), eq(listings.status, 'DRAFT')));
  }

  /** VERIFICATION purchased: grants the "Yoxlanılıb" badge. */
  async markVerified(listingId: string, tx?: Tx): Promise<void> {
    const db: Db = tx ?? this.db;
    const r = await db.update(listings).set({ isVerified: true }).where(eq(listings.id, listingId)).returning({ id: listings.id });
    if (!r.length) throw notFound('Listing');
  }
}
