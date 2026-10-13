/**
 * GET /listings filters & sorting, GET /listings/map (bbox), GET /listings/featured, daily availability filter.
 * Every listing created here carries a unique marker in its title and a unique coordinate, so assertions are exact
 * even against a shared database (`q=<marker>` / tiny bbox).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { v2 } from '../src/config';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, admin, bboxAround, localDay, newUser, uniq } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

type Card = { id: string };
const ids = (xs: Card[]) => xs.map((x) => x.id).sort();

describe('listing search', () => {
  const marker = uniq('S');
  let owner1: Api;
  let owner2: Api;
  const L: Record<'cheap' | 'big' | 'house' | 'daily', any> = {} as any;
  const search = async (query: Record<string, any>) =>
    ok(await anon().get('/listings', { query: { q: marker, pageSize: 60, ...query } }), D.Paginated(D.ListingCard));

  before(async () => {
    owner1 = await newUser('Search Owner 1');
    owner2 = await newUser('Search Owner 2');
    L.cheap = (await activeListing(owner1, {
      title: `Contract ${marker} ucuz mənzil`, price: 100000, area: 50, rooms: 2, floor: 1, totalFloors: 9, repair: 'EURO',
      amenities: ['BALCONY', 'ELEVATOR', 'PARKING'], hasDocument: true, mortgageAvailable: true, buildingType: 'SECONDARY',
      districtId: 'baku-nasimi', metroId: '28-may',
    })).listing;
    L.big = (await activeListing(owner1, {
      title: `Contract ${marker} böyük mənzil`, price: 300000, currency: 'USD', area: 150, rooms: 6, floor: 9, totalFloors: 9,
      repair: 'NONE', amenities: ['BALCONY'], hasDocument: false, mortgageAvailable: false, buildingType: 'NEW',
      districtId: 'baku-yasamal', metroId: 'elmlar-akademiyasi',
    })).listing;
    L.house = (await activeListing(owner2, {
      title: `Contract ${marker} həyət evi`, dealType: 'RENT_LONG', propertyType: 'HOUSE', buildingType: null, price: 2000, area: 200,
      landArea: 6, rooms: 5, floor: null, totalFloors: 2, repair: 'DESIGNER', amenities: ['GARDEN', 'BALCONY'], cityId: 'sumgait',
      districtId: 'sumgait-center', metroId: null,
    })).listing;
    L.daily = (await activeListing(owner2, {
      title: `Contract ${marker} günlük mənzil`, price: 60, area: 40, rooms: 1, floor: 4, totalFloors: 5, maxGuests: 2, minNights: 2,
      amenities: ['WIFI'], repair: 'COSMETIC',
    }, 'daily')).listing;
  });

  test('q matches the marker; ACTIVE only; card shape', async () => {
    const r = await search({});
    assert.deepEqual(ids(r.items), ids(Object.values(L)));
    assert.equal(r.total, 4);
    assert.ok(r.items.every((c) => c.status === 'ACTIVE'));
  });

  test('dealType, propertyType (csv), buildingType, cityId, districtId / metroId (csv), currency', async () => {
    assert.deepEqual(ids((await search({ dealType: 'SALE' })).items), ids([L.cheap, L.big]));
    assert.deepEqual(ids((await search({ dealType: 'RENT_DAILY' })).items), ids([L.daily]));
    assert.deepEqual(ids((await search({ propertyType: 'HOUSE,LAND' })).items), ids([L.house]));
    assert.deepEqual(ids((await search({ buildingType: 'SECONDARY' })).items), ids([L.cheap]));
    assert.deepEqual(ids((await search({ cityId: 'sumgait' })).items), ids([L.house]));
    assert.deepEqual(ids((await search({ districtId: 'baku-nasimi,sumgait-center' })).items), ids([L.cheap, L.house]));
    assert.deepEqual(ids((await search({ metroId: 'elmlar-akademiyasi' })).items), ids([L.big, L.daily]));
    assert.deepEqual(ids((await search({ currency: 'USD' })).items), ids([L.big]));
    assert.deepEqual(ids((await search({ country: 'AZ' })).items), ids(Object.values(L)));
    assert.equal((await search({ country: 'GE' })).total, 0);
  });

  test('price / area ranges, floors, notFirstFloor / notLastFloor', async () => {
    assert.deepEqual(ids((await search({ priceMin: 1000, priceMax: 200000 })).items), ids([L.cheap, L.house]));
    assert.deepEqual(ids((await search({ areaMin: 100 })).items), ids([L.big, L.house]));
    assert.deepEqual(ids((await search({ areaMax: 45 })).items), ids([L.daily]));
    assert.deepEqual(ids((await search({ floorMin: 4, floorMax: 9 })).items), ids([L.big, L.daily]));
    assert.deepEqual(ids((await search({ notFirstFloor: true, dealType: 'SALE' })).items), ids([L.big]));
    assert.deepEqual(ids((await search({ notLastFloor: true })).items), ids([L.cheap, L.daily]));
  });

  test('rooms csv; "5" means 5 and more', async () => {
    assert.deepEqual(ids((await search({ rooms: '1,2' })).items), ids([L.cheap, L.daily]));
    assert.deepEqual(ids((await search({ rooms: '5' })).items), ids([L.big, L.house]), 'rooms=5 matches 5 and 6 rooms');
    assert.deepEqual(ids((await search({ rooms: '2,5' })).items), ids([L.cheap, L.big, L.house]));
  });

  test('repair csv, hasDocument, mortgageAvailable, amenities (all required), hasPhotos, verified', async () => {
    assert.deepEqual(ids((await search({ repair: 'EURO,DESIGNER' })).items), ids([L.cheap, L.house]));
    assert.deepEqual(ids((await search({ hasDocument: true, dealType: 'SALE' })).items), ids([L.cheap]));
    assert.deepEqual(ids((await search({ mortgageAvailable: 'true', dealType: 'SALE' })).items), ids([L.cheap]));
    assert.deepEqual(ids((await search({ amenities: 'BALCONY' })).items), ids([L.cheap, L.big, L.house]));
    assert.deepEqual(ids((await search({ amenities: 'BALCONY,PARKING' })).items), ids([L.cheap]), 'every amenity must be present');
    assert.deepEqual(ids((await search({ hasPhotos: true })).items), ids(Object.values(L)));
    assert.equal((await search({ verified: true })).total, 0);
    err(await anon().get('/listings', { query: { amenities: 'JACUZZI_ON_MARS' } }), 400, 'VALIDATION_ERROR');
  });

  test('ownerId and ownerType (OWNER = private individuals)', async () => {
    assert.deepEqual(ids((await search({ ownerId: owner2.id })).items), ids([L.house, L.daily]));
    assert.deepEqual(ids((await search({ ownerType: 'OWNER' })).items), ids(Object.values(L)));
    assert.equal((await search({ ownerType: 'BUSINESS' })).total, 0);
  });

  test('sorting: price_asc / price_desc / area_asc / area_desc; default = newest bump first', async () => {
    const order = async (sort?: string) => (await search(sort ? { sort } : {})).items.map((c) => c.id);
    assert.deepEqual(await order('price_asc'), [L.daily.id, L.house.id, L.cheap.id, L.big.id]);
    assert.deepEqual(await order('price_desc'), [L.big.id, L.cheap.id, L.house.id, L.daily.id]);
    assert.deepEqual(await order('area_asc'), [L.daily.id, L.cheap.id, L.big.id, L.house.id]);
    assert.deepEqual(await order('area_desc'), [L.house.id, L.big.id, L.cheap.id, L.daily.id]);
    const def = (await search({})).items;
    const bumped = def.map((c) => Date.parse(c.bumpedAt));
    assert.deepEqual(bumped, [...bumped].sort((a, b) => b - a), 'default sort = bumpedAt desc');
  });

  test('pagination over a filtered result', async () => {
    const p1 = await search({ pageSize: 3, page: 1, sort: 'price_asc' });
    const p2 = await search({ pageSize: 3, page: 2, sort: 'price_asc' });
    assert.equal(p1.total, 4);
    assert.equal(p2.total, 4);
    assert.equal(p1.items.length, 3);
    assert.deepEqual(p2.items.map((c) => c.id), [L.big.id]);
  });

  test('daily availability filter: checkIn / checkOut / guests exclude blocked, too-short and too-small stays', async () => {
    const q = (extra: Record<string, unknown>) => search({ dealType: 'RENT_DAILY', ...extra });
    assert.deepEqual(ids((await q({ checkIn: localDay(40), checkOut: localDay(43), guests: 2 })).items), ids([L.daily]));
    assert.equal((await q({ checkIn: localDay(40), checkOut: localDay(43), guests: 3 })).total, 0, 'maxGuests');
    assert.equal((await q({ checkIn: localDay(40), checkOut: localDay(41) })).total, 0, 'minNights = 2');
    ok(await owner2.put(`/listings/${L.daily.id}/availability`, { blockedDates: [localDay(42)] }), D.Availability);
    assert.equal((await q({ checkIn: localDay(40), checkOut: localDay(43) })).total, 0, 'blocked date inside the stay');
    assert.equal((await q({ checkIn: localDay(43), checkOut: localDay(45) })).total, 1, 'stay after the blocked date');
    assert.equal((await q({ checkIn: localDay(40), checkOut: localDay(42) })).total, 1, 'check-out day may be blocked');
    err(await anon().get('/listings', { query: { checkIn: '2026-13-45x' } }), 400, 'VALIDATION_ERROR');
  });

  test('GET /listings?bbox= and GET /listings/map (bbox required) → MapPoint[]', async () => {
    const box = bboxAround(L.cheap);
    const r = ok(await anon().get('/listings', { query: { bbox: box } }), D.Paginated(D.ListingCard));
    assert.deepEqual(r.items.map((c) => c.id), [L.cheap.id]);
    const points = ok(await anon().get('/listings/map', { query: { bbox: box } }), D.MapPoint.array());
    assert.equal(points.length, 1);
    const p = points[0];
    assert.equal(p.id, L.cheap.id);
    assert.equal(p.lat, L.cheap.lat);
    assert.equal(p.lng, L.cheap.lng);
    assert.equal(p.price, 100000);
    assert.equal(p.currency, 'AZN');
    assert.equal(p.pricePeriod, 'TOTAL');
    // map honours the other filters too
    assert.equal(ok(await anon().get('/listings/map', { query: { bbox: box, dealType: 'RENT_LONG' } }), D.MapPoint.array()).length, 0);
    err(await anon().get('/listings/map'), 400, 'VALIDATION_ERROR');
    err(await anon().get('/listings/map', { query: { bbox: 'not,a,box' } }), 400, 'VALIDATION_ERROR');
  });

  test('[v2] MapPoint carries title and coverUrl', v2, async () => {
    const points = ok(await anon().get('/listings/map', { query: { bbox: bboxAround(L.big) } }), D.MapPointV2.array());
    assert.equal(points.length, 1);
    assert.equal(points[0].title, L.big.title);
    assert.ok(points[0].coverUrl, 'listing has a photo → coverUrl');
  });
});

describe('featured listings', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  after(async () => {
    for (const c of cleanup) await c().catch(() => undefined);
  });

  test('GET /listings/featured?kind=vip|premium lists active promoted listings (filters: dealType, cityId, limit)', async () => {
    const owner = await newUser();
    const a = await admin();
    // RENT_LONG offices in Kobuleti: practically nobody else promotes those
    const over = { dealType: 'RENT_LONG', propertyType: 'OFFICE', rooms: 3, cityId: 'kobuleti', districtId: null, metroId: null, price: 777 };
    const vip = (await activeListing(owner, over)).listing;
    const prem = (await activeListing(owner, over)).listing;
    cleanup.push(() => owner.del(`/listings/${vip.id}`), () => owner.del(`/listings/${prem.id}`));
    const promotedVip = ok(await a.post(`/admin/listings/${vip.id}/promote`, { serviceCode: 'VIP_7' }), D.AdminListing);
    assert.equal(promotedVip.isVip, true);
    ok(await a.post(`/admin/listings/${prem.id}/promote`, { serviceCode: 'PREMIUM_7' }), D.AdminListing);

    const vips = ok(await anon().get('/listings/featured', { query: { kind: 'vip', dealType: 'RENT_LONG', cityId: 'kobuleti', limit: 50 } }), D.ListingCard.array());
    assert.ok(vips.some((c) => c.id === vip.id), 'VIP listing featured');
    assert.ok(!vips.some((c) => c.id === prem.id), 'premium-only listing is not in the VIP block');
    assert.ok(vips.every((c) => c.isVip && c.status === 'ACTIVE' && c.dealType === 'RENT_LONG' && c.cityId === 'kobuleti'));
    const prems = ok(await anon().get('/listings/featured', { query: { kind: 'premium', cityId: 'kobuleti', limit: 50 } }), D.ListingCard.array());
    assert.ok(prems.some((c) => c.id === prem.id));
    assert.ok(prems.every((c) => c.isPremium));
    const one = ok(await anon().get('/listings/featured', { query: { kind: 'vip', limit: 1 } }), D.ListingCard.array());
    assert.ok(one.length <= 1);
    err(await anon().get('/listings/featured', { query: { kind: 'gold' } }), 400, 'VALIDATION_ERROR');

    // archived listings leave the featured block
    okTrue(await owner.del(`/listings/${vip.id}`));
    const after = ok(await anon().get('/listings/featured', { query: { kind: 'vip', dealType: 'RENT_LONG', cityId: 'kobuleti', limit: 50 } }), D.ListingCard.array());
    assert.ok(!after.some((c) => c.id === vip.id));
  });
});
