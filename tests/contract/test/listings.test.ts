/**
 * Listings lifecycle: create → moderation → approve → detail / phone / similar / stats → edit (re-moderation) →
 * status actions → report → delete; free quota → DRAFT + listing fee; daily-rent availability calendar.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { maskPhone } from '@evtap/shared';
import { v2 } from '../src/config';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import {
  activeListing, admin, approve, createListing, dailyBody, fund, localDay, newUser, randomUuid, saleBody, uniq, uploadId,
} from '../src/fixtures';
import { anon } from '../src/http';

describe('listings: create & moderation', () => {
  test('POST /listings → MyListing PENDING; hidden from the public until an admin approves', async () => {
    const owner = await newUser('Lister');
    const { listing, input } = await createListing(owner);
    assert.equal(listing.status, 'PENDING', 'moderation is enabled by default');
    assert.equal(listing.requiresPayment, false);
    assert.equal(listing.title, input.title);
    assert.equal(listing.dealType, 'SALE');
    assert.equal(listing.pricePeriod, 'TOTAL');
    assert.equal(listing.price, 150000);
    assert.equal(listing.currency, 'AZN');
    assert.equal(listing.country, 'AZ');
    assert.equal(listing.cityId, 'baku');
    assert.equal(listing.districtId, 'baku-yasamal');
    assert.equal(listing.metroId, 'elmlar-akademiyasi');
    assert.equal(listing.area, 72.5);
    assert.equal(listing.rooms, 2);
    assert.equal(listing.imagesCount, 1);
    assert.ok(listing.coverUrl, 'cover = first image');
    assert.equal(listing.lat, input.lat);
    assert.equal(listing.lng, input.lng);
    assert.equal(listing.isVip, false);
    assert.equal(listing.isBusiness, false);
    assert.equal(listing.publishedAt, null);
    assert.deepEqual(listing.promotions, []);

    err(await anon().get(`/listings/${listing.id}`), 404, 'NOT_FOUND');
    err(await (await newUser()).get(`/listings/${listing.id}`), 404, 'NOT_FOUND');
    const own = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(own.isOwner, true);
    assert.equal(own.status, 'PENDING');
    ok(await (await admin()).get(`/listings/${listing.id}`), D.ListingDetail);
    const marker = input.title.split(' ')[1];
    assert.equal(ok(await anon().get('/listings', { query: { q: marker } }), D.Paginated(D.ListingCard)).total, 0);

    const mine = ok(await owner.get('/me/listings', { query: { status: 'PENDING' } }), D.Paginated(D.MyListing));
    assert.deepEqual(mine.items.map((l) => l.id), [listing.id]);

    const approved = await approve(listing.id);
    assert.equal(approved.status, 'ACTIVE');
    assert.ok(approved.publishedAt);
    const found = ok(await anon().get('/listings', { query: { q: marker } }), D.Paginated(D.ListingCard));
    assert.deepEqual(found.items.map((l) => l.id), [listing.id]);
    const card = found.items[0];
    assert.equal(card.status, 'ACTIVE');
    assert.ok(card.coverUrl);
    const all = ok(await owner.get('/me/listings'), D.Paginated(D.MyListing));
    assert.equal(all.total, 1);
    assert.equal(all.items[0].status, 'ACTIVE');
    assert.ok(all.items[0].expiresAt, 'active listings expire');
  });

  test('price period follows the deal type (RENT_LONG → MONTH, RENT_DAILY → DAY)', async () => {
    const owner = await newUser();
    const { listing: long } = await createListing(owner, { dealType: 'RENT_LONG', price: 900 });
    assert.equal(long.pricePeriod, 'MONTH');
    const { listing: daily } = await createListing(owner, {}, 'daily');
    assert.equal(daily.pricePeriod, 'DAY');
  });

  test('validation: required fields, refinements, locations, images', async () => {
    const owner = await newUser();
    const img = await uploadId(owner);
    const base = saleBody(owner, [img]);
    const { rooms: _r, ...noRooms } = base;
    err(await owner.post('/listings', noRooms), 400, 'VALIDATION_ERROR');
    err(await owner.post('/listings', { ...base, floor: 10, totalFloors: 9 }), 400, 'VALIDATION_ERROR');
    err(await owner.post('/listings', dailyBody(owner, [img], { maxGuests: null })), 400, 'VALIDATION_ERROR');
    err(await owner.post('/listings', { ...base, title: 'short' }), 400, 'VALIDATION_ERROR');
    err(await owner.post('/listings', { ...base, imageIds: [] }), 400, 'VALIDATION_ERROR');
    err(await owner.post('/listings', { ...base, cityId: 'atlantis' }), 400, 'INVALID_LOCATION');
    err(await owner.post('/listings', { ...base, districtId: 'tbilisi-vake' }), 400, 'INVALID_LOCATION');
    const strangerImg = await uploadId(await newUser());
    err(await owner.post('/listings', { ...base, imageIds: [strangerImg] }), 400, 'INVALID_IMAGES');
    err(await owner.post('/listings', { ...base, imageIds: [randomUuid()] }), 400, 'INVALID_IMAGES');
    err(await anon().post('/listings', base), 401, 'UNAUTHORIZED');
  });
});

describe('listings: detail, phone, similar, stats', () => {
  test('GET /listings/:id → ListingDetail; views counted for visitors, not for the owner', async () => {
    const owner = await newUser('Detail Owner');
    const { listing, input } = await activeListing(owner);
    const d = ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(d.description, input.description);
    assert.equal(d.images.length, 1);
    assert.equal(d.images[0].order, 0);
    assert.ok(d.coverUrl, 'cover present');
    assert.deepEqual([...d.amenities].sort(), ['BALCONY', 'ELEVATOR']);
    assert.equal(d.repair, 'EURO');
    assert.equal(d.bathrooms, 1);
    assert.equal(d.yearBuilt, 2015);
    assert.equal(d.ceilingHeight, 3);
    assert.equal(d.contactName, 'Contract Owner');
    assert.equal(d.contactPhoneMasked, maskPhone(owner.phone!));
    assert.ok(!JSON.stringify(d).includes(owner.phone!), 'full phone never leaks to visitors');
    assert.equal(d.owner.id, owner.id);
    assert.equal(d.owner.name, 'Detail Owner');
    assert.equal(d.agency, null);
    assert.equal(d.isOwner, false);
    assert.equal(d.isFavorite, false);
    assert.deepEqual(d.promotions, [], 'promotions are owner-only');
    assert.equal(d.rejectionReason, null);
    const before = d.views;
    const again = ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(again.views, before + 1, 'each visit counts a view');
    const own = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(own.isOwner, true);
    const own2 = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(own2.views, own.views, 'owner visits are not counted');
  });

  test('POST /listings/:id/phone reveals the full number and counts a phone view', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const r = ok(await anon().post(`/listings/${listing.id}/phone`));
    assert.equal(r.phone, owner.phone);
    const stats = ok(await owner.get(`/listings/${listing.id}/stats`), D.ListingStats);
    assert.equal(stats.phoneViews, 1);
    err(await anon().post(`/listings/${randomUuid()}/phone`), 404, 'NOT_FOUND');
    const { listing: pending } = await createListing(await newUser());
    err(await anon().post(`/listings/${pending.id}/phone`), 404, 'NOT_FOUND');
  });

  test('GET /listings/:id/similar → ≤ 8 active cards of the same deal/property type and city, never itself', async () => {
    const price = 100_000 + Math.floor(Math.random() * 50_000);
    const a = await activeListing(await newUser(), { price, districtId: 'baku-sabail', metroId: null });
    const b = await activeListing(await newUser(), { price, districtId: 'baku-sabail', metroId: null });
    const sim = ok(await anon().get(`/listings/${a.listing.id}/similar`), D.ListingCard.array());
    assert.ok(sim.length <= 8);
    assert.ok(!sim.some((l) => l.id === a.listing.id), 'not itself');
    assert.ok(sim.every((l) => l.status === 'ACTIVE' && l.dealType === 'SALE' && l.propertyType === 'APARTMENT' && l.cityId === 'baku'));
    assert.ok(sim.some((l) => l.id === b.listing.id), 'closest listing (same district, same price) is similar');
    err(await anon().get(`/listings/${randomUuid()}/similar`), 404, 'NOT_FOUND');
  });

  test('GET /listings/:id/stats → owner only', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    await anon().get(`/listings/${listing.id}`);
    await anon().get(`/listings/${listing.id}`);
    const s = ok(await owner.get(`/listings/${listing.id}/stats`), D.ListingStats);
    assert.ok(s.views >= 2);
    assert.equal(s.favorites, 0);
    assert.equal(s.messages, 0);
    assert.ok(s.daily.length >= 1);
    const today = s.daily.find((x) => x.date === new Date().toISOString().slice(0, 10)) ?? s.daily[s.daily.length - 1];
    assert.ok(today.views >= 2, 'today counts the views');
    err(await (await newUser()).get(`/listings/${listing.id}/stats`), 403, 'FORBIDDEN');
    err(await anon().get(`/listings/${listing.id}/stats`), 401, 'UNAUTHORIZED');
  });

  test('GET /listings/:id/reviews → empty page for a fresh listing', async () => {
    const { listing } = await activeListing(await newUser(), {}, 'daily');
    const r = ok(await anon().get(`/listings/${listing.id}/reviews`), D.Paginated(D.Review));
    assert.equal(r.total, 0);
    assert.deepEqual(r.items, []);
  });
});

describe('listings: edit, actions, report, delete', () => {
  test('PATCH /listings/:id: partial update keeps other fields; ACTIVE goes back to moderation', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const upd = ok(await owner.patch(`/listings/${listing.id}`, { price: 140000, description: 'Yenilənmiş təsvir: tam təmirli, mebelli, metroya 5 dəqiqə.' }), D.MyListing);
    assert.equal(upd.price, 140000);
    assert.equal(upd.status, 'PENDING', 'edited ACTIVE listing is re-moderated');
    const d = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.deepEqual([...d.amenities].sort(), ['BALCONY', 'ELEVATOR'], 'fields not sent are untouched');
    assert.equal(d.rooms, 2);
    assert.equal(d.currency, 'AZN');
    assert.equal(d.hasDocument, true);
    await approve(listing.id);

    // changing the city drops district / metro that do not belong to it
    const moved = ok(await owner.patch(`/listings/${listing.id}`, { cityId: 'sumgait' }), D.MyListing);
    assert.equal(moved.cityId, 'sumgait');
    assert.equal(moved.districtId, null);
    assert.equal(moved.metroId, null);
    err(await owner.patch(`/listings/${listing.id}`, { districtId: 'baku-yasamal' }), 400, 'INVALID_LOCATION');
    err(await owner.patch(`/listings/${listing.id}`, { floor: 50 }), 400, 'VALIDATION_ERROR');
    err(await (await newUser()).patch(`/listings/${listing.id}`, { price: 1 }), 403, 'FORBIDDEN');
    err(await owner.patch(`/listings/${randomUuid()}`, { price: 1 }), 404, 'NOT_FOUND');
  });

  test('PATCH with imageIds replaces and reorders images (ids from POST /uploads)', async () => {
    const owner = await newUser();
    const first = await uploadId(owner);
    const second = await uploadId(owner);
    const { listing } = await createListing(owner, { imageIds: [first, second] });
    assert.equal(listing.imagesCount, 2);
    const d = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.deepEqual(d.images.map((i) => i.order), [0, 1]);
    const third = await uploadId(owner);
    const upd = ok(await owner.patch(`/listings/${listing.id}`, { imageIds: [third, first] }), D.MyListing);
    assert.equal(upd.imagesCount, 2);
    const d2 = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.deepEqual(d2.images.map((i) => i.order), [0, 1]);
    assert.equal(d2.images[1].url, d.images[0].url, 'first upload moved to position 1');
    assert.ok(!d2.images.some((i) => i.url === d.images[1].url), 'second upload removed');
    assert.ok(upd.coverUrl, 'cover follows the first image');
  });

  test('POST /listings/:id/actions: MARK_SOLD, RESTORE, ARCHIVE, RENEW and invalid transitions', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const renewed = ok(await owner.post(`/listings/${listing.id}/actions`, { action: 'RENEW' }), D.MyListing);
    assert.equal(renewed.status, 'ACTIVE');
    assert.ok(renewed.expiresAt);
    const sold = ok(await owner.post(`/listings/${listing.id}/actions`, { action: 'MARK_SOLD' }), D.MyListing);
    assert.equal(sold.status, 'SOLD');
    err(await anon().get(`/listings/${listing.id}`), 404, 'NOT_FOUND');
    err(await owner.post(`/listings/${listing.id}/actions`, { action: 'MARK_SOLD' }), 400, 'INVALID_STATUS_TRANSITION');
    const restored = ok(await owner.post(`/listings/${listing.id}/actions`, { action: 'RESTORE' }), D.MyListing);
    assert.equal(restored.status, 'PENDING');
    const archived = ok(await owner.post(`/listings/${listing.id}/actions`, { action: 'ARCHIVE' }), D.MyListing);
    assert.equal(archived.status, 'ARCHIVED');
    err(await owner.post(`/listings/${listing.id}/actions`, { action: 'ARCHIVE' }), 400, 'INVALID_STATUS_TRANSITION');
    err(await owner.post(`/listings/${listing.id}/actions`, { action: 'RENEW' }), 400, 'INVALID_STATUS_TRANSITION');
    err(await owner.patch(`/listings/${listing.id}`, { price: 1000 }), 400, 'INVALID_STATUS');
    err(await owner.post(`/listings/${listing.id}/actions`, { action: 'EXPLODE' }), 400, 'VALIDATION_ERROR');
    err(await (await newUser()).post(`/listings/${listing.id}/actions`, { action: 'ARCHIVE' }), 403, 'FORBIDDEN');
  });

  test('POST /listings/:id/report (anonymous or signed in) → { ok }; admins see the report', async () => {
    const { listing } = await activeListing(await newUser());
    okTrue(await anon().post(`/listings/${listing.id}/report`, { reason: 'FAKE' }));
    const reporter = await newUser('Reporter');
    okTrue(await reporter.post(`/listings/${listing.id}/report`, { reason: 'WRONG_PRICE', comment: 'Qiymət düz deyil' }));
    err(await anon().post(`/listings/${listing.id}/report`, { reason: 'BORING' }), 400, 'VALIDATION_ERROR');
    err(await anon().post(`/listings/${randomUuid()}/report`, { reason: 'FAKE' }), 404, 'NOT_FOUND');
    const a = await admin();
    const reports = ok(await a.get('/admin/reports', { query: { status: 'OPEN', pageSize: 20 } }), D.Paginated(D.ListingReport));
    assert.ok(reports.items.every((r) => r.status === 'OPEN'));
    const mine = ok(await a.get(`/admin/listings/${listing.id}`), D.AdminListingDetail).reports;
    assert.equal(mine.length, 2);
    const signed = mine.find((r) => r.reason === 'WRONG_PRICE')!;
    assert.deepEqual(signed.reporter, { id: reporter.id, name: 'Reporter' });
    assert.equal(signed.comment, 'Qiymət düz deyil');
    assert.equal(mine.find((r) => r.reason === 'FAKE')!.reporter, null);
    assert.ok(mine.every((r) => r.status === 'OPEN' && r.listingId === listing.id));
  });

  test('DELETE /listings/:id → { ok } (soft delete = ARCHIVED)', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    err(await (await newUser()).del(`/listings/${listing.id}`), 403, 'FORBIDDEN');
    okTrue(await owner.del(`/listings/${listing.id}`));
    err(await anon().get(`/listings/${listing.id}`), 404, 'NOT_FOUND');
    const own = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(own.status, 'ARCHIVED');
    const archived = ok(await owner.get('/me/listings', { query: { status: 'ARCHIVED' } }), D.Paginated(D.MyListing));
    assert.ok(archived.items.some((l) => l.id === listing.id));
  });
});

describe('listings: free quota and listing fee', () => {
  test('3rd sale listing in 30 days → DRAFT + requiresPayment; LISTING_FEE paid by wallet → PENDING', async () => {
    const owner = await newUser();
    const me0 = ok(await owner.get('/auth/me'), D.Me);
    assert.ok(me0.quota.freeLimit >= 1);
    for (let i = 0; i < me0.quota.freeLimit; i++) {
      const { listing } = await createListing(owner);
      assert.equal(listing.status, 'PENDING');
      assert.equal(listing.requiresPayment, false);
    }
    // daily rent is free (commission model) and does not consume the quota
    const { listing: daily } = await createListing(owner, {}, 'daily');
    assert.equal(daily.status, 'PENDING');
    const me1 = ok(await owner.get('/auth/me'), D.Me);
    assert.equal(me1.quota.used, me0.quota.freeLimit);
    assert.equal(me1.quota.remaining, 0);

    const { listing: draft } = await createListing(owner);
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.requiresPayment, true);
    err(await (await admin()).post(`/admin/listings/${draft.id}/approve`), 400, 'LISTING_NOT_PAID');
    err(await anon().get(`/listings/${draft.id}`), 404, 'NOT_FOUND');

    err(await owner.post('/checkout', { purpose: 'LISTING_FEE', listingId: draft.id, method: 'WALLET' }), 402, 'INSUFFICIENT_FUNDS');
    await fund(owner, me1.quota.listingFee);
    const pay = ok(await owner.post('/checkout', { purpose: 'LISTING_FEE', listingId: draft.id, method: 'WALLET' }), D.CheckoutResponse);
    assert.equal(pay.status, 'SUCCEEDED');
    assert.equal(pay.amount, me1.quota.listingFee);
    assert.equal(pay.paymentUrl, null);
    const paid = ok(await owner.get('/me/listings', { query: { status: 'PENDING' } }), D.Paginated(D.MyListing));
    const after = paid.items.find((l) => l.id === draft.id);
    assert.ok(after, 'paid DRAFT moves to moderation');
    assert.equal(after.requiresPayment, false);
    // paying twice is refused
    err(await owner.post('/checkout', { purpose: 'LISTING_FEE', listingId: draft.id, method: 'WALLET' }), 409, 'LISTING_STATUS_INVALID');
  });
});

describe('listings: daily-rent availability calendar', () => {
  test('PUT /listings/:id/availability (owner) replaces blocked dates; GET is public with from/to', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner, {}, 'daily');
    const dates = [localDay(20), localDay(21), localDay(25)];
    const set = ok(await owner.put(`/listings/${listing.id}/availability`, { blockedDates: [...dates, localDay(20)] }), D.Availability);
    assert.equal(set.listingId, listing.id);
    assert.deepEqual(set.blockedDates, dates, 'sorted, de-duplicated');
    assert.deepEqual(set.bookedRanges, []);

    const window = ok(await anon().get(`/listings/${listing.id}/availability`, { query: { from: localDay(21), to: localDay(24) } }), D.Availability);
    assert.deepEqual(window.blockedDates, [localDay(21)]);

    const replaced = ok(await owner.put(`/listings/${listing.id}/availability`, { blockedDates: [localDay(30)] }), D.Availability);
    assert.deepEqual(replaced.blockedDates, [localDay(30)]);

    const quote = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(29), checkOut: localDay(31), guests: 1 }), D.BookingQuote);
    assert.equal(quote.available, false, 'blocked date inside the stay');
    assert.ok(quote.unavailableReason);

    err(await (await newUser()).put(`/listings/${listing.id}/availability`, { blockedDates: [] }), 403, 'FORBIDDEN');
    err(await owner.put(`/listings/${listing.id}/availability`, { blockedDates: ['2026/01/01'] }), 400, 'VALIDATION_ERROR');
    const { listing: sale } = await activeListing(owner);
    err(await owner.put(`/listings/${sale.id}/availability`, { blockedDates: [localDay(5)] }), 400, 'NOT_DAILY_RENT');
    err(await anon().get(`/listings/${randomUuid()}/availability`), 404, 'NOT_FOUND');
  });
});

describe('listings: v2 fields', () => {
  test('[v2] ListingDetail.contactPhone: full number for the owner and admins, null for everybody else', v2, async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const own = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail.extend({ contactPhone: D.ListingDetail.shape.contactName.nullable() }));
    assert.equal(own.contactPhone, owner.phone);
    const adm = ok(await (await admin()).get(`/listings/${listing.id}`));
    assert.equal(adm.contactPhone, owner.phone);
    const pub = ok(await anon().get(`/listings/${listing.id}`));
    assert.ok('contactPhone' in pub, 'contactPhone key is always present');
    assert.equal(pub.contactPhone, null);
    const other = ok(await (await newUser()).get(`/listings/${listing.id}`));
    assert.equal(other.contactPhone, null);
  });

  test('[v2] ListingImage.uploadId is the Upload id and can be sent back in imageIds', v2, async () => {
    const owner = await newUser();
    const img = await uploadId(owner);
    const { listing } = await createListing(owner, { imageIds: [img] });
    const d = ok(await owner.get(`/listings/${listing.id}`));
    const images = D.ListingImageV2.array().parse(d.images);
    assert.equal(images[0].uploadId, img);
    const extra = await uploadId(owner);
    ok(await owner.patch(`/listings/${listing.id}`, { imageIds: [extra, images[0].uploadId!] }), D.MyListing);
    const d2 = ok(await owner.get(`/listings/${listing.id}`));
    assert.deepEqual(D.ListingImageV2.array().parse(d2.images).map((i) => i.uploadId), [extra, img]);
  });

  test('search cards never contain the contact phone', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner, { title: `Contract ${uniq()} phone leak check` });
    const page = await anon().get('/listings', { query: { ownerId: owner.id } });
    assert.ok(!page.text.includes(owner.phone!), 'search cards never contain the contact phone');
    assert.ok(page.text.includes(listing.id));
  });
});
