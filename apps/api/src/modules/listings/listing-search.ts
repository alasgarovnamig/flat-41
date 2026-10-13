/**
 * Pure SQL builder for listing search. Shared by GET /listings, /listings/map and the saved-search matcher,
 * so a saved search matches exactly what the user saw in results.
 */
import { and, arrayContains, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { ListingSearchParsed } from '@evtap/shared';
import { listings } from '../../db/schema';

export type SearchFilters = Partial<ListingSearchParsed>;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** "minLng,minLat,maxLng,maxLat" → numbers, or null when malformed. */
export const parseBbox = (bbox: string) => {
  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
  if ([minLng, minLat, maxLng, maxLat].some((n) => !Number.isFinite(n))) return null;
  return { minLng, minLat, maxLng, maxLat };
};

/**
 * WHERE conditions for a search. Always restricts to ACTIVE listings unless `opts.anyStatus`.
 * `now` is injectable for deterministic tests.
 */
export function buildSearchConditions(q: SearchFilters, opts: { anyStatus?: boolean; now?: Date } = {}): SQL[] {
  const c: SQL[] = [];
  if (!opts.anyStatus) c.push(eq(listings.status, 'ACTIVE'));

  if (q.q) {
    const like = `%${escapeLike(q.q)}%`;
    c.push(sql`(${listings.title} ilike ${like} or ${listings.description} ilike ${like} or coalesce(${listings.address}, '') ilike ${like})`);
  }
  if (q.dealType) c.push(eq(listings.dealType, q.dealType));
  if (q.propertyType?.length) c.push(inArray(listings.propertyType, q.propertyType));
  if (q.buildingType) c.push(eq(listings.buildingType, q.buildingType));
  if (q.country) c.push(eq(listings.country, q.country));
  if (q.cityId) c.push(eq(listings.cityId, q.cityId));
  if (q.districtId?.length) c.push(inArray(listings.districtId, q.districtId));
  if (q.metroId?.length) c.push(inArray(listings.metroId, q.metroId));
  if (q.currency) c.push(eq(listings.currency, q.currency));
  if (q.priceMin != null) c.push(gte(listings.price, q.priceMin));
  if (q.priceMax != null) c.push(lte(listings.price, q.priceMax));
  if (q.areaMin != null) c.push(gte(listings.area, q.areaMin));
  if (q.areaMax != null) c.push(lte(listings.area, q.areaMax));

  if (q.rooms?.length) {
    const exact = q.rooms.filter((r) => r < 5);
    const fivePlus = q.rooms.some((r) => r >= 5);
    const parts: SQL[] = [];
    if (exact.length) parts.push(inArray(listings.rooms, exact));
    if (fivePlus) parts.push(gte(listings.rooms, 5));
    c.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }

  if (q.floorMin != null) c.push(gte(listings.floor, q.floorMin));
  if (q.floorMax != null) c.push(lte(listings.floor, q.floorMax));
  if (q.notFirstFloor) c.push(sql`${listings.floor} > 1`);
  if (q.notLastFloor) c.push(sql`(${listings.floor} is not null and ${listings.totalFloors} is not null and ${listings.floor} < ${listings.totalFloors})`);
  if (q.repair?.length) c.push(inArray(listings.repair, q.repair));
  if (q.hasDocument) c.push(eq(listings.hasDocument, true));
  if (q.mortgageAvailable) c.push(eq(listings.mortgageAvailable, true));
  if (q.amenities?.length) c.push(arrayContains(listings.amenities, q.amenities));

  if (q.ownerType === 'BUSINESS') {
    c.push(sql`(${listings.agencyId} is not null or exists (select 1 from users u where u.id = ${listings.ownerId} and u.account_type = 'BUSINESS'))`);
  } else if (q.ownerType === 'OWNER') {
    c.push(sql`(${listings.agencyId} is null and exists (select 1 from users u where u.id = ${listings.ownerId} and u.account_type = 'INDIVIDUAL'))`);
  }
  if (q.hasPhotos) c.push(sql`exists (select 1 from listing_images li where li.listing_id = ${listings.id})`);
  if (q.verified) c.push(eq(listings.isVerified, true));
  if (q.agencyId) c.push(eq(listings.agencyId, q.agencyId));
  if (q.ownerId) c.push(eq(listings.ownerId, q.ownerId));

  if (q.bbox) {
    const b = parseBbox(q.bbox);
    if (b) {
      c.push(isNotNull(listings.lat), isNotNull(listings.lng));
      c.push(sql`${listings.lat} between ${b.minLat} and ${b.maxLat}`, sql`${listings.lng} between ${b.minLng} and ${b.maxLng}`);
    }
  }

  // Daily rent availability: no overlapping live booking and no blocked date in [checkIn, checkOut).
  if (q.guests != null) c.push(sql`(${listings.maxGuests} is null or ${listings.maxGuests} >= ${q.guests})`);
  if (q.checkIn && q.checkOut && q.checkOut > q.checkIn) {
    const nights = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000);
    const now = (opts.now ?? new Date()).toISOString();
    c.push(eq(listings.dealType, 'RENT_DAILY'));
    c.push(sql`(${listings.minNights} is null or ${listings.minNights} <= ${nights})`);
    c.push(sql`not exists (select 1 from bookings b where b.listing_id = ${listings.id}
      and (b.status = 'CONFIRMED' or (b.status = 'PENDING_PAYMENT' and (b.hold_expires_at is null or b.hold_expires_at > ${now}::timestamptz)))
      and b.check_in < ${q.checkOut}::date and b.check_out > ${q.checkIn}::date)`);
    c.push(sql`not exists (select 1 from listing_blocked_dates bd where bd.listing_id = ${listings.id}
      and bd.date >= ${q.checkIn}::date and bd.date < ${q.checkOut}::date)`);
  }
  return c;
}

export const searchWhere = (q: SearchFilters, opts?: { anyStatus?: boolean; now?: Date }) => {
  const c = buildSearchConditions(q, opts);
  return c.length ? and(...c) : undefined;
};

export function searchOrderBy(sort: ListingSearchParsed['sort'] = 'date_desc'): SQL[] {
  switch (sort) {
    case 'price_asc':
      return [asc(listings.price), desc(listings.bumpedAt)];
    case 'price_desc':
      return [desc(listings.price), desc(listings.bumpedAt)];
    case 'area_asc':
      return [asc(listings.area), desc(listings.bumpedAt)];
    case 'area_desc':
      return [desc(listings.area), desc(listings.bumpedAt)];
    default:
      return [desc(listings.bumpedAt), desc(listings.id)];
  }
}
