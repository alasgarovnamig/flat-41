/** Admin moderation: listing queue & filters, detail, approve / reject / block, edit (+isVerified), free promotion. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, admin, createListing, moderator, newUser, randomUuid } from '../src/fixtures';
import { anon } from '../src/http';

describe('admin listings', () => {
  test('GET /admin/listings filters: status, q, dealType, ownerId, reported', async () => {
    const owner = await newUser('Queue Owner');
    const { listing: pending, input } = await createListing(owner);
    const { listing: daily } = await activeListing(owner, {}, 'daily');
    okTrue(await anon().post(`/listings/${daily.id}/report`, { reason: 'DUPLICATE' }));
    const mod = await moderator();

    const byOwner = ok(await mod.get('/admin/listings', { query: { ownerId: owner.id } }), D.Paginated(D.AdminListing));
    assert.deepEqual(byOwner.items.map((l) => l.id).sort(), [pending.id, daily.id].sort());
    const p = byOwner.items.find((l) => l.id === pending.id)!;
    assert.equal(p.ownerId, owner.id);
    assert.equal(p.ownerName, 'Queue Owner');
    assert.equal(p.ownerPhone, owner.phone);
    assert.equal(p.reportsCount, 0);
    assert.equal(byOwner.items.find((l) => l.id === daily.id)!.reportsCount, 1);

    const pendingOnly = ok(await mod.get('/admin/listings', { query: { ownerId: owner.id, status: 'PENDING' } }), D.Paginated(D.AdminListing));
    assert.deepEqual(pendingOnly.items.map((l) => l.id), [pending.id]);
    const q = ok(await mod.get('/admin/listings', { query: { q: input.title.split(' ')[1] } }), D.Paginated(D.AdminListing));
    assert.deepEqual(q.items.map((l) => l.id), [pending.id]);
    const dt = ok(await mod.get('/admin/listings', { query: { ownerId: owner.id, dealType: 'RENT_DAILY' } }), D.Paginated(D.AdminListing));
    assert.deepEqual(dt.items.map((l) => l.id), [daily.id]);
    const reported = ok(await mod.get('/admin/listings', { query: { ownerId: owner.id, reported: 'true' } }), D.Paginated(D.AdminListing));
    assert.deepEqual(reported.items.map((l) => l.id), [daily.id]);
    err(await mod.get('/admin/listings', { query: { status: 'LIMBO' } }), 400, 'VALIDATION_ERROR');
  });

  test('GET /admin/listings/:id → ListingDetail + reports + ownerPhone (any status)', async () => {
    const owner = await newUser();
    const { listing } = await createListing(owner);
    const d = ok(await (await moderator()).get(`/admin/listings/${listing.id}`), D.AdminListingDetail);
    assert.equal(d.id, listing.id);
    assert.equal(d.status, 'PENDING');
    assert.equal(d.ownerPhone, owner.phone);
    assert.deepEqual(d.reports, []);
    err(await (await admin()).get(`/admin/listings/${randomUuid()}`), 404, 'NOT_FOUND');
  });

  test('moderation transitions: approve, reject (reason), block, re-approve; invalid transitions → 400', async () => {
    const owner = await newUser();
    const mod = await moderator();
    const { listing } = await createListing(owner);
    err(await mod.post(`/admin/listings/${listing.id}/reject`, { reason: 'x' }), 400, 'VALIDATION_ERROR');
    const rej = ok(await mod.post(`/admin/listings/${listing.id}/reject`, { reason: 'Təsvir natamamdır' }), D.AdminListing);
    assert.equal(rej.status, 'REJECTED');
    assert.equal(rej.rejectionReason, 'Təsvir natamamdır');
    assert.equal(ok(await owner.get('/me/listings', { query: { status: 'REJECTED' } }), D.Paginated(D.MyListing)).items[0].rejectionReason, 'Təsvir natamamdır');
    err(await mod.post(`/admin/listings/${listing.id}/reject`, { reason: 'Again please' }), 400, 'INVALID_STATUS_TRANSITION');

    // owner fixes it → back to the queue → approved
    const fixed = ok(await owner.patch(`/listings/${listing.id}`, { description: 'Tam təsvir: 2 otaq, təmirli, metroya yaxın, sənədlər qaydasındadır.' }), D.MyListing);
    assert.equal(fixed.status, 'PENDING');
    assert.equal(fixed.rejectionReason, null);
    const appr = ok(await mod.post(`/admin/listings/${listing.id}/approve`), D.AdminListing);
    assert.equal(appr.status, 'ACTIVE');
    assert.ok(appr.publishedAt);
    err(await mod.post(`/admin/listings/${listing.id}/approve`), 400, 'INVALID_STATUS_TRANSITION');

    const blocked = ok(await mod.post(`/admin/listings/${listing.id}/block`, { reason: 'Fırıldaqçılıq' }), D.AdminListing);
    assert.equal(blocked.status, 'BLOCKED');
    err(await mod.post(`/admin/listings/${listing.id}/block`, { reason: 'Fırıldaqçılıq' }), 400, 'INVALID_STATUS_TRANSITION');
    err(await anon().get(`/listings/${listing.id}`), 404, 'NOT_FOUND');
    err(await owner.patch(`/listings/${listing.id}`, { price: 1 }), 403, 'LISTING_BLOCKED');
    const unblocked = ok(await mod.post(`/admin/listings/${listing.id}/approve`), D.AdminListing);
    assert.equal(unblocked.status, 'ACTIVE');
    err(await mod.post(`/admin/listings/${randomUuid()}/approve`), 404, 'NOT_FOUND');
  });

  test('PATCH /admin/listings/:id edits fields and the verified badge without re-moderation', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const upd = ok(await (await moderator()).patch(`/admin/listings/${listing.id}`, { isVerified: true, price: 99000 }), D.AdminListing);
    assert.equal(upd.isVerified, true);
    assert.equal(upd.price, 99000);
    assert.equal(upd.status, 'ACTIVE');
    const pub = ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(pub.isVerified, true);
    assert.deepEqual([...pub.amenities].sort(), ['BALCONY', 'ELEVATOR'], 'untouched fields kept');
    err(await (await admin()).patch(`/admin/listings/${listing.id}`, { cityId: 'atlantis' }), 400, 'INVALID_LOCATION');
  });

  test('POST /admin/listings/:id/promote (ADMIN) applies a free promotion to an ACTIVE listing', async () => {
    const owner = await newUser();
    const { listing } = await activeListing(owner);
    const a = await admin();
    const p = ok(await a.post(`/admin/listings/${listing.id}/promote`, { serviceCode: 'PREMIUM_7' }), D.AdminListing);
    assert.equal(p.isPremium, true);
    const mine = ok(await owner.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.ok(mine.promotions.some((x) => x.type === 'PREMIUM' && x.serviceCode === 'PREMIUM_7'));
    assert.equal(ok(await owner.get('/payments'), D.Paginated(D.Payment)).total, 0, 'free: no payment');
    err(await a.post(`/admin/listings/${listing.id}/promote`, { serviceCode: 'VERIFICATION' }), 400, 'INVALID_SERVICE');
    err(await a.post(`/admin/listings/${listing.id}/promote`, { serviceCode: 'NOPE' }), 400, 'INVALID_SERVICE');
    const { listing: pending } = await createListing(owner);
    err(await a.post(`/admin/listings/${pending.id}/promote`, { serviceCode: 'VIP_1' }), 409, 'LISTING_NOT_ACTIVE');
    err(await (await moderator()).post(`/admin/listings/${listing.id}/promote`, { serviceCode: 'VIP_1' }), 403, 'FORBIDDEN');
  });
});
