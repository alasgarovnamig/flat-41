/** Notifications: produced by domain events (moderation), read / read-all, admin broadcast. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as D from '../src/dto';
import { err, eventually, ok, okTrue } from '../src/expect';
import { activeListing, admin, createListing, moderator, newUser, randomUuid, uniq } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

const list = async (u: Api, query: Record<string, any> = {}) => ok(await u.get('/notifications', { query: { pageSize: 100, ...query } }), D.Paginated(D.AppNotification));

describe('notifications', () => {
  test('moderation events notify the owner: LISTING_APPROVED / LISTING_REJECTED with data.listingId', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const approved = await eventually(async () => (await list(owner)).items.find((n) => n.type === 'LISTING_APPROVED' && n.data.listingId === listing.id), 'LISTING_APPROVED');
    assert.equal(approved.readAt, null);
    assert.ok(approved.title.length > 0);

    const { listing: second } = await createListing(owner);
    ok(await (await admin()).post(`/admin/listings/${second.id}/reject`, { reason: 'Şəkillər uyğun deyil' }), D.AdminListing);
    const rejected = await eventually(async () => (await list(owner)).items.find((n) => n.type === 'LISTING_REJECTED' && n.data.listingId === second.id), 'LISTING_REJECTED');
    assert.ok(rejected.body.length > 0);
    const own = ok(await owner.get(`/listings/${second.id}`), D.ListingDetail);
    assert.equal(own.status, 'REJECTED');
    assert.equal(own.rejectionReason, 'Şəkillər uyğun deyil');
  });

  test('read one, read all; unread counter on /auth/me; strangers cannot touch them', async () => {
    const owner = await newUser();
    await activeListing(owner);
    await activeListing(owner);
    const all = await eventually(async () => {
      const l = await list(owner);
      return l.items.filter((n) => n.type === 'LISTING_APPROVED').length >= 2 ? l : null;
    }, 'two notifications');
    const sorted = [...all.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    assert.deepEqual(all.items.map((n) => n.id), sorted.map((n) => n.id), 'newest first');
    const unread0 = ok(await owner.get('/auth/me'), D.Me).unreadNotifications;
    assert.equal(unread0, all.items.filter((n) => !n.readAt).length);

    const first = all.items[0];
    err(await (await newUser()).post(`/notifications/${first.id}/read`), 404, 'NOT_FOUND');
    okTrue(await owner.post(`/notifications/${first.id}/read`));
    okTrue(await owner.post(`/notifications/${first.id}/read`)); // idempotent
    const after1 = await list(owner);
    assert.ok(after1.items.find((n) => n.id === first.id)!.readAt, 'readAt set');
    assert.equal(ok(await owner.get('/auth/me'), D.Me).unreadNotifications, unread0 - 1);

    okTrue(await owner.post('/notifications/read-all'));
    assert.ok((await list(owner)).items.every((n) => n.readAt));
    assert.equal(ok(await owner.get('/auth/me'), D.Me).unreadNotifications, 0);
    err(await owner.post(`/notifications/${randomUuid()}/read`), 404, 'NOT_FOUND');
    err(await anon().get('/notifications'), 401, 'UNAUTHORIZED');
    err(await anon().post('/notifications/read-all'), 401, 'UNAUTHORIZED');
  });

  test('POST /admin/notifications/broadcast (ADMIN) → { sent }; audience receives a SYSTEM notification', async () => {
    const business = await newUser();
    const r = await business.post('/agencies', { name: `Broadcast Agency ${uniq()}`, type: 'AGENCY' });
    ok(r, D.Agency);
    const individual = await newUser();
    const title = `Broadcast ${uniq()}`;
    const a = await admin();
    const res = ok(await a.post('/admin/notifications/broadcast', { title, body: 'Kontrakt testi bildirişi', audience: 'BUSINESS' }));
    assert.ok(Number.isInteger(res.sent) && res.sent >= 1, '{ sent: number }');
    const got = await eventually(async () => (await list(business)).items.find((n) => n.title === title), 'broadcast notification');
    assert.equal(got.type, 'SYSTEM');
    assert.equal(got.body, 'Kontrakt testi bildirişi');
    assert.ok(!(await list(individual)).items.some((n) => n.title === title), 'other audiences are not notified');

    err(await (await moderator()).post('/admin/notifications/broadcast', { title, body: 'x', audience: 'ALL' }), 403, 'FORBIDDEN');
    err(await a.post('/admin/notifications/broadcast', { title, body: 'x', audience: 'EVERYONE' }), 400, 'VALIDATION_ERROR');
  });
});
