/**
 * POST /checkout for every purpose — by WALLET and by CARD through the real mock bank (hosted checkout, 3-D Secure,
 * bank → API return → client returnUrl) — payments list/detail, the signed bank webhook, the return redirect,
 * and admin payment views / refunds.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { topupBonus } from '@evtap/shared';
import { bankHeaders, bankOrder, CARDS, payByCard } from '../src/bank';
import { bankOpts, CLIENT_RETURN_URL } from '../src/config';
import * as D from '../src/dto';
import { err, eventually, ok, okTrue } from '../src/expect';
import { activeListing, admin, catalog, createListing, fund, moderator, newUser, randomUuid, wallet } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

const bank = await bankOpts();
const price = async (code: string) => (await catalog()).services.find((s) => s.code === code)!.price;

async function draftListing(owner: Api) {
  const me = ok(await owner.get('/auth/me'), D.Me);
  for (let i = 0; i < me.quota.remaining; i++) await createListing(owner);
  const { listing } = await createListing(owner);
  assert.equal(listing.status, 'DRAFT');
  return listing;
}

async function payCard(api: Api, body: Record<string, unknown>, card: string = CARDS.frictionless) {
  const co = ok(await api.post('/checkout', { ...body, method: 'CARD', returnUrl: CLIENT_RETURN_URL }), D.CheckoutResponse);
  assert.equal(co.status, 'PENDING');
  assert.ok(co.paymentUrl, 'CARD checkout returns the hosted payment page');
  const result = await payByCard(co.paymentUrl!, { card });
  assert.equal(result.paymentId, co.paymentId);
  const u = new URL(result.clientUrl);
  assert.equal(`${u.protocol}//${u.host}${u.pathname}`, CLIENT_RETURN_URL, 'redirected to the client returnUrl');
  return { co, result, payment: ok(await api.get(`/payments/${co.paymentId}`), D.Payment) };
}

describe('checkout by WALLET', () => {
  test('PROMOTION (serviceCodes) → SUCCEEDED; promotions applied; SPEND transaction', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const amount = (await price('VIP_7')) + (await price('URGENT_7'));
    await fund(u, amount + 100);
    const co = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['VIP_7', 'URGENT_7'], method: 'WALLET' }), D.CheckoutResponse);
    assert.equal(co.status, 'SUCCEEDED');
    assert.equal(co.amount, amount);
    assert.equal(co.currency, 'AZN');
    assert.equal(co.paymentUrl, null);
    assert.deepEqual(await wallet(u), { balance: 100, bonusBalance: 0, currency: 'AZN' });

    const p = ok(await u.get(`/payments/${co.paymentId}`), D.Payment);
    assert.equal(p.purpose, 'PROMOTION');
    assert.equal(p.method, 'WALLET');
    assert.equal(p.status, 'SUCCEEDED');
    assert.equal(p.listingId, listing.id);
    assert.equal(p.userId, u.id);
    assert.deepEqual(p.items.map((i) => i.code), ['VIP_7', 'URGENT_7']);
    assert.equal(p.items.reduce((s, i) => s + i.amount, 0), amount);
    assert.ok(p.paidAt);
    assert.equal(p.provider, null);

    const mine = ok(await u.get('/me/listings'), D.Paginated(D.MyListing)).items.find((l) => l.id === listing.id)!;
    assert.equal(mine.isVip, true);
    assert.equal(mine.isUrgent, true);
    assert.deepEqual(mine.promotions.map((x) => x.type).sort(), ['URGENT', 'VIP']);
    assert.ok(mine.promotions.every((x) => x.endsAt && Date.parse(x.endsAt) > Date.now() + 6 * 86_400_000));
    const owned = ok(await u.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(owned.promotions.length, 2, 'owner sees the active promotions');

    const txs = ok(await u.get('/wallet/transactions'), D.Paginated(D.WalletTransaction));
    const spend = txs.items.find((t) => t.paymentId === co.paymentId)!;
    assert.equal(spend.type, 'SPEND');
    assert.equal(spend.amount, -amount);
    assert.equal(spend.balanceAfter, 100);
  });

  test('PROMOTION bundle → bundle price; BUMP_1 moves the listing to the top', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const cat = await catalog();
    const bundle = cat.bundles.find((b) => b.code === 'FAST_SALE')!;
    await fund(u, bundle.price + (await price('BUMP_1')));
    const co = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, bundleCode: 'FAST_SALE', method: 'WALLET' }), D.CheckoutResponse);
    assert.equal(co.amount, bundle.price);
    const d = ok(await u.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(d.isVip, true);
    assert.equal(d.isUrgent, true);

    const before = Date.parse(d.bumpedAt);
    ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['BUMP_1'], method: 'WALLET' }), D.CheckoutResponse);
    const bumped = ok(await u.get(`/listings/${listing.id}`), D.ListingDetail);
    assert.ok(Date.parse(bumped.bumpedAt) > before, 'bumpedAt moved forward');
    assert.equal((await wallet(u)).balance, 0);
  });

  test('VERIFICATION → listing isVerified; buying again → 409 ALREADY_VERIFIED', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    await fund(u, (await price('VERIFICATION')) * 2);
    const co = ok(await u.post('/checkout', { purpose: 'VERIFICATION', listingId: listing.id, method: 'WALLET' }), D.CheckoutResponse);
    assert.equal(co.amount, await price('VERIFICATION'));
    assert.equal(ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail).isVerified, true);
    err(await u.post('/checkout', { purpose: 'VERIFICATION', listingId: listing.id, method: 'WALLET' }), 409, 'ALREADY_VERIFIED');
  });

  test('checkout errors', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const stranger = await newUser();
    await fund(stranger, 100_000);
    err(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['VIP_7'], method: 'WALLET' }), 402, 'INSUFFICIENT_FUNDS');
    err(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, method: 'WALLET' }), 400, 'VALIDATION_ERROR');
    err(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['NO_SUCH_SERVICE'], method: 'WALLET' }), 400, 'INVALID_SERVICE');
    err(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['VERIFICATION'], method: 'WALLET' }), 400, 'INVALID_SERVICE');
    err(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, bundleCode: 'NO_SUCH_BUNDLE', method: 'WALLET' }), 400, 'INVALID_SERVICE');
    err(await stranger.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['VIP_7'], method: 'WALLET' }), 403, 'FORBIDDEN');
    err(await u.post('/checkout', { purpose: 'PROMOTION', listingId: randomUuid(), serviceCodes: ['VIP_7'], method: 'WALLET' }), 404, 'NOT_FOUND');
    err(await u.post('/checkout', { purpose: 'LISTING_FEE', listingId: listing.id, method: 'WALLET' }), 409, 'LISTING_STATUS_INVALID');
    err(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount: 5000, method: 'WALLET' }), 400, 'VALIDATION_ERROR');
    err(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount: 50, method: 'CARD' }), 400, 'VALIDATION_ERROR');
    const { settings } = await catalog();
    err(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount: settings.maxTopup + 100, method: 'CARD' }), 400, 'AMOUNT_OUT_OF_RANGE');
    err(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount: 5000, method: 'CARD', returnUrl: 'https://evil.example.com/steal' }), 400, 'RETURN_URL_NOT_ALLOWED');
    err(await u.post('/checkout', { purpose: 'SUBSCRIPTION', planCode: 'GOLD', period: 'MONTH', method: 'WALLET' }), 400, 'VALIDATION_ERROR');
    err(await u.post('/checkout', { purpose: 'DONATION', amount: 100, method: 'WALLET' }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/checkout', { purpose: 'WALLET_TOPUP', amount: 5000, method: 'CARD' }), 401, 'UNAUTHORIZED');
    const list = ok(await u.get('/payments'), D.Paginated(D.Payment));
    assert.ok(list.items.every((p) => p.status !== 'SUCCEEDED'), 'rejected checkouts never produce a succeeded payment');
  });

  test('GET /payments (own, newest first) and GET /payments/:id (own only)', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    await fund(u, 10_000);
    const a = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['BUMP_1'], method: 'WALLET' }), D.CheckoutResponse);
    const b = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['HIGHLIGHT_7'], method: 'WALLET' }), D.CheckoutResponse);
    const list = ok(await u.get('/payments'), D.Paginated(D.Payment));
    assert.deepEqual(list.items.map((p) => p.id), [b.paymentId, a.paymentId]);
    assert.equal(list.total, 2);
    ok(await u.get(`/payments/${a.paymentId}`), D.Payment);
    err(await (await newUser()).get(`/payments/${a.paymentId}`), 404, 'NOT_FOUND');
    err(await u.get(`/payments/${randomUuid()}`), 404, 'NOT_FOUND');
    err(await anon().get('/payments'), 401, 'UNAUTHORIZED');
  });
});

describe('checkout by CARD (mock bank)', () => {
  test('WALLET_TOPUP 50 ₼ → SUCCEEDED; balance + bonus credited (TOPUP + BONUS transactions)', bank, async () => {
    const u = await newUser();
    const { settings } = await catalog();
    const amount = 5000;
    const { payment, result } = await payCard(u, { purpose: 'WALLET_TOPUP', amount });
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(payment.status, 'SUCCEEDED');
    assert.equal(payment.purpose, 'WALLET_TOPUP');
    assert.equal(payment.method, 'CARD');
    assert.equal(payment.amount, amount);
    assert.equal(payment.provider, 'mockbank');
    assert.ok(payment.providerOrderId);
    assert.equal(payment.cardMask, '411111******1111');
    const bonus = topupBonus(amount, settings as any);
    assert.deepEqual(await wallet(u), { balance: amount, bonusBalance: bonus, currency: 'AZN' });
    const txs = ok(await u.get('/wallet/transactions'), D.Paginated(D.WalletTransaction)).items.filter((t) => t.paymentId === payment.id);
    assert.deepEqual(txs.map((t) => t.type).sort(), bonus ? ['BONUS', 'TOPUP'] : ['TOPUP']);
    assert.equal(txs.find((t) => t.type === 'TOPUP')!.amount, amount);
  });

  test('PROMOTION with a 3-D Secure card (OTP 111111) → SUCCEEDED; promotion applied', bank, async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const { payment } = await payCard(u, { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['PREMIUM_7'] }, CARDS.threeDs);
    assert.equal(payment.status, 'SUCCEEDED');
    assert.equal(payment.cardMask?.slice(-4), '4444');
    assert.equal(ok(await u.get(`/listings/${listing.id}`), D.ListingDetail).isPremium, true);
  });

  test('LISTING_FEE by card → DRAFT goes to moderation', bank, async () => {
    const u = await newUser();
    const draft = await draftListing(u);
    const { payment } = await payCard(u, { purpose: 'LISTING_FEE', listingId: draft.id });
    assert.equal(payment.status, 'SUCCEEDED');
    assert.equal(payment.amount, ok(await u.get('/auth/me'), D.Me).quota.listingFee);
    const d = ok(await u.get(`/listings/${draft.id}`), D.ListingDetail);
    assert.ok(['PENDING', 'ACTIVE'].includes(d.status));
  });

  test('VERIFICATION by card → isVerified', bank, async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const { payment } = await payCard(u, { purpose: 'VERIFICATION', listingId: listing.id }, CARDS.threeDs2);
    assert.equal(payment.status, 'SUCCEEDED');
    assert.equal(ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail).isVerified, true);
  });

  test('declined card → FAILED with failureReason; nothing granted; PAYMENT_FAILED notification', bank, async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const { result, payment } = await payCard(u, { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['VIP_7'] }, CARDS.declined);
    assert.equal(result.status, 'FAILED');
    assert.equal(payment.status, 'FAILED');
    assert.ok(payment.failureReason);
    assert.equal(ok(await u.get(`/listings/${listing.id}`), D.ListingDetail).isVip, false);
    const notes = await eventually(async () => {
      const n = ok(await u.get('/notifications'), D.Paginated(D.AppNotification)).items.filter((x) => x.type === 'PAYMENT_FAILED');
      return n.length ? n : null;
    }, 'PAYMENT_FAILED notification');
    assert.equal(notes[0].data.paymentId, payment.id);
  });

  test('customer presses Cancel on the bank page → CANCELLED', bank, async () => {
    const u = await newUser();
    const co = ok(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount: 1000, method: 'CARD', returnUrl: CLIENT_RETURN_URL }), D.CheckoutResponse);
    const result = await payByCard(co.paymentUrl!, { action: 'cancel' });
    assert.equal(result.status, 'CANCELLED');
    assert.equal(ok(await u.get(`/payments/${co.paymentId}`), D.Payment).status, 'CANCELLED');
    assert.equal((await wallet(u)).balance, 0);
  });
});

describe('bank callbacks', () => {
  test('POST /payments/webhook/mockbank: unsigned / forged → 401 INVALID_SIGNATURE', async () => {
    const body = JSON.stringify({ event: 'order.approved', order: { orderId: 'ord_forged', merchantOrderId: randomUuid(), amount: 100, currency: 'AZN', status: 'APPROVED' } });
    const post = (headers: Record<string, string>) => anon().call('POST', '/payments/webhook/mockbank', { body: JSON.parse(body), headers });
    err(await post({}), 401, 'INVALID_SIGNATURE');
    err(await post(bankHeaders(body, 'wrong-secret')), 401, 'INVALID_SIGNATURE');
  });

  test('signed webhook replay is acknowledged and idempotent (no double credit)', bank, async () => {
    const u = await newUser();
    const { payment } = await payCard(u, { purpose: 'WALLET_TOPUP', amount: 2000 });
    const before = await wallet(u);
    const order = await bankOrder(payment.providerOrderId!);
    const payload = { event: 'order.approved', order };
    const res = await anon().call('POST', '/payments/webhook/mockbank', { body: payload, headers: bankHeaders(JSON.stringify(payload)) });
    okTrue(res);
    assert.deepEqual(await wallet(u), before, 'replayed webhook does not credit twice');
  });

  test('GET /payments/return/mockbank → 302 to the client returnUrl with paymentId & status', bank, async () => {
    const u = await newUser();
    const co = ok(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount: 1500, method: 'CARD', returnUrl: CLIENT_RETURN_URL }), D.CheckoutResponse);
    // returning before paying: the payment is still pending
    const res = await anon().get('/payments/return/mockbank', { query: { paymentId: co.paymentId } });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location')!);
    assert.equal(`${loc.protocol}//${loc.host}${loc.pathname}`, CLIENT_RETURN_URL);
    assert.equal(loc.searchParams.get('paymentId'), co.paymentId);
    assert.equal(loc.searchParams.get('status'), 'PENDING');
    const unknown = await anon().get('/payments/return/mockbank', { query: { paymentId: randomUuid() } });
    assert.equal(unknown.status, 302);
    assert.equal(new URL(unknown.headers.get('location')!).searchParams.get('status'), 'FAILED');
  });
});

describe('admin payments', () => {
  test('GET /admin/payments (filters), GET /admin/payments/:id', async () => {
    const u = await newUser('Payer Contract');
    const { listing } = await activeListing(u);
    await fund(u, 10_000);
    const co = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['BUMP_1'], method: 'WALLET' }), D.CheckoutResponse);
    for (const who of [await admin(), await moderator()]) {
      const list = ok(await who.get('/admin/payments', { query: { userId: u.id } }), D.Paginated(D.AdminPayment));
      assert.deepEqual(list.items.map((p) => p.id), [co.paymentId]);
      assert.equal(list.items[0].userName, 'Payer Contract');
      const filtered = ok(await who.get('/admin/payments', { query: { userId: u.id, purpose: 'WALLET_TOPUP' } }), D.Paginated(D.AdminPayment));
      assert.equal(filtered.total, 0);
      const succeeded = ok(await who.get('/admin/payments', { query: { status: 'SUCCEEDED', pageSize: 5 } }), D.Paginated(D.AdminPayment));
      assert.ok(succeeded.items.every((p) => p.status === 'SUCCEEDED'));
      const d = ok(await who.get(`/admin/payments/${co.paymentId}`), D.AdminPaymentDetail);
      assert.equal(d.user.id, u.id);
    }
    err(await (await admin()).get(`/admin/payments/${randomUuid()}`), 404, 'NOT_FOUND');
    err(await u.get('/admin/payments'), 403, 'FORBIDDEN');
  });

  test('POST /admin/payments/:id/refund: wallet payment → partial then full refund to the wallet (ADMIN only)', async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const amount = await price('VIP_7');
    await fund(u, amount);
    const co = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['VIP_7'], method: 'WALLET' }), D.CheckoutResponse);
    const a = await admin();
    err(await (await moderator()).post(`/admin/payments/${co.paymentId}/refund`, { amount: 100 }), 403, 'FORBIDDEN');
    err(await a.post(`/admin/payments/${co.paymentId}/refund`, { amount: amount + 1 }), 400, 'REFUND_AMOUNT_INVALID');
    const part = ok(await a.post(`/admin/payments/${co.paymentId}/refund`, { amount: 200, reason: 'Kompensasiya' }), D.Payment);
    assert.equal(part.status, 'PARTIALLY_REFUNDED');
    assert.equal(part.refundedAmount, 200);
    assert.equal((await wallet(u)).balance, 200);
    const full = ok(await a.post(`/admin/payments/${co.paymentId}/refund`, {}), D.Payment);
    assert.equal(full.status, 'REFUNDED');
    assert.equal(full.refundedAmount, amount);
    assert.equal((await wallet(u)).balance, amount);
    const txs = ok(await u.get('/wallet/transactions'), D.Paginated(D.WalletTransaction)).items.filter((t) => t.type === 'REFUND');
    assert.equal(txs.reduce((s, t) => s + t.amount, 0), amount);
    err(await a.post(`/admin/payments/${co.paymentId}/refund`, {}), 409, 'NOT_REFUNDABLE');
    err(await a.post(`/admin/payments/${randomUuid()}/refund`, {}), 404, 'NOT_FOUND');
  });

  test('POST /admin/payments/:id/refund: card payment → refunded through the bank', bank, async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    const { payment } = await payCard(u, { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['HIGHLIGHT_7'] });
    const r = ok(await (await admin()).post(`/admin/payments/${payment.id}/refund`, { reason: 'Test refund' }), D.Payment);
    assert.equal(r.status, 'REFUNDED');
    assert.equal(r.refundedAmount, payment.amount);
    const order = await bankOrder(payment.providerOrderId!);
    assert.equal(order.status, 'REFUNDED');
    assert.equal((await wallet(u)).balance, 0, 'card refunds go back to the card, not the wallet');
  });
});
