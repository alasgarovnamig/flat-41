/**
 * Test fixtures built ONLY from public API calls: users (phone OTP / e-mail registration), admin & moderator sessions,
 * uploads, listings in any state, wallet funding. Every test creates its own data, so the suite is re-runnable and
 * parallel-safe against a shared database.
 */
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { ADMIN_EMAIL, ADMIN_PASSWORD, OTP_CODE } from './config';
import * as D from './dto';
import { ok, shape } from './expect';
import { Api } from './http';

// ───────────── identifiers ─────────────

/** Unique alphanumeric marker (safe inside titles and `q=` searches). */
export const uniq = (prefix = 'K') => `${prefix}${Date.now().toString(36)}${randomInt(36 ** 5).toString(36)}`.toUpperCase();
export const randomPhone = () => `+99450${randomInt(1_000_000, 10_000_000)}`;
export const randomEmail = () => `contract.${uniq('u').toLowerCase()}@example.test`;
export const randomUuid = () => crypto.randomUUID();

/** A random coordinate in Baku (6 decimals) — practically unique, so a tiny bbox around it isolates one listing. */
export const randomCoords = () => ({
  lat: Math.round((40.3 + Math.random() * 0.2) * 1e6) / 1e6,
  lng: Math.round((49.7 + Math.random() * 0.3) * 1e6) / 1e6,
});
export const bboxAround = (p: { lat: number; lng: number }, d = 0.00005) => `${p.lng - d},${p.lat - d},${p.lng + d},${p.lat + d}`;

/** Calendar date in Baku / Tbilisi (UTC+4) `n` days from today, as YYYY-MM-DD. */
export const localDay = (n = 0) => new Date(Date.now() + 4 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────── sessions ─────────────

function applyAuth(api: Api, body: any) {
  api.token = body.accessToken;
  api.refreshToken = body.refreshToken;
  api.user = body.user;
  return api;
}

/** New user via phone OTP (each user gets its own fake client IP, so per-IP OTP throttling never trips). */
export async function newUser(name = 'Contract User'): Promise<Api> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const api = new Api();
    const phone = randomPhone();
    const req = await api.post('/auth/otp/request', { phone });
    const sent = ok(req, D.OtpRequestResponse);
    const res = await api.post('/auth/otp/verify', { phone, code: sent.devCode ?? OTP_CODE, name });
    const body = ok(res, D.AuthResponse);
    if (body.isNew === false) continue; // phone collision with an existing account — pick another number
    api.phone = phone;
    return applyAuth(api, body);
  }
  throw new Error('could not create a fresh OTP user');
}

/** New user via e-mail + password registration (needed when the test must log in again later). */
export async function newPasswordUser(name = 'Contract Password User', withPhone = true): Promise<Api> {
  const api = new Api();
  const email = randomEmail();
  const password = `Pw-${uniq('p')}`;
  const phone = withPhone ? randomPhone() : undefined;
  const res = await api.post('/auth/register', { name, email, password, ...(phone ? { phone } : {}) });
  const body = ok(res, D.AuthResponse);
  api.email = email;
  api.password = password;
  api.phone = phone;
  return applyAuth(api, body);
}

/** Logs in again with e-mail + password (picks up role / account changes). */
export async function relogin(api: Api): Promise<Api> {
  assert.ok(api.email && api.password, 'relogin needs a password user');
  const res = await api.anon().post('/auth/login', { login: api.email, password: api.password });
  return applyAuth(api, ok(res, D.AuthResponse));
}

let adminSession: Promise<Api> | undefined;
/** Seeded ADMIN (ADMIN_EMAIL / ADMIN_PASSWORD), one session per test process. */
export function admin(): Promise<Api> {
  return (adminSession ??= (async () => {
    const api = new Api();
    const res = await api.post('/auth/login', { login: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assert.equal(res.status, 200, `admin login failed (seed the database and set ADMIN_EMAIL/ADMIN_PASSWORD): ${res.text}`);
    const body = shape(D.AuthResponse, res.body);
    assert.equal(body.user.role, 'ADMIN', 'ADMIN_EMAIL must belong to a user with role ADMIN');
    return applyAuth(api, body);
  })());
}

let moderatorSession: Promise<Api> | undefined;
/** A fresh MODERATOR: registered user promoted by the admin, then logged in again. */
export function moderator(): Promise<Api> {
  return (moderatorSession ??= (async () => {
    const api = await newPasswordUser('Contract Moderator');
    const a = await admin();
    ok(await a.patch(`/admin/users/${api.id}`, { role: 'MODERATOR' }), D.AdminUser);
    await relogin(api);
    assert.equal(api.user.role, 'MODERATOR');
    return api;
  })());
}

/** Credits the user's wallet through the admin wallet-adjust endpoint. */
export async function fund(api: Api, amount: number) {
  const a = await admin();
  return ok(await a.post(`/admin/users/${api.id}/wallet-adjust`, { amount, reason: 'contract test funding' }), D.Wallet);
}

export async function wallet(api: Api) {
  return ok(await api.get('/wallet'), D.Wallet);
}

// ───────────── uploads ─────────────

export async function jpeg(width = 1200, height = 900, color = '#2f6f5e') {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();
}

export async function upload(api: Api, opts: { width?: number; height?: number; buffer?: Buffer; mime?: string; filename?: string } = {}) {
  const buf = opts.buffer ?? (await jpeg(opts.width, opts.height));
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: opts.mime ?? 'image/jpeg' }), opts.filename ?? 'photo.jpg');
  return api.call('POST', '/uploads', { form });
}

export async function uploadId(api: Api): Promise<string> {
  return ok(await upload(api), D.Upload).id;
}

// ───────────── listings ─────────────

export function saleBody(owner: Api, imageIds: string[], over: Record<string, unknown> = {}) {
  return {
    dealType: 'SALE',
    propertyType: 'APARTMENT',
    buildingType: 'NEW',
    title: `Contract ${uniq()} 2 otaqlı mənzil`,
    description: 'Avtomatik kontrakt testi üçün yaradılmış elan — metroya yaxın, işıqlı və təmirli mənzil.',
    price: 150000,
    currency: 'AZN',
    cityId: 'baku',
    districtId: 'baku-yasamal',
    metroId: 'elmlar-akademiyasi',
    address: 'Contract küçəsi 1',
    ...randomCoords(),
    area: 72.5,
    rooms: 2,
    bathrooms: 1,
    floor: 3,
    totalFloors: 9,
    yearBuilt: 2015,
    ceilingHeight: 3,
    repair: 'EURO',
    hasDocument: true,
    mortgageAvailable: true,
    amenities: ['BALCONY', 'ELEVATOR'],
    contactName: 'Contract Owner',
    contactPhone: owner.phone ?? randomPhone(),
    imageIds,
    ...over,
  };
}

export function dailyBody(owner: Api, imageIds: string[], over: Record<string, unknown> = {}) {
  return saleBody(owner, imageIds, {
    dealType: 'RENT_DAILY',
    title: `Contract ${uniq()} günlük kirayə mənzil`,
    price: 80,
    maxGuests: 4,
    minNights: 1,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    houseRules: 'Siqaret çəkmək olmaz',
    amenities: ['WIFI', 'AIR_CONDITIONER'],
    ...over,
  });
}

/** POST /listings → MyListing (PENDING, ACTIVE or DRAFT depending on moderation / quota). */
export async function createListing(owner: Api, over: Record<string, unknown> = {}, kind: 'sale' | 'daily' = 'sale') {
  const img = await uploadId(owner);
  const body = kind === 'daily' ? dailyBody(owner, [img], over) : saleBody(owner, [img], over);
  const res = await owner.post('/listings', body);
  return { listing: ok(res, D.MyListing), input: body };
}

export async function approve(listingId: string) {
  const a = await admin();
  return ok(await a.post(`/admin/listings/${listingId}/approve`), D.AdminListing);
}

/** A listing that is ACTIVE (approved by the admin when moderation is on). */
export async function activeListing(owner: Api, over: Record<string, unknown> = {}, kind: 'sale' | 'daily' = 'sale') {
  const { listing, input } = await createListing(owner, over, kind);
  if (listing.status === 'PENDING') await approve(listing.id);
  else assert.equal(listing.status, 'ACTIVE', `unexpected status after create: ${listing.status}`);
  const detail = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
  assert.equal(detail.status, 'ACTIVE');
  return { listing: detail, input };
}

/**
 * Pages through a Paginated list until `pred` matches (order-independent lookups in shared, growing admin lists).
 * Every page is validated against `item`.
 */
export async function findInPages<T>(api: Api, path: string, item: import('zod').ZodType<T>, pred: (x: T) => boolean, query: Record<string, any> = {}, maxPages = 50): Promise<T | undefined> {
  for (let page = 1; page <= maxPages; page++) {
    const res = ok(await api.get(path, { query: { ...query, page, pageSize: 100 } }), D.Paginated(item as any)) as { items: T[]; total: number };
    const hit = res.items.find(pred);
    if (hit) return hit;
    if (page * 100 >= res.total) return undefined;
  }
  return undefined;
}

export async function catalog() {
  return ok(await new Api().get('/catalog'), D.Catalog);
}
