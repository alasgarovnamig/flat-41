/** Admin: users (list / detail / role & status), reports, mortgage leads, audit log. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, admin, findInPages, fund, moderator, newPasswordUser, newUser, randomPhone, randomUuid, relogin, uniq } from '../src/fixtures';
import { anon, Api } from '../src/http';

describe('admin users', () => {
  test('GET /admin/users (q by phone / e-mail / name, role, status, accountType) and GET /admin/users/:id', async () => {
    const u = await newUser(`Admin Lookup ${uniq()}`);
    const { listing } = await activeListing(u);
    await fund(u, 1234);
    const mod = await moderator();
    const byPhone = ok(await mod.get('/admin/users', { query: { q: u.phone } }), D.Paginated(D.AdminUser));
    assert.deepEqual(byPhone.items.map((x) => x.id), [u.id]);
    const row = byPhone.items[0];
    assert.equal(row.walletBalance, 1234);
    assert.equal(row.activeListings, 1);
    assert.equal(row.totalSpent, 0);
    assert.ok(row.lastLoginAt);
    const byName = ok(await mod.get('/admin/users', { query: { q: u.user.name } }), D.Paginated(D.AdminUser));
    assert.deepEqual(byName.items.map((x) => x.id), [u.id]);
    const roles = ok(await mod.get('/admin/users', { query: { role: 'ADMIN', pageSize: 100 } }), D.Paginated(D.AdminUser));
    assert.ok(roles.items.length >= 1 && roles.items.every((x) => x.role === 'ADMIN'));
    const biz = ok(await mod.get('/admin/users', { query: { accountType: 'BUSINESS', pageSize: 10 } }), D.Paginated(D.AdminUser));
    assert.ok(biz.items.every((x) => x.accountType === 'BUSINESS'));
    const active = ok(await mod.get('/admin/users', { query: { q: u.phone, status: 'BLOCKED' } }), D.Paginated(D.AdminUser));
    assert.equal(active.total, 0);

    const d = ok(await mod.get(`/admin/users/${u.id}`), D.AdminUserDetail);
    assert.equal(d.id, u.id);
    assert.deepEqual(d.listings.map((l) => l.id), [listing.id]);
    assert.equal(d.walletTransactions.length, 1);
    assert.equal(d.walletTransactions[0].type, 'ADJUSTMENT');
    assert.deepEqual(d.payments, []);
    err(await mod.get(`/admin/users/${randomUuid()}`), 404, 'NOT_FOUND');
  });

  test('PATCH /admin/users/:id (ADMIN): name, role (effective on next login), status; cannot modify self', async () => {
    const a = await admin();
    const u = await newPasswordUser('Promote Me');
    const renamed = ok(await a.patch(`/admin/users/${u.id}`, { name: 'Promoted User' }), D.AdminUser);
    assert.equal(renamed.name, 'Promoted User');
    const promoted = ok(await a.patch(`/admin/users/${u.id}`, { role: 'MODERATOR' }), D.AdminUser);
    assert.equal(promoted.role, 'MODERATOR');
    await relogin(u);
    ok(await u.get('/admin/stats/overview'), D.AdminOverview);
    err(await u.get('/admin/settings'), 403, 'FORBIDDEN');

    const demoted = ok(await a.patch(`/admin/users/${u.id}`, { role: 'USER', status: 'BLOCKED' }), D.AdminUser);
    assert.equal(demoted.status, 'BLOCKED');
    err(await new Api().post('/auth/login', { login: u.email, password: u.password }), 403, 'USER_BLOCKED');
    err(await new Api().post('/auth/refresh', { refreshToken: u.refreshToken }), 401, ['REFRESH_INVALID', 'REFRESH_REUSED', 'USER_BLOCKED']);

    err(await a.patch(`/admin/users/${a.id}`, { role: 'USER' }), 403, 'CANNOT_MODIFY_SELF');
    err(await a.patch(`/admin/users/${a.id}`, { status: 'BLOCKED' }), 403, 'CANNOT_MODIFY_SELF');
    err(await a.patch(`/admin/users/${u.id}`, { role: 'GOD' }), 400, 'VALIDATION_ERROR');
    err(await a.patch(`/admin/users/${randomUuid()}`, { name: 'Nobody here' }), 404, 'NOT_FOUND');
    err(await (await moderator()).patch(`/admin/users/${u.id}`, { name: 'By moderator' }), 403, 'FORBIDDEN');
  });

  test('POST /admin/users/:id/wallet-adjust: ADMIN only, unknown user → 404', async () => {
    const u = await newUser();
    err(await (await moderator()).post(`/admin/users/${u.id}/wallet-adjust`, { amount: 100, reason: 'try' }), 403, 'FORBIDDEN');
    err(await (await admin()).post(`/admin/users/${randomUuid()}/wallet-adjust`, { amount: 100, reason: 'nobody' }), 404, 'NOT_FOUND');
  });
});

describe('admin reports', () => {
  test('GET /admin/reports (status) and PATCH /admin/reports/:id → RESOLVED / DISMISSED', async () => {
    const { listing } = await activeListing(await newUser());
    const reporter = await newUser('Report Author');
    okTrue(await reporter.post(`/listings/${listing.id}/report`, { reason: 'ALREADY_SOLD', comment: 'Satılıb artıq' }));
    okTrue(await anon().post(`/listings/${listing.id}/report`, { reason: 'OTHER' }));
    const mod = await moderator();
    const open = ok(await mod.get('/admin/reports', { query: { status: 'OPEN', pageSize: 20 } }), D.Paginated(D.ListingReport));
    assert.ok(open.items.every((r) => r.status === 'OPEN'));
    const mine = ok(await mod.get(`/admin/listings/${listing.id}`), D.AdminListingDetail).reports;
    assert.equal(mine.length, 2);
    assert.ok(mine.every((r) => r.status === 'OPEN' && r.resolvedAt === null && r.listingTitle === listing.title));
    const sold = mine.find((r) => r.reason === 'ALREADY_SOLD')!;
    const resolved = ok(await mod.patch(`/admin/reports/${sold.id}`, { status: 'RESOLVED' }), D.ListingReport);
    assert.equal(resolved.status, 'RESOLVED');
    assert.ok(resolved.resolvedAt);
    const other = mine.find((r) => r.reason === 'OTHER')!;
    assert.equal(ok(await mod.patch(`/admin/reports/${other.id}`, { status: 'DISMISSED' }), D.ListingReport).status, 'DISMISSED');
    assert.ok(await findInPages(mod, '/admin/reports', D.ListingReport, (r) => r.id === sold.id, { status: 'RESOLVED' }), 'status filter finds it');
    const resolvedList = ok(await mod.get('/admin/reports', { query: { status: 'RESOLVED', pageSize: 20 } }), D.Paginated(D.ListingReport));
    assert.ok(resolvedList.items.every((r) => r.status === 'RESOLVED'));
    err(await mod.patch(`/admin/reports/${sold.id}`, { status: 'OPEN' }), 400, 'VALIDATION_ERROR');
    err(await mod.patch(`/admin/reports/${randomUuid()}`, { status: 'RESOLVED' }), 404, 'NOT_FOUND');
  });
});

describe('admin mortgage leads', () => {
  test('GET /admin/mortgage-leads (status) and PATCH /admin/mortgage-leads/:id', async () => {
    const lead = ok(await anon().post('/mortgage/leads', { name: 'Lead Status', phone: randomPhone(), price: 120000, downPayment: 24000, termYears: 20 }));
    const mod = await moderator();
    const upd = ok(await mod.patch(`/admin/mortgage-leads/${lead.id}`, { status: 'SENT_TO_BANK' }), D.MortgageLead);
    assert.equal(upd.status, 'SENT_TO_BANK');
    assert.ok(await findInPages(mod, '/admin/mortgage-leads', D.MortgageLead, (l) => l.id === lead.id, { status: 'SENT_TO_BANK' }));
    const sent = ok(await mod.get('/admin/mortgage-leads', { query: { status: 'SENT_TO_BANK', pageSize: 20 } }), D.Paginated(D.MortgageLead));
    assert.ok(sent.items.every((l) => l.status === 'SENT_TO_BANK'));
    ok(await mod.get('/admin/mortgage-leads'), D.Paginated(D.MortgageLead));
    err(await mod.patch(`/admin/mortgage-leads/${lead.id}`, { status: 'WON' }), 400, 'VALIDATION_ERROR');
    err(await mod.patch(`/admin/mortgage-leads/${randomUuid()}`, { status: 'CLOSED' }), 404, 'NOT_FOUND');
  });
});

describe('admin audit log', () => {
  test('GET /admin/audit-logs (ADMIN): admin actions are recorded; filters entity & actorId', async () => {
    const a = await admin();
    const u = await newUser();
    ok(await a.post(`/admin/users/${u.id}/wallet-adjust`, { amount: 500, reason: 'Audit trail' }), D.Wallet);
    const logs = ok(await a.get('/admin/audit-logs', { query: { actorId: a.id, pageSize: 50 } }), D.Paginated(D.AuditLog));
    assert.ok(logs.items.length >= 1);
    assert.ok(logs.items.every((l) => l.actor?.id === a.id));
    assert.ok(logs.items.some((l) => l.entityId === u.id), 'wallet adjustment audited');
    const byEntity = ok(await a.get('/admin/audit-logs', { query: { entity: 'user', pageSize: 20 } }), D.Paginated(D.AuditLog));
    assert.ok(byEntity.items.every((l) => l.entity === 'user'));
    err(await (await moderator()).get('/admin/audit-logs'), 403, 'FORBIDDEN');
    err(await a.get('/admin/audit-logs', { query: { actorId: 'not-a-uuid' } }), 400, 'VALIDATION_ERROR');
  });
});
