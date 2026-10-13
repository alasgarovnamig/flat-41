/**
 * Dev-only mock API (VITE_MOCK=1): a tiny fetch interceptor serving the admin endpoints from
 * in-memory fixtures. Mutations change the in-memory state so flows (approve, refund, …) can be clicked through.
 * Login: admin@evtap.az (ADMIN) · moderator@evtap.az (MODERATOR) · user@evtap.az (USER → denied). Any password except "wrong".
 */
import { CITIES, COUNTRIES, DISTRICTS, METRO_STATIONS, maskPhone, type ActivePromotion, type AdminUser, type Paginated } from '@evtap/shared';
import { API_BASE } from '../env';
import * as fx from './fixtures';

type Req = { method: string; path: string; query: URLSearchParams; body: any; userId: string | null };
type Handler = (req: Req, params: string[]) => unknown;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const routes: [string, RegExp, Handler, ('ADMIN' | 'STAFF' | 'PUBLIC')?][] = [];
const on = (method: string, pattern: string, h: Handler, access: 'ADMIN' | 'STAFF' | 'PUBLIC' = 'STAFF') =>
  routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), h, access]);

const paginate = <T,>(items: T[], q: URLSearchParams): Paginated<T> => {
  const page = Math.max(1, Number(q.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize')) || 20));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
};
const has = (s: string | null | undefined, q: string) => !!s && s.toLowerCase().includes(q.toLowerCase());
const find = <T extends { id: string }>(xs: T[], id: string) => {
  const x = xs.find((i) => i.id === id);
  if (!x) throw new HttpError(404, 'Not found', 'NOT_FOUND');
  return x;
};
const userById = (id: string) => find(fx.users, id);
const audit = (actorId: string | null, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}) => {
  const actor = actorId ? fx.users.find((u) => u.id === actorId) : null;
  fx.auditLogs.unshift({ id: crypto.randomUUID(), actor: actor ? { id: actor.id, name: actor.name } : null, action, entity, entityId, data, ip: '127.0.0.1', createdAt: new Date().toISOString() });
};
const tokensFor = (u: AdminUser) => ({ accessToken: `mock-access.${u.id}.${Date.now()}`, refreshToken: `mock-refresh.${u.id}.${Date.now()}`, expiresIn: 900 });
const toUser = (u: AdminUser) => {
  const { walletBalance: _w, activeListings: _a, totalSpent: _t, lastLoginAt: _l, ...user } = u;
  return user;
};
const toAdminListing = (l: fx.MockListing) => {
  const { description: _d, images: _i, amenities: _a, bathrooms: _b, yearBuilt: _y, ceilingHeight: _c, repair: _r, maxGuests: _m, minNights: _n, checkInTime: _ci, checkOutTime: _co, houseRules: _h, contactName: _cn, favoritesCount: _f, expiresAt: _e, agencyId: _ag, ...rest } = l;
  return rest;
};
const promotionsOf = (l: fx.MockListing): ActivePromotion[] => {
  const out: ActivePromotion[] = [];
  const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
  if (l.isVip) out.push({ id: 'p-vip-' + l.id, type: 'VIP', serviceCode: 'VIP_7', startsAt: l.createdAt, endsAt: end });
  if (l.isPremium) out.push({ id: 'p-pr-' + l.id, type: 'PREMIUM', serviceCode: 'PREMIUM_7', startsAt: l.createdAt, endsAt: end });
  if (l.isHighlighted) out.push({ id: 'p-hl-' + l.id, type: 'HIGHLIGHT', serviceCode: 'HIGHLIGHT_7', startsAt: l.createdAt, endsAt: end });
  if (l.isUrgent) out.push({ id: 'p-ur-' + l.id, type: 'URGENT', serviceCode: 'URGENT_7', startsAt: l.createdAt, endsAt: end });
  return out;
};

// ─────────────────────────── auth ───────────────────────────
on('POST', '/auth/login', (r) => {
  const login = String(r.body?.login ?? '').toLowerCase();
  const u = fx.users.find((x) => x.email === login || x.phone === login);
  if (!u || r.body?.password === 'wrong') throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  if (u.status === 'BLOCKED') throw new HttpError(403, 'Account blocked', 'USER_BLOCKED');
  return { ...tokensFor(u), user: toUser(u) };
}, 'PUBLIC');
on('POST', '/auth/refresh', (r) => {
  const id = String(r.body?.refreshToken ?? '').split('.')[1];
  const u = fx.users.find((x) => x.id === id);
  if (!u) throw new HttpError(401, 'Invalid refresh token');
  return { ...tokensFor(u), user: toUser(u) };
}, 'PUBLIC');
on('POST', '/auth/logout', () => ({ ok: true }), 'PUBLIC');
on('GET', '/auth/me', (r) => {
  const u = userById(r.userId!);
  return { ...toUser(u), wallet: { balance: u.walletBalance, bonusBalance: 0, currency: 'AZN' }, subscription: null, quota: { freeLimit: 2, used: 0, remaining: 2, listingFee: 300 }, unreadMessages: 0, unreadNotifications: 0 };
}, 'PUBLIC');

// ─────────────────────────── reference ───────────────────────────
on('GET', '/locations', () => ({ countries: COUNTRIES, cities: CITIES, districts: DISTRICTS, metroStations: METRO_STATIONS }), 'PUBLIC');
on('GET', '/catalog', () => ({ services: fx.catalog.services.filter((s) => s.active), bundles: fx.catalog.bundles, plans: fx.catalog.plans.filter((p) => p.active), settings: fx.settings }), 'PUBLIC');
on('POST', '/uploads', () => {
  const url = fx.photo(Math.floor(Math.random() * 6), 0);
  return { id: crypto.randomUUID(), url, thumbUrl: url, mime: 'image/webp', size: 120_000 };
}, 'PUBLIC');

// ─────────────────────────── stats ───────────────────────────
on('GET', '/admin/stats/overview', () => {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const in30 = (iso: string) => now - Date.parse(iso) <= 30 * 86_400_000;
  const ok = fx.payments.filter((p) => p.status === 'SUCCEEDED');
  const byPurpose = { WALLET_TOPUP: 0, PROMOTION: 0, LISTING_FEE: 0, SUBSCRIPTION: 0, BOOKING: 0, VERIFICATION: 0 };
  for (const p of ok.filter((p) => in30(p.createdAt))) byPurpose[p.purpose] += p.amount;
  const activeSubs = fx.subscriptions.filter((s) => s.status === 'ACTIVE');
  return {
    users: { total: fx.users.length * 37, newToday: fx.users.filter((u) => u.createdAt.startsWith(today)).length + 23, new30d: fx.users.filter((u) => in30(u.createdAt)).length * 9, business: fx.users.filter((u) => u.accountType === 'BUSINESS').length * 6 },
    listings: { active: fx.listings.filter((l) => l.status === 'ACTIVE').length * 41, pending: fx.listings.filter((l) => l.status === 'PENDING').length, total: fx.listings.length * 52, newToday: 17 },
    revenue: { today: ok.filter((p) => p.createdAt.startsWith(today)).reduce((a, p) => a + p.amount, 0), last30d: ok.filter((p) => in30(p.createdAt)).reduce((a, p) => a + p.amount, 0), total: ok.reduce((a, p) => a + p.amount, 0) * 4, byPurpose30d: byPurpose },
    payments: { succeeded30d: ok.filter((p) => in30(p.createdAt)).length, failed30d: fx.payments.filter((p) => p.status === 'FAILED' && in30(p.createdAt)).length },
    bookings: { confirmed: fx.bookings.filter((b) => b.status === 'CONFIRMED').length, upcoming: fx.bookings.filter((b) => b.status === 'CONFIRMED' && b.checkIn >= today).length, gmv30d: fx.bookings.filter((b) => b.status !== 'PENDING_PAYMENT' && in30(b.createdAt)).reduce((a, b) => a + b.total, 0) },
    subscriptions: { active: activeSubs.length, mrr: activeSubs.reduce((a, s) => { const p = fx.catalog.plans.find((x) => x.code === s.planCode)!; return a + (s.period === 'YEAR' ? Math.round(p.priceYearly / 12) : p.priceMonthly); }, 0) },
    reports: { open: fx.reports.filter((r) => r.status === 'OPEN').length },
  };
});
on('GET', '/admin/stats/revenue', (r) => fx.revenueSeries(Number(r.query.get('days')) || 30));
on('GET', '/admin/stats/listings', (r) => fx.listingSeries(Number(r.query.get('days')) || 30));
on('GET', '/admin/stats/users', (r) => fx.userSeries(Number(r.query.get('days')) || 30));

// ─────────────────────────── listings ───────────────────────────
on('GET', '/admin/listings', (r) => {
  const q = r.query;
  let xs = fx.listings.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (q.get('status')) xs = xs.filter((l) => l.status === q.get('status'));
  if (q.get('dealType')) xs = xs.filter((l) => l.dealType === q.get('dealType'));
  if (q.get('ownerId')) xs = xs.filter((l) => l.ownerId === q.get('ownerId'));
  if (q.get('reported') === 'true') xs = xs.filter((l) => l.reportsCount > 0);
  const s = q.get('q');
  if (s) xs = xs.filter((l) => has(l.title, s) || l.id.startsWith(s) || has(l.ownerName, s));
  return paginate(xs.map(toAdminListing), q);
});
on('GET', '/admin/listings/:id', (_r, [id]) => {
  const l = find(fx.listings, id);
  const owner = userById(l.ownerId);
  const ag = fx.agencies.find((a) => a.id === l.agencyId) ?? null;
  const agency = ag && { id: ag.id, name: ag.name, slug: ag.slug, logoUrl: ag.logoUrl, type: ag.type, verified: ag.verified };
  return {
    ...toAdminListing(l),
    description: l.description, images: l.images, amenities: l.amenities, bathrooms: l.bathrooms, yearBuilt: l.yearBuilt, ceilingHeight: l.ceilingHeight, repair: l.repair,
    maxGuests: l.maxGuests, minNights: l.minNights, checkInTime: l.checkInTime, checkOutTime: l.checkOutTime, houseRules: l.houseRules,
    contactName: l.contactName, contactPhoneMasked: maskPhone(owner.phone ?? '+994500000000'),
    owner: { id: owner.id, name: owner.name, avatarUrl: null, accountType: owner.accountType, agency, memberSince: owner.createdAt, activeListings: owner.activeListings, rating: null, reviewsCount: 0 },
    agency, favoritesCount: l.favoritesCount, reviewsCount: 0, expiresAt: l.expiresAt, promotions: promotionsOf(l), isOwner: false, isFavorite: false,
    reports: fx.reports.filter((x) => x.listingId === l.id), ownerPhone: owner.phone,
  };
});
const setStatus = (r: Req, id: string, status: fx.MockListing['status'], reason: string | null, action: string) => {
  const l = find(fx.listings, id);
  l.status = status;
  l.rejectionReason = reason;
  l.updatedAt = new Date().toISOString();
  if (status === 'ACTIVE' && !l.publishedAt) l.publishedAt = l.updatedAt;
  audit(r.userId, action, 'listing', id, reason ? { reason } : {});
  return toAdminListing(l);
};
const needReason = (r: Req) => {
  const reason = String(r.body?.reason ?? '').trim();
  if (reason.length < 3) throw new HttpError(400, 'reason must contain at least 3 characters', 'VALIDATION_ERROR');
  return reason;
};
on('POST', '/admin/listings/:id/approve', (r, [id]) => setStatus(r, id, 'ACTIVE', null, 'listing.approve'));
on('POST', '/admin/listings/:id/reject', (r, [id]) => setStatus(r, id, 'REJECTED', needReason(r), 'listing.reject'));
on('POST', '/admin/listings/:id/block', (r, [id]) => setStatus(r, id, 'BLOCKED', needReason(r), 'listing.block'));
on('PATCH', '/admin/listings/:id', (r, [id]) => {
  const l = find(fx.listings, id);
  const { contactPhone: _p, imageIds: _i, ...patch } = r.body ?? {};
  Object.assign(l, patch, { updatedAt: new Date().toISOString() });
  audit(r.userId, 'listing.update', 'listing', id, { fields: Object.keys(r.body ?? {}) });
  return toAdminListing(l);
});
on('POST', '/admin/listings/:id/promote', (r, [id]) => {
  const l = find(fx.listings, id);
  const code = String(r.body?.serviceCode ?? '');
  const s = fx.catalog.services.find((x) => x.code === code);
  if (!s) throw new HttpError(400, 'Unknown service', 'VALIDATION_ERROR');
  if (s.promotionType === 'VIP') l.isVip = true;
  if (s.promotionType === 'PREMIUM') l.isPremium = true;
  if (s.promotionType === 'HIGHLIGHT') l.isHighlighted = true;
  if (s.promotionType === 'URGENT') l.isUrgent = true;
  if (s.code === 'VERIFICATION') l.isVerified = true;
  if (s.promotionType === 'BUMP' || s.promotionType === 'AUTO_BUMP') l.bumpedAt = new Date().toISOString();
  audit(r.userId, 'listing.promote', 'listing', id, { serviceCode: code, source: 'ADMIN' });
  return toAdminListing(l);
}, 'ADMIN');

// ─────────────────────────── users ───────────────────────────
on('GET', '/admin/users', (r) => {
  const q = r.query;
  let xs = fx.users.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const k of ['role', 'status', 'accountType'] as const) if (q.get(k)) xs = xs.filter((u) => u[k] === q.get(k));
  const s = q.get('q');
  if (s) xs = xs.filter((u) => has(u.name, s) || has(u.email, s) || has(u.phone, s.replace(/\s/g, '')));
  return paginate(xs, q);
});
on('GET', '/admin/users/:id', (_r, [id]) => {
  const u = userById(id);
  return { ...u, listings: fx.listings.filter((l) => l.ownerId === id).map(toAdminListing), payments: fx.payments.filter((p) => p.userId === id).map(({ userName: _n, providerData: _d, ...p }) => p), walletTransactions: fx.walletTx(id) };
});
on('PATCH', '/admin/users/:id', (r, [id]) => {
  const u = userById(id);
  Object.assign(u, r.body);
  audit(r.userId, 'user.update', 'user', id, r.body);
  return u;
}, 'ADMIN');
on('POST', '/admin/users/:id/wallet-adjust', (r, [id]) => {
  const u = userById(id);
  const amount = Number(r.body?.amount);
  if (!Number.isInteger(amount) || amount === 0) throw new HttpError(400, 'amount must be a non-zero integer', 'VALIDATION_ERROR');
  if (u.walletBalance + amount < 0) throw new HttpError(400, 'Insufficient funds', 'INSUFFICIENT_FUNDS');
  u.walletBalance += amount;
  audit(r.userId, 'wallet.adjust', 'wallet', id, r.body);
  return { balance: u.walletBalance, bonusBalance: 0, currency: 'AZN' };
}, 'ADMIN');

// ─────────────────────────── agencies ───────────────────────────
on('GET', '/admin/agencies', (r) => {
  let xs = fx.agencies.slice();
  const s = r.query.get('q');
  if (s) xs = xs.filter((a) => has(a.name, s));
  if (r.query.get('verified')) xs = xs.filter((a) => String(a.verified) === r.query.get('verified'));
  return paginate(xs, r.query);
});
on('PATCH', '/admin/agencies/:id', (r, [id]) => {
  const a = find(fx.agencies, id);
  a.verified = !!r.body?.verified;
  audit(r.userId, 'agency.update', 'agency', id, { verified: a.verified });
  return a;
});

// ─────────────────────────── payments ───────────────────────────
on('GET', '/admin/payments', (r) => {
  const q = r.query;
  let xs = fx.payments.slice();
  if (q.get('status')) xs = xs.filter((p) => p.status === q.get('status'));
  if (q.get('purpose')) xs = xs.filter((p) => p.purpose === q.get('purpose'));
  if (q.get('userId')) xs = xs.filter((p) => p.userId === q.get('userId'));
  if (q.get('from')) xs = xs.filter((p) => p.createdAt.slice(0, 10) >= q.get('from')!);
  if (q.get('to')) xs = xs.filter((p) => p.createdAt.slice(0, 10) <= q.get('to')!);
  return paginate(xs.map(({ providerData: _d, ...p }) => p), q);
});
on('GET', '/admin/payments/:id', (_r, [id]) => {
  const { userName: _n, ...p } = find(fx.payments, id);
  const u = fx.users.find((x) => x.id === p.userId);
  return { ...p, user: u ? { id: u.id, name: u.name, email: u.email, phone: u.phone } : null };
});
on('POST', '/admin/payments/:id/refund', (r, [id]) => {
  const p = find(fx.payments, id);
  const left = p.amount - p.refundedAmount;
  const amount = r.body?.amount ?? left;
  if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status) || amount <= 0 || amount > left) throw new HttpError(400, 'Refund not possible', 'REFUND_INVALID');
  p.refundedAmount += amount;
  p.status = p.refundedAmount >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  audit(r.userId, 'payment.refund', 'payment', id, { amount, reason: r.body?.reason });
  const { userName: _n, providerData: _d, ...out } = p;
  return out;
}, 'ADMIN');

// ─────────────────────────── bookings / subscriptions ───────────────────────────
on('GET', '/admin/bookings', (r) => {
  let xs = fx.bookings.slice();
  if (r.query.get('status')) xs = xs.filter((b) => b.status === r.query.get('status'));
  if (r.query.get('payoutStatus')) xs = xs.filter((b) => b.payoutStatus === r.query.get('payoutStatus'));
  return paginate(xs, r.query);
});
on('POST', '/admin/bookings/:id/cancel', (r, [id]) => {
  const b = find(fx.bookings, id);
  b.status = 'REFUNDED';
  b.payoutStatus = 'CANCELLED';
  b.refundedAmount = b.total;
  b.cancelledBy = 'ADMIN';
  b.cancelReason = needReason(r);
  audit(r.userId, 'booking.cancel', 'booking', id, { reason: b.cancelReason });
  return b;
}, 'ADMIN');
on('GET', '/admin/subscriptions', (r) => paginate(r.query.get('status') ? fx.subscriptions.filter((s) => s.status === r.query.get('status')) : fx.subscriptions, r.query));

// ─────────────────────────── reports ───────────────────────────
on('GET', '/admin/reports', (r) => paginate((r.query.get('status') ? fx.reports.filter((x) => x.status === r.query.get('status')) : fx.reports).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), r.query));
on('PATCH', '/admin/reports/:id', (r, [id]) => {
  const rep = find(fx.reports, id);
  rep.status = r.body?.status;
  rep.resolvedAt = new Date().toISOString();
  audit(r.userId, 'report.' + String(r.body?.status).toLowerCase(), 'report', id);
  return rep;
});

// ─────────────────────────── catalog & settings ───────────────────────────
on('GET', '/admin/catalog', () => ({ ...fx.catalog, settings: fx.settings }));
on('PATCH', '/admin/catalog/services/:code', (r, [code]) => {
  const s = fx.catalog.services.find((x) => x.code === code);
  if (!s) throw new HttpError(404, 'Not found');
  Object.assign(s, r.body);
  audit(r.userId, 'service.update', 'service', code, r.body);
  return s;
}, 'ADMIN');
on('PATCH', '/admin/catalog/plans/:code', (r, [code]) => {
  const p = fx.catalog.plans.find((x) => x.code === code);
  if (!p) throw new HttpError(404, 'Not found');
  Object.assign(p, r.body);
  audit(r.userId, 'plan.update', 'plan', code, r.body);
  return p;
}, 'ADMIN');
on('GET', '/admin/settings', () => fx.settings, 'ADMIN');
on('PATCH', '/admin/settings', (r) => {
  Object.assign(fx.settings, r.body);
  audit(r.userId, 'settings.update', 'settings', null, r.body);
  return fx.settings;
}, 'ADMIN');

// ─────────────────────────── content ───────────────────────────
on('GET', '/admin/banners', () => fx.banners);
on('POST', '/admin/banners', (r) => {
  const b = { id: crypto.randomUUID(), impressions: 0, clicks: 0, startsAt: null, endsAt: null, ...r.body };
  fx.banners.push(b);
  audit(r.userId, 'banner.create', 'banner', b.id);
  return b;
}, 'ADMIN');
on('PATCH', '/admin/banners/:id', (r, [id]) => Object.assign(find(fx.banners, id), r.body), 'ADMIN');
on('DELETE', '/admin/banners/:id', (_r, [id]) => {
  fx.banners.splice(fx.banners.indexOf(find(fx.banners, id)), 1);
  return { ok: true };
}, 'ADMIN');
on('GET', '/admin/pages', () => fx.pages);
on('PUT', '/admin/pages/:slug', (r, [slug]) => {
  const page = { ...r.body, slug, updatedAt: new Date().toISOString() };
  const i = fx.pages.findIndex((p) => p.slug === slug);
  if (i >= 0) fx.pages[i] = page;
  else fx.pages.push(page);
  audit(r.userId, 'page.update', 'page', slug);
  return page;
}, 'ADMIN');
on('DELETE', '/admin/pages/:slug', (_r, [slug]) => {
  const i = fx.pages.findIndex((p) => p.slug === slug);
  if (i < 0) throw new HttpError(404, 'Not found');
  fx.pages.splice(i, 1);
  return { ok: true };
}, 'ADMIN');
on('GET', '/admin/mortgage-leads', (r) => paginate(r.query.get('status') ? fx.leads.filter((l) => l.status === r.query.get('status')) : fx.leads, r.query));
on('PATCH', '/admin/mortgage-leads/:id', (r, [id]) => Object.assign(find(fx.leads, id), { status: r.body?.status }));
on('POST', '/admin/notifications/broadcast', (r) => {
  audit(r.userId, 'notification.broadcast', 'notification', null, r.body);
  const aud = r.body?.audience;
  return { sent: aud === 'BUSINESS' ? 412 : aud === 'INDIVIDUAL' ? 2073 : 2485 };
}, 'ADMIN');
on('GET', '/admin/audit-logs', (r) => {
  let xs = fx.auditLogs;
  if (r.query.get('entity')) xs = xs.filter((l) => l.entity === r.query.get('entity'));
  if (r.query.get('actorId')) xs = xs.filter((l) => l.actor?.id === r.query.get('actorId'));
  return paginate(xs, r.query);
}, 'ADMIN');

// ─────────────────────────── interceptor ───────────────────────────
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installMockApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(API_BASE)) return realFetch(input, init);
    const u = new URL(url);
    const path = u.pathname.slice(new URL(API_BASE).pathname.length) || '/';
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const auth = new Headers(init?.headers).get('Authorization');
    const userId = auth?.startsWith('Bearer mock-access.') ? auth.split('.')[1] : null;
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 260));

    for (const [m, re, handler, access] of routes) {
      if (m !== method) continue;
      const match = re.exec(path);
      if (!match) continue;
      const user = userId ? fx.users.find((x) => x.id === userId) : null;
      if (access !== 'PUBLIC' || path === '/auth/me') {
        if (!user) return json(401, { statusCode: 401, message: 'Unauthorized' });
        if (access === 'STAFF' && user.role === 'USER') return json(403, { statusCode: 403, message: 'Forbidden', code: 'FORBIDDEN' });
        if (access === 'ADMIN' && user.role !== 'ADMIN') return json(403, { statusCode: 403, message: 'Admin only', code: 'FORBIDDEN' });
      }
      try {
        const out = handler({ method, path, query: u.searchParams, body, userId }, match.slice(1).map(decodeURIComponent));
        return json(method === 'POST' && /^\/admin\/banners$/.test(path) ? 201 : 200, structuredClone(out));
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, { statusCode: e.status, message: e.message, code: e.code });
        console.error('[mock]', e);
        return json(500, { statusCode: 500, message: 'Mock handler crashed' });
      }
    }
    return json(404, { statusCode: 404, message: `Cannot ${method} ${new URL(API_BASE).pathname}${path}`, error: 'Not Found' });
  };
  console.info('%c[EvTap admin] mock API enabled — fixture data, no network', 'color:#0E7C66;font-weight:bold');
}
