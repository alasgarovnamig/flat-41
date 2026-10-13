import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { ActivePromotion, ListingCard, MyListing, PromotionType } from '@evtap/shared';
import type { Database, Tx } from '../../db/db.module';
import { listingImages, listingPromotions, listings, users } from '../../db/schema';
import { iso } from '../../common/util';

type ListingRow = typeof listings.$inferSelect;

/**
 * Minimal listing mappers needed by the money modules (apply-credit response, booking cards).
 * TODO: delegate to ListingsService.toCard / toMyListing once the listings workstream is merged.
 */
export async function listingCovers(db: Database | Tx, ids: string[]) {
  const map = new Map<string, { coverUrl: string | null; imagesCount: number }>();
  if (!ids.length) return map;
  const rows = await db
    .select({ listingId: listingImages.listingId, thumbUrl: listingImages.thumbUrl, order: listingImages.order })
    .from(listingImages)
    .where(inArray(listingImages.listingId, ids))
    .orderBy(asc(listingImages.listingId), asc(listingImages.order));
  for (const r of rows) {
    const cur = map.get(r.listingId);
    if (cur) cur.imagesCount++;
    else map.set(r.listingId, { coverUrl: r.thumbUrl, imagesCount: 1 });
  }
  return map;
}

const after = (d: Date | null, now: Date) => !!d && d > now;

export async function toListingCard(db: Database | Tx, l: ListingRow): Promise<ListingCard> {
  const now = new Date();
  const cover = (await listingCovers(db, [l.id])).get(l.id);
  const [owner] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.id, l.ownerId));
  return {
    id: l.id, title: l.title, dealType: l.dealType as ListingCard['dealType'], propertyType: l.propertyType as ListingCard['propertyType'],
    buildingType: (l.buildingType as ListingCard['buildingType']) ?? null, price: l.price, currency: l.currency as ListingCard['currency'],
    pricePeriod: l.pricePeriod as ListingCard['pricePeriod'], country: l.country as ListingCard['country'], cityId: l.cityId, districtId: l.districtId,
    metroId: l.metroId, address: l.address, area: l.area, landArea: l.landArea, rooms: l.rooms, floor: l.floor, totalFloors: l.totalFloors,
    coverUrl: cover?.coverUrl ?? null, imagesCount: cover?.imagesCount ?? 0, lat: l.lat, lng: l.lng,
    isVip: after(l.vipUntil, now), isPremium: after(l.premiumUntil, now), isHighlighted: after(l.highlightUntil, now), isUrgent: after(l.urgentUntil, now),
    isVerified: l.isVerified, hasDocument: l.hasDocument, mortgageAvailable: l.mortgageAvailable,
    isBusiness: !!l.agencyId || owner?.accountType === 'BUSINESS', rating: l.ratingAvg, status: l.status as ListingCard['status'],
    bumpedAt: iso(l.bumpedAt)!, publishedAt: iso(l.publishedAt), createdAt: iso(l.createdAt)!,
  };
}

export async function activePromotions(db: Database | Tx, listingId: string): Promise<ActivePromotion[]> {
  const rows = await db
    .select()
    .from(listingPromotions)
    .where(and(eq(listingPromotions.listingId, listingId), or(gt(listingPromotions.endsAt, new Date()), and(isNull(listingPromotions.endsAt), sql`${listingPromotions.startsAt} > now() - interval '1 day'`))))
    .orderBy(asc(listingPromotions.startsAt));
  return rows.map((p) => ({ id: p.id, type: p.type as PromotionType, serviceCode: p.serviceCode, startsAt: iso(p.startsAt)!, endsAt: iso(p.endsAt) }));
}

export async function toMyListing(db: Database | Tx, l: ListingRow): Promise<MyListing> {
  return {
    ...(await toListingCard(db, l)),
    views: l.views, phoneViews: l.phoneViews, favoritesCount: l.favoritesCount, expiresAt: iso(l.expiresAt), rejectionReason: l.rejectionReason,
    promotions: await activePromotions(db, l.id), requiresPayment: l.status === 'DRAFT',
  };
}
