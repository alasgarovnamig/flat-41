import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AdminListing, ListingDetail, ListingReport, Paginated, UpdateListingInput } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { listingPromotions, listingReports, listings, users } from '../../db/schema';
import type { AuthUser } from '../../common/decorators';
import { AppError, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { addDays } from '../../common/util';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { adminCardColumns, toAdminListing } from '../listings/listing.mapper';
import { ListingsService } from '../listings/listings.service';
import { reportColumns, toReportDto } from './admin.mappers';

export interface AdminListingQuery { status?: string; q?: string; dealType?: string; ownerId?: string; reported?: boolean; page: number; pageSize: number }

/** Columns on `listings` that each promotion type extends. BUMP only touches bumpedAt. */
const PROMO_COLUMN = {
  VIP: 'vipUntil', PREMIUM: 'premiumUntil', HIGHLIGHT: 'highlightUntil', URGENT: 'urgentUntil', AUTO_BUMP: 'autoBumpUntil',
} as const;

@Injectable()
export class AdminListingsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(q: AdminListingQuery): Promise<Paginated<AdminListing>> {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(listings.status, q.status));
    if (q.dealType) conds.push(eq(listings.dealType, q.dealType));
    if (q.ownerId) conds.push(eq(listings.ownerId, q.ownerId));
    if (q.reported) conds.push(sql`exists (select 1 from listing_reports r where r.listing_id = ${listings.id} and r.status = 'OPEN')`);
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      conds.push(sql`(${listings.id}::text = ${q.q} or ${listings.title} ilike ${like} or coalesce(${listings.address}, '') ilike ${like} or ${listings.contactPhone} ilike ${like})`);
    }
    const where = conds.length ? and(...conds) : undefined;
    const { limit, offset } = pageArgs(q.page, q.pageSize);
    // Moderation queue: oldest first; everything else newest first.
    const order = q.status === 'PENDING' ? [asc(listings.updatedAt)] : [desc(listings.createdAt)];
    const rows = await this.db.select(adminCardColumns).from(listings).where(where).orderBy(...order).limit(limit).offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listings).where(where);
    return paginated(rows.map(toAdminListing), c, q.page, q.pageSize);
  }

  async getAdminListing(id: string): Promise<AdminListing> {
    const [row] = await this.db.select(adminCardColumns).from(listings).where(eq(listings.id, id));
    if (!row) throw notFound('Listing');
    return toAdminListing(row);
  }

  async detail(id: string, admin: AuthUser): Promise<ListingDetail & { reports: ListingReport[]; ownerPhone: string | null }> {
    const detail = await this.listings.getDetail(id, admin);
    const reports = await this.db.select(reportColumns).from(listingReports).where(eq(listingReports.listingId, id)).orderBy(desc(listingReports.createdAt));
    const [owner] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, detail.owner.id));
    return { ...detail, reports: reports.map(toReportDto), ownerPhone: owner?.phone ?? null };
  }

  private async row(id: string) {
    const [row] = await this.db.select().from(listings).where(eq(listings.id, id));
    if (!row) throw notFound('Listing');
    return row;
  }

  async approve(id: string, actor: AuthUser, ip: string | null): Promise<AdminListing> {
    const row = await this.row(id);
    if (row.status === 'DRAFT') throw new AppError('LISTING_NOT_PAID', 'Listing fee is not paid yet');
    if (!['PENDING', 'REJECTED', 'BLOCKED'].includes(row.status)) throw new AppError('INVALID_STATUS_TRANSITION', `Cannot approve a ${row.status} listing`);
    const s = await this.settings.getSettings();
    const now = new Date();
    await this.db
      .update(listings)
      .set({ status: 'ACTIVE', publishedAt: now, bumpedAt: now, expiresAt: addDays(now, s.listingLifetimeDays), rejectionReason: null })
      .where(eq(listings.id, id));
    await this.audit.log(actor.id, 'listing.approve', 'listing', id, { from: row.status }, ip);
    await this.notifications.notify(row.ownerId, 'LISTING_APPROVED', 'Elanınız təsdiqləndi', `"${row.title}" elanı yoxlanıldı və saytda dərc olundu.`, { listingId: id });
    return this.getAdminListing(id);
  }

  async reject(id: string, reason: string, actor: AuthUser, ip: string | null): Promise<AdminListing> {
    const row = await this.row(id);
    if (!['PENDING', 'ACTIVE'].includes(row.status)) throw new AppError('INVALID_STATUS_TRANSITION', `Cannot reject a ${row.status} listing`);
    await this.db.update(listings).set({ status: 'REJECTED', rejectionReason: reason }).where(eq(listings.id, id));
    await this.audit.log(actor.id, 'listing.reject', 'listing', id, { reason, from: row.status }, ip);
    await this.notifications.notify(row.ownerId, 'LISTING_REJECTED', 'Elanınız rədd edildi', `"${row.title}" elanı dərc olunmadı. Səbəb: ${reason}`, { listingId: id, reason });
    return this.getAdminListing(id);
  }

  async block(id: string, reason: string, actor: AuthUser, ip: string | null): Promise<AdminListing> {
    const row = await this.row(id);
    if (row.status === 'BLOCKED') throw new AppError('INVALID_STATUS_TRANSITION', 'Listing is already blocked');
    await this.db.update(listings).set({ status: 'BLOCKED', rejectionReason: reason }).where(eq(listings.id, id));
    await this.audit.log(actor.id, 'listing.block', 'listing', id, { reason, from: row.status }, ip);
    await this.notifications.notify(row.ownerId, 'LISTING_REJECTED', 'Elanınız bloklandı', `"${row.title}" elanı qaydaların pozulmasına görə bloklandı. Səbəb: ${reason}`, { listingId: id, reason, blocked: true });
    return this.getAdminListing(id);
  }

  async update(id: string, input: UpdateListingInput & { isVerified?: boolean }, actor: AuthUser, ip: string | null): Promise<AdminListing> {
    const row = await this.row(id);
    await this.listings.applyUpdate(row, input, [row.ownerId, actor.id]);
    await this.audit.log(actor.id, 'listing.update', 'listing', id, { fields: Object.keys(input) }, ip);
    return this.getAdminListing(id);
  }

  async promote(id: string, serviceCode: string, actor: AuthUser, ip: string | null): Promise<AdminListing> {
    const row = await this.row(id);
    if (row.status !== 'ACTIVE') throw new AppError('LISTING_NOT_ACTIVE', 'Only active listings can be promoted', HttpStatus.CONFLICT);
    const service = await this.settings.getService(serviceCode);
    if (!service?.promotionType) throw new AppError('INVALID_SERVICE', `Unknown promotion service ${serviceCode}`);
    await this.applyPromotion(row, service.promotionType, service.code, service.durationDays);
    await this.audit.log(actor.id, 'listing.promote', 'listing', id, { serviceCode }, ip);
    return this.getAdminListing(id);
  }

  // TODO: delegate to PromotionsService.apply(listingId, serviceCode, 'ADMIN') once the money workstream lands.
  private async applyPromotion(row: typeof listings.$inferSelect, type: string, serviceCode: string, durationDays: number) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const patch: Partial<typeof listings.$inferInsert> = {};
      let endsAt: Date | null = null;
      if (type === 'BUMP') {
        patch.bumpedAt = now;
      } else {
        const col = PROMO_COLUMN[type as keyof typeof PROMO_COLUMN];
        const current = row[col];
        const from = current && current > now ? current : now; // extend a running promotion
        endsAt = addDays(from, durationDays);
        patch[col] = endsAt;
        if (type === 'AUTO_BUMP') patch.bumpedAt = now;
      }
      await tx.update(listings).set(patch).where(eq(listings.id, row.id));
      await tx.insert(listingPromotions).values({ listingId: row.id, type, serviceCode, startsAt: now, endsAt, source: 'ADMIN' });
    });
  }
}
