/** Business subscriptions: purchase (wallet / card), cancel / resume, plan quota, credits (apply-credit). */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { planPrice } from '@evtap/shared';
import { CARDS, payByCard } from '../src/bank';
import { bankOpts, CLIENT_RETURN_URL, dbOpts } from '../src/config';
import { closeDb, endSubscriptionPeriod } from '../src/db';
import * as D from '../src/dto';
import { err, ok } from '../src/expect';
import { activeListing, admin, catalog, findInPages, fund, moderator, newUser, randomUuid } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

const bank = await bankOpts();
after(closeDb);

const plan = async (code: 'START' | 'PRO' | 'ENTERPRISE') => (await catalog()).plans.find((p) => p.code === code)!;
/** `Subscription | null` — "no subscription" must be the JSON literal `null` (an empty body breaks JSON decoders). */
const subOrNull = (res: { status: number; body: unknown; text: string }) => {
  assert.equal(res.status, 200, res.text);
  if (res.text.trim() === 'null') return null;
  assert.notEqual(res.text.trim(), '', 'GET /subscriptions/me must answer the JSON literal null, not an empty body');
  return D.Subscription.parse(res.body);
};

async function subscribeByWallet(u: Api, code: 'START' | 'PRO' | 'ENTERPRISE', period: 'MONTH' | 'YEAR' = 'MONTH', autoRenew?: boolean) {
  const p = await plan(code);
  await fund(u, planPrice(p, period));
  const co = ok(await u.post('/checkout', { purpose: 'SUBSCRIPTION', planCode: code, period, method: 'WALLET', ...(autoRenew === undefined ? {} : { autoRenew }) }), D.CheckoutResponse);
  assert.equal(co.status, 'SUCCEEDED');
  assert.equal(co.amount, planPrice(p, period));
  return ok(await u.get('/subscriptions/me'), D.Subscription);
}

describe('subscriptions', () => {
  test('GET /subscriptions/me → JSON null without a plan', async () => {
    const u = await newUser();
    assert.equal(subOrNull(await u.get('/subscriptions/me')), null);
  });

  test('without a plan: cancel / resume → 404; anonymous → 401', async () => {
    const u = await newUser();
    err(await u.post('/subscriptions/me/cancel'), 404, 'NOT_FOUND');
    err(await u.post('/subscriptions/me/resume'), 404, 'NOT_FOUND');
    err(await anon().get('/subscriptions/me'), 401, 'UNAUTHORIZED');
  });

  test('buy START monthly by wallet → ACTIVE subscription; account becomes BUSINESS; quota follows the plan', async () => {
    const u = await newUser();
    const start = await plan('START');
    const s = await subscribeByWallet(u, 'START');
    assert.equal(s.planCode, 'START');
    assert.equal(s.period, 'MONTH');
    assert.equal(s.status, 'ACTIVE');
    assert.equal(s.autoRenew, true);
    assert.equal(s.cardMask, null);
    const days = (Date.parse(s.currentPeriodEnd) - Date.parse(s.currentPeriodStart)) / 86_400_000;
    assert.ok(days >= 28 && days <= 31, `one calendar month (${days} days)`);
    assert.equal(s.usage.listingQuota, start.listingQuota);
    assert.equal(s.usage.bumpsLeft, start.monthlyBumps);
    assert.equal(s.usage.vipCreditsLeft, start.monthlyVipCredits);
    assert.equal(s.usage.activeListings, 0);

    const me = ok(await u.get('/auth/me'), D.Me);
    assert.equal(me.accountType, 'BUSINESS');
    assert.equal(me.subscription?.id, s.id);
    assert.equal(me.quota.freeLimit, start.listingQuota);
    assert.equal(me.quota.remaining, start.listingQuota);

    const { listing } = await activeListing(u);
    assert.equal(listing.isBusiness, true, 'business accounts post business listings');
    assert.equal(ok(await u.get('/subscriptions/me'), D.Subscription).usage.activeListings, 1);
    const pay = ok(await u.get('/payments'), D.Paginated(D.Payment)).items.find((p) => p.purpose === 'SUBSCRIPTION')!;
    assert.equal(pay.amount, start.priceMonthly);
  });

  test('cancel → CANCELLED (autoRenew off, still valid until period end); resume → ACTIVE', async () => {
    const u = await newUser();
    const s = await subscribeByWallet(u, 'START');
    const c = ok(await u.post('/subscriptions/me/cancel'), D.Subscription);
    assert.equal(c.id, s.id);
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.autoRenew, false);
    assert.equal(c.currentPeriodEnd, s.currentPeriodEnd);
    assert.equal(ok(await u.get('/auth/me'), D.Me).quota.freeLimit, s.usage.listingQuota, 'plan benefits stay until the end');
    const r = ok(await u.post('/subscriptions/me/resume'), D.Subscription);
    assert.equal(r.status, 'ACTIVE');
    assert.equal(r.autoRenew, true);
  });

  test('autoRenew=false at purchase → CANCELLED from the start', async () => {
    const u = await newUser();
    const s = await subscribeByWallet(u, 'START', 'MONTH', false);
    assert.equal(s.autoRenew, false);
    assert.equal(s.status, 'CANCELLED');
  });

  test('resume after the period ended → 409 SUBSCRIPTION_ENDED', dbOpts, async () => {
    const u = await newUser();
    await subscribeByWallet(u, 'START');
    ok(await u.post('/subscriptions/me/cancel'), D.Subscription);
    await endSubscriptionPeriod(u.id);
    err(await u.post('/subscriptions/me/resume'), 409, 'SUBSCRIPTION_ENDED');
  });

  test('buy PRO yearly by card with 3-D Secure → card saved for renewals', bank, async () => {
    const u = await newUser();
    const pro = await plan('PRO');
    const co = ok(await u.post('/checkout', { purpose: 'SUBSCRIPTION', planCode: 'PRO', period: 'YEAR', method: 'CARD', returnUrl: CLIENT_RETURN_URL }), D.CheckoutResponse);
    assert.equal(co.amount, pro.priceYearly);
    const r = await payByCard(co.paymentUrl!, { card: CARDS.threeDs, saveCard: true });
    assert.equal(r.status, 'SUCCEEDED');
    const s = ok(await u.get('/subscriptions/me'), D.Subscription);
    assert.equal(s.planCode, 'PRO');
    assert.equal(s.period, 'YEAR');
    assert.equal(s.status, 'ACTIVE');
    assert.ok(s.cardMask && s.cardMask.endsWith('4444'), 'saved card mask shown');
    const days = (Date.parse(s.currentPeriodEnd) - Date.parse(s.currentPeriodStart)) / 86_400_000;
    assert.ok(days >= 365 && days <= 366);
  });

  test('POST /listings/:id/apply-credit spends plan credits (BUMP, VIP_7, PREMIUM_7)', async () => {
    const u = await newUser();
    const pro = await plan('PRO');
    await subscribeByWallet(u, 'PRO');
    const { listing } = await activeListing(u);
    const vip = ok(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'VIP_7' }), D.MyListing);
    assert.equal(vip.isVip, true);
    assert.ok(vip.promotions.some((p) => p.type === 'VIP'));
    const before = Date.parse(vip.bumpedAt);
    const bumped = ok(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'BUMP' }), D.MyListing);
    assert.ok(Date.parse(bumped.bumpedAt) >= before);
    const s = ok(await u.get('/subscriptions/me'), D.Subscription);
    assert.equal(s.usage.vipCreditsLeft, pro.monthlyVipCredits - 1);
    assert.equal(s.usage.bumpsLeft, pro.monthlyBumps - 1);
    for (let i = 0; i < pro.monthlyPremiumCredits; i++) ok(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'PREMIUM_7' }), D.MyListing);
    err(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'PREMIUM_7' }), 402, 'NO_CREDITS');
    err(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'GOLD' }), 400, 'VALIDATION_ERROR');
    err(await (await newUser()).post(`/listings/${listing.id}/apply-credit`, { credit: 'BUMP' }), 403, 'FORBIDDEN');
    err(await u.post(`/listings/${randomUuid()}/apply-credit`, { credit: 'BUMP' }), 404, 'NOT_FOUND');
  });

  test('apply-credit without a subscription → 402 NO_SUBSCRIPTION; START has no VIP credits → 402 NO_CREDITS', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    err(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'BUMP' }), 402, 'NO_SUBSCRIPTION');
    const start = await plan('START');
    await subscribeByWallet(u, 'START');
    if (start.monthlyVipCredits === 0) err(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'VIP_7' }), 402, 'NO_CREDITS');
    ok(await u.post(`/listings/${listing.id}/apply-credit`, { credit: 'BUMP' }), D.MyListing);
  });

  test('GET /admin/subscriptions (status filter) for ADMIN and MODERATOR', async () => {
    const u = await newUser('Subscriber Contract');
    const s = await subscribeByWallet(u, 'START');
    for (const who of [await admin(), await moderator()]) {
      const list = ok(await who.get('/admin/subscriptions', { query: { status: 'ACTIVE', pageSize: 20 } }), D.Paginated(D.AdminSubscription));
      assert.ok(list.items.every((x) => x.status === 'ACTIVE'));
      const mine = await findInPages(who, '/admin/subscriptions', D.AdminSubscription, (x) => x.id === s.id, { status: 'ACTIVE' });
      assert.ok(mine, 'new subscription listed');
      assert.equal(mine.user.id, u.id);
      assert.equal(mine.agency, null);
    }
    err(await u.get('/admin/subscriptions'), 403, 'FORBIDDEN');
  });
});
