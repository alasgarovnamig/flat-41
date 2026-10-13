/**
 * Marketplace tests.
 *  - Unit: the listing search SQL builder (no DB needed, rendered with drizzle's mock driver).
 *  - Integration: create listing → admin approve → search finds it, against a running API with seeded admin.
 *    Uses API_URL (default http://localhost:4000); skipped when the API is not reachable.
 * Run: pnpm --filter @evtap/api test   (API_URL=http://localhost:4001 for a non-default port)
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import sharp from 'sharp';
import { listingSearchSchema } from '@evtap/shared';
import * as schema from '../src/db/schema';
import { cardColumns } from '../src/modules/listings/listing.mapper';
import { searchOrderBy, searchWhere } from '../src/modules/listings/listing-search';

const db = drizzle.mock({ schema });
const render = (query: Record<string, unknown>) => {
  const q = listingSearchSchema.parse(query);
  return db.select(cardColumns).from(schema.listings).where(searchWhere(q)).orderBy(...searchOrderBy(q.sort)).toSQL();
};

describe('listing search builder', () => {
  test('defaults to ACTIVE listings ordered by bumpedAt desc', () => {
    const { sql, params } = render({});
    assert.match(sql, /"listings"\."status" = \$1/);
    assert.equal(params[0], 'ACTIVE');
    assert.match(sql, /order by "listings"\."bumped_at" desc/);
  });

  test('rooms "5" means 5+', () => {
    const { sql, params } = render({ rooms: '2,5' });
    assert.match(sql, /"listings"\."rooms" in \(\$\d+\) or "listings"\."rooms" >= \$\d+/);
    assert.ok(params.includes(2) && params.includes(5));
  });

  test('amenities must all be present (@>), csv arrays become IN lists', () => {
    const { sql } = render({ amenities: 'BALCONY,ELEVATOR', districtId: 'baku-yasamal,baku-nasimi' });
    assert.match(sql, /"listings"\."amenities" @> \$\d+/);
    assert.match(sql, /"listings"\."district_id" in \(\$\d+, \$\d+\)/);
  });

  test('q searches title / description / address with escaped ILIKE', () => {
    const { sql, params } = render({ q: '50%_off' });
    assert.match(sql, /"listings"\."title" ilike/);
    assert.ok(params.includes('%50\\%\\_off%'));
  });

  test('daily availability excludes overlapping bookings and blocked dates', () => {
    const { sql } = render({ checkIn: '2026-11-01', checkOut: '2026-11-04', guests: 3 });
    assert.match(sql, /not exists \(select 1 from bookings b where b\.listing_id = "listings"\."id"/);
    assert.match(sql, /not exists \(select 1 from listing_blocked_dates bd/);
    assert.match(sql, /"listings"\."max_guests" >= \$\d+/);
  });

  test('ownerType, floors, bbox and sorting', () => {
    const { sql } = render({ ownerType: 'OWNER', notFirstFloor: 'true', notLastFloor: 'true', bbox: '49.7,40.3,50.2,40.6', sort: 'price_asc' });
    assert.match(sql, /"listings"\."agency_id" is null and exists \(select 1 from users u/);
    assert.match(sql, /"listings"\."floor" > 1/);
    assert.match(sql, /"listings"\."floor" < "listings"\."total_floors"/);
    assert.match(sql, /"listings"\."lat" between/);
    assert.match(sql, /order by "listings"\."price" asc/);
  });

  test('card subqueries reference the outer listing explicitly', () => {
    const { sql } = render({});
    assert.match(sql, /from listing_images li where li\.listing_id = "listings"\."id" order by/);
  });
});

// ───────────────────────────── Integration ─────────────────────────────
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@evtap.az';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin12345!';

async function call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

describe('marketplace flow (live API)', () => {
  let reachable = false;
  before(async () => {
    reachable = await fetch(API + '/health').then((r) => r.ok, () => false);
  });

  test('create listing → admin approve → search finds it', async (t) => {
    if (!reachable) return t.skip(`API not reachable at ${API}`);
    const phone = '+99455' + String(Math.floor(1_000_000 + Math.random() * 8_999_999));
    await call('POST', '/auth/otp/request', { body: { phone } });
    const login = await call('POST', '/auth/otp/verify', { body: { phone, code: process.env.OTP_DEV_CODE ?? '111111', name: 'Test User' } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const token: string = login.data.accessToken;

    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#0E7C66' } }).jpeg().toBuffer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'photo.jpg');
    const up = await call('POST', '/uploads', { token, form });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.match(up.data.thumbUrl, /_thumb\.webp$/);

    const marker = `T${Date.now().toString(36)}`;
    const created = await call('POST', '/listings', {
      token,
      body: {
        dealType: 'SALE', propertyType: 'APARTMENT', buildingType: 'NEW', title: `Test ${marker} 2 otaqlı mənzil`,
        description: 'Avtomatik test üçün yaradılmış elan — metroya yaxın, işıqlı mənzil.', price: 123456, cityId: 'baku',
        districtId: 'baku-yasamal', metroId: 'elmlar-akademiyasi', area: 70, rooms: 2, floor: 3, totalFloors: 9,
        amenities: ['BALCONY'], contactName: 'Test', contactPhone: phone, imageIds: [up.data.id],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.pricePeriod, 'TOTAL');
    const id: string = created.data.id;

    if (created.data.status === 'PENDING') {
      const hidden = await call('GET', `/listings?q=${marker}`);
      assert.equal(hidden.data.total, 0, 'pending listing must not be searchable');
      const admin = await call('POST', '/auth/login', { body: { login: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
      assert.equal(admin.status, 200, 'admin login (run db:seed first)');
      const approved = await call('POST', `/admin/listings/${id}/approve`, { token: admin.data.accessToken });
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      assert.equal(approved.data.status, 'ACTIVE');
    }

    const found = await call('GET', `/listings?q=${marker}&rooms=2&metroId=elmlar-akademiyasi&amenities=BALCONY&priceMax=200000`);
    assert.equal(found.status, 200);
    assert.equal(found.data.total, 1);
    assert.equal(found.data.items[0].id, id);
    assert.ok(found.data.items[0].coverUrl, 'card has a cover image');

    const detail = await call('GET', `/listings/${id}`);
    assert.equal(detail.data.contactPhoneMasked.endsWith('** **'), true);

    // owner edit must not reset fields that were not sent
    const patched = await call('PATCH', `/listings/${id}`, { token, body: { price: 120000 } });
    assert.equal(patched.status, 200);
    const afterPatch = await call('GET', `/listings/${id}`, { token });
    assert.deepEqual(afterPatch.data.amenities, ['BALCONY']);
    assert.equal(afterPatch.data.price, 120000);
    const mine = await call('GET', `/me/listings`, { token });
    assert.ok(mine.data.items.some((l: { id: string }) => l.id === id));

    const removed = await call('DELETE', `/listings/${id}`, { token });
    assert.deepEqual(removed.data, { ok: true });
    await call('DELETE', '/users/me', { token });
  });
});
