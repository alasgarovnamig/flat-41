import { getTableColumns, sql } from 'drizzle-orm';
import type { ActivePromotion, AdminListing, ListingCard, ListingImage, MapPoint, MyListing } from '@evtap/shared';
import { listingImages, listingPromotions, listings } from '../../db/schema';
import { iso } from '../../common/util';

export type ListingRow = typeof listings.$inferSelect;
/** Optional columns joined by `cardColumns` (cover thumb, image count, owner account type). */
export interface CardExtras { coverUrl?: string | null; imagesCount?: number | null; ownerAccountType?: string | null }
export type CardRow = ListingRow & CardExtras;

/**
 * Select shape for card lists: listing columns + cover thumb + images count + owner account type.
 * NOTE: Drizzle renders columns in a single-table select list unqualified ("id"), which inside a correlated
 * subquery would bind to the inner table — so outer references are written as qualified raw identifiers.
 */
export const cardColumns = {
  ...getTableColumns(listings),
  coverUrl: sql<string | null>`(select li.thumb_url from listing_images li where li.listing_id = "listings"."id" order by li."order" asc limit 1)`,
  imagesCount: sql<number>`(select count(*)::int from listing_images li where li.listing_id = "listings"."id")`,
  ownerAccountType: sql<string | null>`(select u.account_type from users u where u.id = "listings"."owner_id")`,
};

const active = (d: Date | null | undefined, now: number) => !!d && d.getTime() > now;

/** Maps a listing row to the compact card DTO. Reused by favorites, bookings, messaging… */
export function toCard(row: CardRow, coverImage?: string | null): ListingCard {
  const now = Date.now();
  return {
    id: row.id,
    title: row.title,
    dealType: row.dealType as ListingCard['dealType'],
    propertyType: row.propertyType as ListingCard['propertyType'],
    buildingType: (row.buildingType as ListingCard['buildingType']) ?? null,
    price: row.price,
    currency: row.currency as ListingCard['currency'],
    pricePeriod: row.pricePeriod as ListingCard['pricePeriod'],
    country: row.country as ListingCard['country'],
    cityId: row.cityId,
    districtId: row.districtId,
    metroId: row.metroId,
    address: row.address,
    area: row.area,
    landArea: row.landArea,
    rooms: row.rooms,
    floor: row.floor,
    totalFloors: row.totalFloors,
    coverUrl: coverImage !== undefined ? coverImage : (row.coverUrl ?? null),
    imagesCount: row.imagesCount ?? 0,
    lat: row.lat,
    lng: row.lng,
    isVip: active(row.vipUntil, now),
    isPremium: active(row.premiumUntil, now),
    isHighlighted: active(row.highlightUntil, now),
    isUrgent: active(row.urgentUntil, now),
    isVerified: row.isVerified,
    hasDocument: row.hasDocument,
    mortgageAvailable: row.mortgageAvailable,
    isBusiness: !!row.agencyId || row.ownerAccountType === 'BUSINESS',
    rating: row.dealType === 'RENT_DAILY' && row.reviewsCount > 0 ? row.ratingAvg : null,
    status: row.status as ListingCard['status'],
    bumpedAt: iso(row.bumpedAt)!,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt)!,
  };
}

export const toMyListing = (row: CardRow, promotions: ActivePromotion[] = []): MyListing => ({
  ...toCard(row),
  views: row.views,
  phoneViews: row.phoneViews,
  favoritesCount: row.favoritesCount,
  expiresAt: iso(row.expiresAt),
  rejectionReason: row.rejectionReason,
  promotions,
  requiresPayment: row.status === 'DRAFT',
});

export type AdminCardRow = CardRow & { ownerName: string | null; ownerPhone: string | null; reportsCount: number | null };

export const adminCardColumns = {
  ...cardColumns,
  ownerName: sql<string | null>`(select u.name from users u where u.id = "listings"."owner_id")`,
  ownerPhone: sql<string | null>`(select u.phone from users u where u.id = "listings"."owner_id")`,
  reportsCount: sql<number>`(select count(*)::int from listing_reports r where r.listing_id = "listings"."id" and r.status = 'OPEN')`,
};

export const toAdminListing = (row: AdminCardRow): AdminListing => ({
  ...toCard(row),
  ownerId: row.ownerId,
  ownerName: row.ownerName ?? '',
  ownerPhone: row.ownerPhone ?? null,
  views: row.views,
  rejectionReason: row.rejectionReason,
  reportsCount: row.reportsCount ?? 0,
  updatedAt: iso(row.updatedAt)!,
});

export const toImage = (r: typeof listingImages.$inferSelect): ListingImage => ({ id: r.id, uploadId: r.uploadId, url: r.url, thumbUrl: r.thumbUrl, order: r.order });

export const toPromotion = (p: typeof listingPromotions.$inferSelect): ActivePromotion => ({
  id: p.id,
  type: p.type as ActivePromotion['type'],
  serviceCode: p.serviceCode,
  startsAt: iso(p.startsAt)!,
  endsAt: iso(p.endsAt),
});

export const toMapPoint = (row: ListingRow): MapPoint => {
  const now = Date.now();
  return {
    id: row.id,
    lat: row.lat!,
    lng: row.lng!,
    price: row.price,
    currency: row.currency as MapPoint['currency'],
    pricePeriod: row.pricePeriod as MapPoint['pricePeriod'],
    isVip: active(row.vipUntil, now),
    isPremium: active(row.premiumUntil, now),
    title: row.title,
    coverUrl: (row as { coverUrl?: string | null }).coverUrl ?? null,
  };
};
