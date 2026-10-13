/** Admin: banners, CMS pages, catalog (services / plans), platform settings, dashboard stats. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PAYMENT_PURPOSES } from '@evtap/shared';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { admin, fund, moderator, newUser, uniq } from '../src/fixtures';
import { anon } from '../src/http';

describe('admin banners', () => {
  test('POST / PATCH / DELETE /admin/banners (ADMIN); GET /admin/banners lists inactive ones too', async () => {
    const a = await admin();
    const mod = await moderator();
    const title = `Admin Banner ${uniq()}`;
    const input = { placement: 'LISTING_SIDEBAR', title, imageUrl: 'https://cdn.example.test/x.jpg', linkUrl: 'https://example.test/promo' };
    err(await mod.post('/admin/banners', input), 403, 'FORBIDDEN');
    err(await a.post('/admin/banners', { ...input, imageUrl: 'not a url' }), 400, 'VALIDATION_ERROR');
    const b = ok(await a.post('/admin/banners', input), D.Banner);
    try {
      assert.equal(b.active, true, 'active by default');
      assert.equal(b.sortOrder, 0);
      assert.equal(b.impressions, 0);
      assert.equal(b.clicks, 0);
      assert.equal(b.startsAt, null);
      const endsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const upd = ok(await a.patch(`/admin/banners/${b.id}`, { active: false, endsAt, sortOrder: 5 }), D.Banner);
      assert.equal(upd.active, false);
      assert.equal(upd.sortOrder, 5);
      assert.equal(Date.parse(upd.endsAt!), Date.parse(endsAt));
      assert.equal(upd.title, title, 'partial update keeps other fields');
      assert.equal(upd.placement, 'LISTING_SIDEBAR');
      const all = ok(await mod.get('/admin/banners'), D.Banner.array());
      assert.equal(all.find((x) => x.id === b.id)?.active, false);
      const pub = ok(await anon().get('/banners', { query: { placement: 'LISTING_SIDEBAR' } }), D.Banner.array());
      assert.ok(!pub.some((x) => x.id === b.id), 'inactive banner hidden from the public');
      err(await mod.patch(`/admin/banners/${b.id}`, { active: true }), 403, 'FORBIDDEN');
      err(await mod.del(`/admin/banners/${b.id}`), 403, 'FORBIDDEN');
    } finally {
      okTrue(await a.del(`/admin/banners/${b.id}`));
    }
    err(await a.del(`/admin/banners/${b.id}`), 404, 'NOT_FOUND');
    err(await a.patch(`/admin/banners/${b.id}`, { title: 'Gone' }), 404, 'NOT_FOUND');
  });
});

describe('admin CMS pages', () => {
  test('PUT /admin/pages/:slug upserts, GET /admin/pages lists, DELETE removes (ADMIN)', async () => {
    const a = await admin();
    const mod = await moderator();
    const slug = `contract-page-${uniq().toLowerCase()}`;
    const v1 = { slug, title: { az: 'Qaydalar', ru: 'Правила', en: 'Rules' }, body: { az: '## Az', ru: '## Ру', en: '## En' } };
    err(await mod.put(`/admin/pages/${slug}`, v1), 403, 'FORBIDDEN');
    const created = ok(await a.put(`/admin/pages/${slug}`, v1), D.CmsPage);
    assert.equal(created.slug, slug);
    const v2body = { ...v1, title: { ...v1.title, en: 'Rules v2' } };
    const updated = ok(await a.put(`/admin/pages/${slug}`, v2body), D.CmsPage);
    assert.equal(updated.title.en, 'Rules v2');
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt));
    const list = ok(await mod.get('/admin/pages'), D.CmsPage.array());
    assert.equal(list.filter((p) => p.slug === slug).length, 1, 'upsert does not duplicate');
    assert.equal(ok(await anon().get(`/pages/${slug}`), D.CmsPage).title.en, 'Rules v2');
    err(await a.put(`/admin/pages/${slug}`, { ...v1, slug: 'another-slug' }), 400, 'VALIDATION_ERROR');
    err(await a.put('/admin/pages/Bad_Slug', { ...v1, slug: 'Bad_Slug' }), 400, 'VALIDATION_ERROR');
    err(await a.put(`/admin/pages/${slug}`, { slug, title: { az: 'only az' }, body: v1.body }), 400, 'VALIDATION_ERROR');
    err(await mod.del(`/admin/pages/${slug}`), 403, 'FORBIDDEN');
    okTrue(await a.del(`/admin/pages/${slug}`));
    err(await anon().get(`/pages/${slug}`), 404, 'NOT_FOUND');
    err(await a.del(`/admin/pages/${slug}`), 404, 'NOT_FOUND');
  });
});

describe('admin catalog & settings', () => {
  test('GET /admin/catalog includes inactive services; PATCH services/:code (ADMIN) is reflected in /catalog', async () => {
    const a = await admin();
    const mod = await moderator();
    const before = ok(await mod.get('/admin/catalog'), D.Catalog);
    const svc = before.services.find((s) => s.code === 'PREMIUM_30')!;
    assert.ok(svc, 'PREMIUM_30 exists');
    try {
      const off = ok(await a.patch('/admin/catalog/services/PREMIUM_30', { active: false, durationDays: svc.durationDays + 1 }), D.ServiceDef);
      assert.equal(off.active, false);
      assert.equal(off.durationDays, svc.durationDays + 1);
      assert.equal(off.price, svc.price, 'partial update');
      const pub = ok(await anon().get('/catalog'), D.Catalog);
      assert.ok(!pub.services.some((s) => s.code === 'PREMIUM_30'), 'inactive service hidden from the public catalog');
      const adminCat = ok(await a.get('/admin/catalog'), D.Catalog);
      assert.equal(adminCat.services.find((s) => s.code === 'PREMIUM_30')?.active, false, 'admin catalog includes inactive');
    } finally {
      ok(await a.patch('/admin/catalog/services/PREMIUM_30', { active: svc.active, durationDays: svc.durationDays, price: svc.price }), D.ServiceDef);
    }
    err(await a.patch('/admin/catalog/services/NO_SUCH_SERVICE', { price: 100 }), 404, 'NOT_FOUND');
    err(await a.patch('/admin/catalog/services/PREMIUM_30', { price: -1 }), 400, 'VALIDATION_ERROR');
  });

  test('PATCH /admin/catalog/plans/:code (ADMIN) is reflected in /catalog', async () => {
    const a = await admin();
    const ent = ok(await a.get('/admin/catalog'), D.Catalog).plans.find((p) => p.code === 'ENTERPRISE')!;
    try {
      const upd = ok(await a.patch('/admin/catalog/plans/ENTERPRISE', { monthlyBumps: ent.monthlyBumps + 7 }), D.PlanDef);
      assert.equal(upd.monthlyBumps, ent.monthlyBumps + 7);
      assert.equal(upd.priceMonthly, ent.priceMonthly);
      assert.equal(ok(await anon().get('/catalog'), D.Catalog).plans.find((p) => p.code === 'ENTERPRISE')?.monthlyBumps, ent.monthlyBumps + 7);
    } finally {
      ok(await a.patch('/admin/catalog/plans/ENTERPRISE', { monthlyBumps: ent.monthlyBumps }), D.PlanDef);
    }
    err(await a.patch('/admin/catalog/plans/PLATINUM', { maxAgents: 3 }), 404, 'NOT_FOUND');
    err(await a.patch('/admin/catalog/plans/ENTERPRISE', { maxAgents: 0 }), 400, 'VALIDATION_ERROR');
  });

  test('GET / PATCH /admin/settings (ADMIN only); public subset follows', async () => {
    const a = await admin();
    const s = ok(await a.get('/admin/settings'), D.PlatformSettings);
    try {
      const upd = ok(await a.patch('/admin/settings', { payoutDelayHours: s.payoutDelayHours + 1, freeCancellationHours: s.freeCancellationHours }), D.PlatformSettings);
      assert.equal(upd.payoutDelayHours, s.payoutDelayHours + 1);
      assert.equal(upd.moderationEnabled, s.moderationEnabled, 'partial update');
      assert.deepEqual(upd.topupBonuses, s.topupBonuses);
      assert.equal(ok(await a.get('/admin/settings'), D.PlatformSettings).payoutDelayHours, s.payoutDelayHours + 1);
    } finally {
      ok(await a.patch('/admin/settings', { payoutDelayHours: s.payoutDelayHours }), D.PlatformSettings);
    }
    const pub = ok(await anon().get('/catalog'), D.Catalog);
    assert.equal(pub.settings.listingFee, s.listingFee);
    assert.equal(pub.settings.freeCancellationHours, s.freeCancellationHours);
    err(await a.patch('/admin/settings', { dailyRentGuestFeePercent: 90 }), 400, 'VALIDATION_ERROR');
    err(await (await moderator()).get('/admin/settings'), 403, 'FORBIDDEN');
  });
});

describe('admin stats', () => {
  test('GET /admin/stats/overview → AdminOverview reflecting new activity', async () => {
    const mod = await moderator();
    const before = ok(await mod.get('/admin/stats/overview'), D.AdminOverview);
    assert.deepEqual(Object.keys(before.revenue.byPurpose30d).sort(), [...PAYMENT_PURPOSES].sort());
    await newUser();
    const after = ok(await mod.get('/admin/stats/overview'), D.AdminOverview);
    assert.ok(after.users.newToday >= 1, 'the user just created counts as new today');
    assert.ok(after.users.total >= 1 && after.listings.total >= after.listings.active);
  });

  test('GET /admin/stats/revenue?days= → one point per day with a key per PaymentPurpose', async () => {
    const mod = await moderator();
    const u = await newUser();
    await fund(u, 100); // adjustments are not revenue; just make sure the series answers with activity around
    const pts = ok(await mod.get('/admin/stats/revenue', { query: { days: 7 } }), D.TimeseriesPoint.array());
    assert.equal(pts.length, 7);
    for (const p of pts) for (const purpose of PAYMENT_PURPOSES) assert.equal(typeof p[purpose], 'number', `${p.date}.${purpose}`);
    const dates = pts.map((p) => p.date);
    assert.deepEqual(dates, [...dates].sort(), 'chronological');
    assert.equal(ok(await mod.get('/admin/stats/revenue'), D.TimeseriesPoint.array()).length, 30, 'days defaults to 30');
    err(await mod.get('/admin/stats/revenue', { query: { days: 0 } }), 400, 'VALIDATION_ERROR');
  });

  test('GET /admin/stats/listings and /admin/stats/users → daily series', async () => {
    const mod = await moderator();
    const listings = ok(await mod.get('/admin/stats/listings', { query: { days: 5 } }), D.TimeseriesPoint.array());
    assert.equal(listings.length, 5);
    for (const p of listings) for (const k of ['created', 'published', 'rejected']) assert.equal(typeof p[k], 'number', `${p.date}.${k}`);
    await newUser();
    const users = ok(await mod.get('/admin/stats/users', { query: { days: 3 } }), D.TimeseriesPoint.array());
    assert.equal(users.length, 3);
    assert.ok(users[users.length - 1].value >= 1, 'today has new users');
    assert.equal(ok(await mod.get('/admin/stats/users'), D.TimeseriesPoint.array()).length, 30);
  });
});
