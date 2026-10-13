/** Agencies / business accounts: create, public pages, members (plan maxAgents), stats, admin verification. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { planPrice } from '@evtap/shared';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, admin, catalog, fund, moderator, newPasswordUser, newUser, randomPhone, randomUuid, uniq } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

async function createAgency(owner: Api, over: Record<string, unknown> = {}) {
  const name = `Contract Realty ${uniq()}`;
  const res = await owner.post('/agencies', {
    name, type: 'AGENCY', description: 'Kontrakt test agentliyi', phone: randomPhone(), email: 'office@example.test',
    website: 'https://realty.example.test', address: 'Nizami küç. 10', cityId: 'baku', ...over,
  });
  return ok(res, D.Agency);
}

describe('agencies', () => {
  test('POST /agencies → Agency; owner becomes BUSINESS + OWNER; GET /agencies/me', async () => {
    const owner = await newUser('Agency Owner');
    const { listing } = await activeListing(owner);
    const a = await createAgency(owner, { type: 'DEVELOPER' });
    assert.equal(a.type, 'DEVELOPER');
    assert.equal(a.ownerId, owner.id);
    assert.equal(a.verified, false);
    assert.equal(a.cityId, 'baku');
    assert.ok(/^[a-z0-9-]+$/.test(a.slug), 'slug is URL-safe');
    const me = ok(await owner.get('/auth/me'), D.Me);
    assert.equal(me.accountType, 'BUSINESS');
    assert.equal(me.agencyId, a.id);
    assert.equal(ok(await owner.get('/agencies/me'), D.Agency).id, a.id);
    const d = ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(d.agency?.id, a.id, 'existing listings move under the agency');
    assert.equal(d.isBusiness, true);
    assert.equal(d.owner.agency?.id, a.id);
    err(await owner.post('/agencies', { name: 'Second agency', type: 'AGENCY' }), 409, 'ALREADY_IN_AGENCY');
    err(await owner.post('/agencies', { name: 'X', type: 'AGENCY' }), 400, 'VALIDATION_ERROR');
  });

  test('public: GET /agencies (q, type, cityId) and GET /agencies/:slug', async () => {
    const owner = await newUser();
    const a = await createAgency(owner);
    await activeListing(owner);
    const bySlug = ok(await anon().get(`/agencies/${a.slug}`), D.Agency);
    assert.equal(bySlug.id, a.id);
    assert.equal(bySlug.activeListings, 1);
    const found = ok(await anon().get('/agencies', { query: { q: a.name.split(' ')[2] } }), D.Paginated(D.Agency));
    assert.deepEqual(found.items.map((x) => x.id), [a.id]);
    const typed = ok(await anon().get('/agencies', { query: { q: a.name.split(' ')[2], type: 'DEVELOPER' } }), D.Paginated(D.Agency));
    assert.equal(typed.total, 0);
    const city = ok(await anon().get('/agencies', { query: { q: a.name.split(' ')[2], cityId: 'baku' } }), D.Paginated(D.Agency));
    assert.equal(city.total, 1);
    err(await anon().get(`/agencies/no-such-${uniq().toLowerCase()}`), 404, 'NOT_FOUND');
    const byAgency = ok(await anon().get('/listings', { query: { agencyId: a.id } }), D.Paginated(D.ListingCard));
    assert.equal(byAgency.total, 1);
    assert.equal(ok(await anon().get('/listings', { query: { agencyId: a.id, ownerType: 'BUSINESS' } }), D.Paginated(D.ListingCard)).total, 1);
  });

  test('PATCH /agencies/me (owner only)', async () => {
    const owner = await newUser();
    const a = await createAgency(owner);
    const upd = ok(await owner.patch('/agencies/me', { description: 'Yeni təsvir', website: null }), D.Agency);
    assert.equal(upd.description, 'Yeni təsvir');
    assert.equal(upd.website, null);
    assert.equal(upd.name, a.name, 'partial update');
    err(await owner.patch('/agencies/me', { email: 'not-an-email' }), 400, 'VALIDATION_ERROR');
    err(await (await newUser()).patch('/agencies/me', { description: 'x' }), 404, 'NO_AGENCY');
    err(await (await newUser()).get('/agencies/me'), 404, 'NO_AGENCY');
  });

  test('members: plan maxAgents limit, add by phone / e-mail, duplicates, removal', async () => {
    const owner = await newUser('Agency Boss');
    await createAgency(owner);
    const agent = await newPasswordUser('Agent Smith');
    const members0 = ok(await owner.get('/agencies/me/members'), D.AgencyMember.array());
    assert.deepEqual(members0.map((m) => [m.userId, m.role]), [[owner.id, 'OWNER']]);

    // without a plan an agency has room for the owner only
    err(await owner.post('/agencies/me/members', { login: agent.email }), 403, 'AGENT_LIMIT_REACHED');
    const start = (await catalog()).plans.find((p) => p.code === 'START')!;
    await fund(owner, planPrice(start, 'MONTH'));
    ok(await owner.post('/checkout', { purpose: 'SUBSCRIPTION', planCode: 'START', period: 'MONTH', method: 'WALLET' }), D.CheckoutResponse);

    const m = ok(await owner.post('/agencies/me/members', { login: agent.email }), D.AgencyMember);
    assert.equal(m.userId, agent.id);
    assert.equal(m.role, 'AGENT');
    assert.equal(m.name, 'Agent Smith');
    err(await owner.post('/agencies/me/members', { login: agent.phone }), 409, 'ALREADY_MEMBER');
    err(await owner.post('/agencies/me/members', { login: 'nobody@example.test' }), 404, 'USER_NOT_FOUND');
    const other = await newUser();
    await createAgency(other);
    // a member of another agency cannot be added (the plan limit may be reported first)
    const taken = await owner.post('/agencies/me/members', { login: other.phone });
    if (taken.status === 403) err(taken, 403, 'AGENT_LIMIT_REACHED');
    else err(taken, 409, 'ALREADY_IN_AGENCY');

    const members = ok(await owner.get('/agencies/me/members'), D.AgencyMember.array());
    assert.deepEqual(members.map((x) => x.userId).sort(), [owner.id, agent.id].sort());
    const agentMe = ok(await agent.get('/auth/me'), D.Me);
    assert.equal(agentMe.accountType, 'BUSINESS');
    assert.ok(agentMe.agencyId);
    assert.equal(ok(await agent.get('/agencies/me'), D.Agency).ownerId, owner.id, 'members see their agency');
    err(await agent.get('/agencies/me/members'), 403, 'FORBIDDEN');
    err(await agent.post('/agencies/me/members', { login: other.phone }), 403, 'FORBIDDEN');

    err(await owner.del(`/agencies/me/members/${owner.id}`), 400, 'CANNOT_REMOVE_OWNER');
    okTrue(await owner.del(`/agencies/me/members/${agent.id}`));
    err(await owner.del(`/agencies/me/members/${agent.id}`), 404, 'NOT_FOUND');
    err(await owner.del(`/agencies/me/members/${randomUuid()}`), 404, 'NOT_FOUND');
    const left = ok(await agent.get('/auth/me'), D.Me);
    assert.equal(left.agencyId, null);
    err(await agent.get('/agencies/me'), 404, 'NO_AGENCY');
  });

  test('GET /agencies/me/stats?days= → views, phoneViews, messages, listings, daily series', async () => {
    const owner = await newUser();
    await createAgency(owner);
    const { listing } = await activeListing(owner);
    await anon().get(`/listings/${listing.id}`);
    await anon().post(`/listings/${listing.id}/phone`);
    const buyer = await newUser();
    ok(await buyer.post('/conversations', { listingId: listing.id, message: 'Agentliyə sual' }), D.Conversation);
    const s = ok(await owner.get('/agencies/me/stats', { query: { days: 7 } }), D.AgencyStats);
    assert.equal(s.listings, 1);
    assert.ok(s.views >= 1);
    assert.ok(s.phoneViews >= 1);
    assert.ok(s.messages >= 1);
    assert.equal(s.daily.length, 7);
    const def = ok(await owner.get('/agencies/me/stats'), D.AgencyStats);
    assert.equal(def.daily.length, 30);
    err(await owner.get('/agencies/me/stats', { query: { days: 0 } }), 400, 'VALIDATION_ERROR');
    err(await (await newUser()).get('/agencies/me/stats'), 404, 'NO_AGENCY');
  });

  test('admin: GET /admin/agencies (q, verified) and PATCH /admin/agencies/:id { verified }', async () => {
    const owner = await newUser();
    const a = await createAgency(owner);
    const q = a.name.split(' ')[2];
    for (const who of [await admin(), await moderator()]) {
      const list = ok(await who.get('/admin/agencies', { query: { q } }), D.Paginated(D.Agency));
      assert.deepEqual(list.items.map((x) => x.id), [a.id]);
    }
    const mod = await moderator();
    const v = ok(await mod.patch(`/admin/agencies/${a.id}`, { verified: true }), D.Agency);
    assert.equal(v.verified, true);
    assert.equal(ok(await anon().get(`/agencies/${a.slug}`), D.Agency).verified, true);
    const verifiedList = ok(await mod.get('/admin/agencies', { query: { q, verified: 'true' } }), D.Paginated(D.Agency));
    assert.equal(verifiedList.total, 1);
    const unverifiedList = ok(await mod.get('/admin/agencies', { query: { q, verified: 'false' } }), D.Paginated(D.Agency));
    assert.equal(unverifiedList.total, 0);
    err(await mod.patch(`/admin/agencies/${randomUuid()}`, { verified: true }), 404, 'NOT_FOUND');
    err(await mod.patch(`/admin/agencies/${a.id}`, {}), 400, 'VALIDATION_ERROR');
    err(await owner.patch(`/admin/agencies/${a.id}`, { verified: true }), 403, 'FORBIDDEN');
  });
});
