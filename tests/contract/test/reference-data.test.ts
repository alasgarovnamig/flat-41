/** Reference data: locations, catalog, mortgage (banks + leads), banners, CMS pages. */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { BUNDLES, CITIES, COUNTRIES, DISTRICTS, METRO_STATIONS, PLANS } from '@evtap/shared';
import { v2 } from '../src/config';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, admin, findInPages, newUser, randomPhone, randomUuid, uniq } from '../src/fixtures';
import { anon } from '../src/http';

describe('locations & catalog', () => {
  test('GET /locations returns exactly the shared location data', async () => {
    const res = await anon().get('/locations');
    const body = ok(res, D.Locations);
    const strip = <T extends object>(xs: T[]) => xs.map((x) => JSON.parse(JSON.stringify(x)));
    assert.deepEqual(strip(body.countries), strip(COUNTRIES));
    assert.deepEqual(strip(body.cities), strip(CITIES));
    assert.deepEqual(strip(body.districts), strip(DISTRICTS));
    assert.deepEqual(strip(body.metroStations), strip(METRO_STATIONS));
  });

  test('GET /catalog → active services, bundles, plans and the public settings subset', async () => {
    const cat = ok(await anon().get('/catalog'), D.Catalog);
    const codes = cat.services.map((s) => s.code);
    for (const code of ['BUMP_1', 'VIP_7', 'PREMIUM_7', 'VERIFICATION']) assert.ok(codes.includes(code), `core service ${code} present`);
    assert.ok(cat.services.every((s) => s.active), 'public catalog lists active services only');
    assert.deepEqual(cat.bundles.map((b) => b.code).sort(), BUNDLES.map((b) => b.code).sort());
    assert.deepEqual(cat.plans.map((p) => p.code).sort(), PLANS.map((p) => p.code).sort());
    const raw = (await anon().get('/catalog')).body.settings as Record<string, unknown>;
    assert.ok(!('moderationEnabled' in raw) && !('payoutDelayHours' in raw), 'internal settings are not public');
  });
});

describe('mortgage', () => {
  test('GET /mortgage/banks → MortgageBank[]', async () => {
    const banks = ok(await anon().get('/mortgage/banks'), D.MortgageBank.array());
    assert.ok(banks.length > 0);
    assert.equal(new Set(banks.map((b) => b.code)).size, banks.length);
  });

  test('POST /mortgage/leads (anonymous and authenticated) → { id }; admin sees it', async () => {
    const banks = ok(await anon().get('/mortgage/banks'), D.MortgageBank.array());
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const name = `Lead ${uniq()}`;
    const phone = randomPhone();
    const r1 = ok(await anon().post('/mortgage/leads', { name, phone, listingId: listing.id, price: 150000, downPayment: 30000, termYears: 15, bankCode: banks[0].code }));
    assert.ok(D.id.safeParse(r1.id).success, 'returns { id }');
    const u = await newUser();
    const r2 = ok(await u.post('/mortgage/leads', { name: `${name} 2`, phone, price: 90000, downPayment: 0, termYears: 10 }));
    assert.ok(D.id.safeParse(r2.id).success);

    const a = await admin();
    const lead = await findInPages(a, '/admin/mortgage-leads', D.MortgageLead, (l) => l.id === r1.id, { status: 'NEW' });
    assert.ok(lead, 'new lead listed for admins');
    assert.equal(lead.status, 'NEW');
    assert.equal(lead.listingId, listing.id);
    assert.equal(lead.phone, phone);
  });

  test('lead validation: downPayment ≥ price, unknown listing, bad phone', async () => {
    const base = { name: 'Lead Check', phone: randomPhone(), price: 100000, downPayment: 20000, termYears: 10 };
    err(await anon().post('/mortgage/leads', { ...base, downPayment: 100000 }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/mortgage/leads', { ...base, phone: '123' }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/mortgage/leads', { ...base, termYears: 50 }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/mortgage/leads', { ...base, listingId: randomUuid() }), 404, 'NOT_FOUND');
  });
});

describe('banners & CMS pages (public side)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  after(async () => {
    for (const c of cleanup) await c().catch(() => undefined);
  });

  test('GET /banners?placement lists active banners in their window and counts impressions; POST /banners/:id/click', async () => {
    const a = await admin();
    const title = `Banner ${uniq()}`;
    const mk = (over: Record<string, unknown>) =>
      a.post('/admin/banners', { placement: 'SEARCH_TOP', title, imageUrl: 'https://cdn.example.test/b.jpg', linkUrl: 'https://example.test/', ...over });
    const live = ok(await mk({ sortOrder: -1000 }), D.Banner);
    const inactive = ok(await mk({ active: false }), D.Banner);
    const future = ok(await mk({ startsAt: new Date(Date.now() + 86_400_000).toISOString() }), D.Banner);
    const past = ok(await mk({ endsAt: new Date(Date.now() - 86_400_000).toISOString() }), D.Banner);
    for (const b of [live, inactive, future, past]) cleanup.push(() => a.del(`/admin/banners/${b.id}`));

    const list = ok(await anon().get('/banners', { query: { placement: 'SEARCH_TOP' } }), D.Banner.array());
    const ids = list.map((b) => b.id);
    assert.ok(ids.includes(live.id), 'active banner listed');
    for (const b of [inactive, future, past]) assert.ok(!ids.includes(b.id), 'inactive / out-of-window banners are hidden');
    assert.ok(list.every((b) => b.placement === 'SEARCH_TOP' && b.active));
    const other = ok(await anon().get('/banners', { query: { placement: 'HOME_TOP' } }), D.Banner.array());
    assert.ok(!other.some((b) => b.id === live.id), 'placement filter applies');

    okTrue(await anon().post(`/banners/${live.id}/click`));
    const all = ok(await a.get('/admin/banners'), D.Banner.array());
    const stored = all.find((b) => b.id === live.id)!;
    assert.ok(stored.impressions >= 1, 'impression counted');
    assert.equal(stored.clicks, 1, 'click counted');
    err(await anon().post(`/banners/${randomUuid()}/click`), 404, 'NOT_FOUND');
    err(await anon().get('/banners', { query: { placement: 'NOWHERE' } }), 400, 'VALIDATION_ERROR');
  });

  test('GET /pages/:slug → CmsPage; unknown slug → 404', async () => {
    const a = await admin();
    const slug = `contract-${uniq().toLowerCase()}`;
    const input = { title: { az: 'Başlıq', ru: 'Заголовок', en: 'Title' }, body: { az: '# Salam', ru: '# Привет', en: '# Hello' } };
    ok(await a.put(`/admin/pages/${slug}`, { slug, ...input }), D.CmsPage);
    cleanup.push(() => a.del(`/admin/pages/${slug}`));
    const page = ok(await anon().get(`/pages/${slug}`), D.CmsPage);
    assert.equal(page.slug, slug);
    assert.deepEqual(page.title, input.title);
    assert.deepEqual(page.body, input.body);
    err(await anon().get(`/pages/no-such-page-${uniq().toLowerCase()}`), 404, 'NOT_FOUND');
  });

  test('[v2] GET /pages → { slug, title }[] localised by ?locale', v2, async () => {
    const a = await admin();
    const slug = `contract-${uniq().toLowerCase()}`;
    ok(await a.put(`/admin/pages/${slug}`, { slug, title: { az: 'Az başlıq', ru: 'Ру заголовок', en: 'En title' }, body: { az: 'a', ru: 'r', en: 'e' } }), D.CmsPage);
    cleanup.push(() => a.del(`/admin/pages/${slug}`));
    for (const [locale, title] of [['en', 'En title'], ['ru', 'Ру заголовок'], ['az', 'Az başlıq']] as const) {
      const pages = ok(await anon().get('/pages', { query: { locale } }), D.CmsPageSummary.array());
      assert.equal(pages.find((p) => p.slug === slug)?.title, title, `locale=${locale}`);
    }
  });
});
