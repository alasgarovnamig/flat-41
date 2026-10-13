/**
 * Money workstream tests (node:test). Run: `pnpm --filter @evtap/api test`
 *  - pure: booking price math, cancellation refund policy, bonus-first debit split, HMAC webhook verification
 *  - integration (needs DATABASE_URL with the schema pushed; skipped when Postgres is unreachable): the full Nest app
 *    on an ephemeral port + the fake bank (test/fake-bank.ts) → wallet locking, card top-up through the signed webhook,
 *    idempotent / race-safe fulfilment, forged webhooks, double-booking prevention.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { calcBooking, DEFAULT_SETTINGS, nightsBetween, topupBonus } from '@evtap/shared';
import { cancellationOutcome, checkInMoment, localToday, rangesOverlap } from '../src/modules/bookings/booking-policy';
import { parseMockbankOrder, signMockbank, verifyMockbankSignature, MockBankProvider } from '../src/modules/payments/providers/mockbank.provider';
import { InvalidSignatureError } from '../src/modules/payments/providers/payment-provider';
import { extendUntil } from '../src/modules/promotions/promotions.service';
import { addPeriod } from '../src/modules/subscriptions/subscriptions.service';
import { splitDebit } from '../src/modules/wallet/wallet.service';
import { isAllowedReturnUrl, buildClientReturn } from '../src/modules/payments/payments.service';
import { startFakeBank } from './fake-bank';

// ───────────────────────────── Pure ─────────────────────────────

describe('booking price math', () => {
  test('3 nights × 100 ₼ with 8 % guest fee and 3 % host fee', () => {
    const r = calcBooking(100, nightsBetween('2026-11-01', '2026-11-04'), DEFAULT_SETTINGS);
    assert.deepEqual(r, { subtotal: 30000, guestFee: 2400, hostFee: 900, total: 32400, hostPayout: 29100 });
  });
  test('rounding stays in integer minor units', () => {
    const r = calcBooking(37, 3, { dailyRentGuestFeePercent: 7.5, dailyRentHostFeePercent: 3 });
    assert.equal(r.subtotal, 11100);
    assert.equal(r.guestFee, 833); // 832.5 → 833
    assert.ok(Number.isInteger(r.total) && Number.isInteger(r.hostPayout));
    assert.equal(r.total, r.subtotal + r.guestFee);
  });
  test('date ranges are half-open (back-to-back stays allowed)', () => {
    assert.equal(rangesOverlap('2026-11-01', '2026-11-04', '2026-11-04', '2026-11-06'), false);
    assert.equal(rangesOverlap('2026-11-01', '2026-11-04', '2026-11-03', '2026-11-06'), true);
    assert.equal(rangesOverlap('2026-11-02', '2026-11-03', '2026-11-01', '2026-11-06'), true);
  });
  test('check-in moment uses Baku time and the listing check-in time', () => {
    assert.equal(checkInMoment('2026-11-01', '15:00').toISOString(), '2026-11-01T11:00:00.000Z');
    assert.equal(checkInMoment('2026-11-01', null).toISOString(), '2026-11-01T10:00:00.000Z');
    assert.equal(localToday(new Date('2026-11-01T21:30:00Z')), '2026-11-02');
  });
  test('top-up bonus tiers', () => {
    assert.equal(topupBonus(4999), 0);
    assert.equal(topupBonus(5000), 250);
    assert.equal(topupBonus(10000), 1000);
    assert.equal(topupBonus(30000), 4500);
  });
});

describe('cancellation refund policy', () => {
  const b = { subtotal: 30000, guestFee: 2400, hostFee: 900, total: 32400 };
  test('guest ≥ freeCancellationHours before check-in → 100 % of total', () => {
    assert.deepEqual(cancellationOutcome(b, 'GUEST', 48, 48), { refund: 32400, hostPayout: 0, policy: 'FULL' });
  });
  test('guest later → 50 % of subtotal, fee kept, host keeps the rest minus commission', () => {
    assert.deepEqual(cancellationOutcome(b, 'GUEST', 47.9, 48), { refund: 15000, hostPayout: 15000 - 450, policy: 'PARTIAL' });
  });
  test('host or admin cancel → 100 % regardless of timing', () => {
    assert.equal(cancellationOutcome(b, 'HOST', 1, 48).refund, 32400);
    assert.equal(cancellationOutcome(b, 'ADMIN', -10, 48).refund, 32400);
  });
});

describe('wallet debit split (bonus first)', () => {
  test('bonus is spent before real money', () => {
    assert.deepEqual(splitDebit({ balance: 1000, bonusBalance: 300 }, 500), { ok: true, fromBonus: 300, fromReal: 200 });
    assert.deepEqual(splitDebit({ balance: 1000, bonusBalance: 800 }, 500), { ok: true, fromBonus: 500, fromReal: 0 });
  });
  test('insufficient funds', () => {
    assert.equal(splitDebit({ balance: 100, bonusBalance: 300 }, 500).ok, false);
  });
  test('REAL_ONLY / BONUS_ONLY sources', () => {
    assert.deepEqual(splitDebit({ balance: 1000, bonusBalance: 300 }, 500, 'REAL_ONLY'), { ok: true, fromBonus: 0, fromReal: 500 });
    assert.equal(splitDebit({ balance: 1000, bonusBalance: 300 }, 500, 'BONUS_ONLY').ok, false);
  });
});

describe('promotions & subscriptions date math', () => {
  test('promotion periods stack from max(now, current end)', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    assert.equal(extendUntil(null, 7, now).toISOString(), '2026-10-20T00:00:00.000Z');
    assert.equal(extendUntil(new Date('2026-10-15T00:00:00Z'), 7, now).toISOString(), '2026-10-22T00:00:00.000Z');
    assert.equal(extendUntil(new Date('2026-10-01T00:00:00Z'), 7, now).toISOString(), '2026-10-20T00:00:00.000Z');
  });
  test('calendar months clamp to month end', () => {
    assert.equal(addPeriod(new Date('2026-01-31T10:00:00Z'), 'MONTH').toISOString(), '2026-02-28T10:00:00.000Z');
    assert.equal(addPeriod(new Date('2026-10-13T10:00:00Z'), 'YEAR').toISOString(), '2027-10-13T10:00:00.000Z');
  });
});

describe('mockbank webhook signature', () => {
  const cfg = { merchantId: 'evtap', secret: 'evtap-mockbank-secret' };
  const order = { orderId: 'ord_1', merchantOrderId: '00000000-0000-4000-8000-000000000000', amount: 1500, currency: 'AZN', status: 'APPROVED' };
  const raw = JSON.stringify({ event: 'order.approved', order });
  const headers = (ts: string, sig: string, m = 'evtap') => ({ 'x-merchant-id': m, 'x-timestamp': ts, 'x-signature': sig });

  test('HMAC_SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex', () => {
    // reference: printf '%s' '1700000000000.{}' | openssl dgst -sha256 -hmac evtap-mockbank-secret
    assert.equal(signMockbank(cfg.secret, '1700000000000', '{}'), '270788c4b3af7ab78a9f2ca52ccc54d54cceca091efa8670138593b933ec2c68');
    assert.notEqual(signMockbank(cfg.secret, '1700000000000', '{}'), signMockbank(cfg.secret, '1700000000001', '{}'));
  });
  test('valid signature passes and the order is parsed', () => {
    const ts = String(Date.now());
    const ev = new MockBankProvider({ ...cfg, url: 'http://unused' }).verifyWebhook(headers(ts, signMockbank(cfg.secret, ts, raw)), Buffer.from(raw));
    assert.equal(ev.event, 'order.approved');
    assert.equal(ev.order.amount, 1500);
  });
  test('tampered body, wrong secret, unknown merchant, stale timestamp, missing headers are rejected', () => {
    const ts = String(Date.now());
    const sig = signMockbank(cfg.secret, ts, raw);
    assert.throws(() => verifyMockbankSignature(cfg, headers(ts, sig), raw.replace('1500', '1')), InvalidSignatureError);
    assert.throws(() => verifyMockbankSignature(cfg, headers(ts, signMockbank('other', ts, raw)), raw), InvalidSignatureError);
    assert.throws(() => verifyMockbankSignature(cfg, headers(ts, sig, 'acme'), raw), InvalidSignatureError);
    const old = String(Date.now() - 6 * 60_000);
    assert.throws(() => verifyMockbankSignature(cfg, headers(old, signMockbank(cfg.secret, old, raw)), raw), InvalidSignatureError);
    assert.throws(() => verifyMockbankSignature(cfg, {}, raw), InvalidSignatureError);
  });
  test('malformed orders are refused', () => {
    assert.throws(() => parseMockbankOrder({ orderId: 'x', merchantOrderId: 'y', status: 'WHATEVER' }));
  });
});

describe('payment return URLs', () => {
  test('mobile scheme and web origin allowed, foreign origins refused', () => {
    assert.equal(isAllowedReturnUrl('evtap://payment/result'), true);
    assert.equal(isAllowedReturnUrl('http://localhost:3000/payment/result'), true);
    assert.equal(isAllowedReturnUrl('https://evil.example.com/payment/result'), false);
    assert.equal(isAllowedReturnUrl('javascript:alert(1)'), false);
  });
  test('status and paymentId appended for custom schemes', () => {
    assert.equal(buildClientReturn('evtap://payment/result', 'p1', 'SUCCEEDED'), 'evtap://payment/result?paymentId=p1&status=SUCCEEDED');
    assert.equal(buildClientReturn('https://evtap.az/payment/result?x=1', 'p1', 'FAILED'), 'https://evtap.az/payment/result?x=1&paymentId=p1&status=FAILED');
  });
});

// ───────────────────────────── Integration ─────────────────────────────

describe('integration (Postgres + fake bank)', async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { Pool } = require('pg');
  const { config } = require('../src/config');
  const probe = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2000 });
  let dbOk = true;
  try {
    await probe.query('select 1 from wallets limit 1');
  } catch {
    dbOk = false;
  } finally {
    await probe.end();
  }
  const opts = { skip: dbOk ? false : 'Postgres not reachable / schema not pushed' } as const;

  let app: any;
  let bank: ReturnType<typeof startFakeBank>;
  let apiUrl = '';
  let db: any;
  let schema: any;
  let drizzle: any;
  let wallet: any;
  let payments: any;
  let checkout: any;
  let bookingsSvc: any;

  const suffix = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
  const mkUser = async (name = 'Test') => {
    const [u] = await db.insert(schema.users).values({ name, phone: `+99451${suffix()}` }).returning();
    await db.insert(schema.wallets).values({ userId: u.id }).onConflictDoNothing();
    return u.id as string;
  };
  const getWallet = async (userId: string) => (await db.select().from(schema.wallets).where(drizzle.eq(schema.wallets.userId, userId)))[0];

  before(async () => {
    if (!dbOk) return;
    bank = startFakeBank({ port: 0 });
    await bank.ready;
    config.payments.mockbank.url = bank.url; // the provider reads its config object per request
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../src/app.module');
    app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error'] });
    app.setGlobalPrefix('api/v1');
    app.useBodyParser('json', { limit: '2mb' });
    await app.listen(0);
    apiUrl = `http://localhost:${app.getHttpServer().address().port}`;
    config.apiInternalUrl = apiUrl;
    config.apiPublicUrl = apiUrl;
    const { DB } = require('../src/db/db.module');
    db = app.get(DB);
    schema = require('../src/db/schema');
    drizzle = require('drizzle-orm');
    wallet = app.get(require('../src/modules/wallet/wallet.service').WalletService);
    payments = app.get(require('../src/modules/payments/payments.service').PaymentsService);
    checkout = app.get(require('../src/modules/payments/checkout.service').CheckoutService);
    bookingsSvc = app.get(require('../src/modules/bookings/bookings.service').BookingsService);
  });

  after(async () => {
    await app?.close();
    await bank?.close();
  });

  test('wallet: row-locked credit/debit, bonus spent first, ledger balanceAfter, 402 when short', opts, async () => {
    const u = await mkUser();
    await wallet.credit(u, 1000, 'TOPUP', 'test');
    await wallet.credit(u, 300, 'BONUS', 'bonus');
    const tx = await wallet.debit(u, 400, 'spend');
    assert.equal(tx.amount, -400);
    assert.equal(tx.bonusAmount, -300);
    assert.equal(tx.balanceAfter, 900);
    assert.deepEqual(await wallet.get(u), { balance: 900, bonusBalance: 0, currency: 'AZN' });
    await assert.rejects(wallet.debit(u, 901, 'too much'), (e: any) => e.getStatus() === 402 && e.getResponse().code === 'INSUFFICIENT_FUNDS');
    // 20 concurrent debits of 50 on 900 → exactly 18 succeed, balance never negative
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => wallet.debit(u, 50, 'race')));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 18);
    assert.equal((await getWallet(u)).balance, 0);
  });

  test('card top-up: bank webhook fulfils once; replays and concurrent finalisations are idempotent', opts, async () => {
    const u = await mkUser();
    const res = await checkout.checkout(u, { purpose: 'WALLET_TOPUP', amount: 10000, method: 'CARD', returnUrl: 'evtap://payment/result' });
    assert.equal(res.status, 'PENDING');
    assert.ok(res.paymentUrl.startsWith(bank.url));

    // browser pays → bank POSTs the signed webhook to the API, then redirects to the API return URL
    const r1 = await fetch(`${res.paymentUrl}?card=4111111111111111`, { redirect: 'manual' });
    assert.equal(r1.status, 302);
    const r2 = await fetch(r1.headers.get('location')!, { redirect: 'manual' });
    assert.equal(r2.status, 302);
    assert.equal(r2.headers.get('location'), `evtap://payment/result?paymentId=${res.paymentId}&status=SUCCEEDED`);
    assert.equal(bank.webhooks.find((w) => w.event === 'order.approved')?.status, 200);

    const order = [...bank.orders.values()].find((o) => o.merchantOrderId === res.paymentId)!;
    const parsed = parseMockbankOrder(order as any);
    await Promise.all(Array.from({ length: 5 }, () => payments.applyProviderOrder(parsed)));

    // replay of the very same signed webhook body
    const raw = JSON.stringify({ event: 'order.approved', order });
    const ts = String(Date.now());
    const replay = await fetch(`${apiUrl}/api/v1/payments/webhook/mockbank`, {
      method: 'POST', body: raw,
      headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': 'evtap', 'X-Timestamp': ts, 'X-Signature': signMockbank('evtap-mockbank-secret', ts, raw) },
    });
    assert.equal(replay.status, 200);

    assert.deepEqual(await wallet.get(u), { balance: 10000, bonusBalance: 1000, currency: 'AZN' });
    const txs = await db.select().from(schema.walletTransactions).where(drizzle.eq(schema.walletTransactions.paymentId, res.paymentId));
    assert.equal(txs.length, 2, 'TOPUP + BONUS exactly once');
    const [p] = await db.select().from(schema.payments).where(drizzle.eq(schema.payments.id, res.paymentId));
    assert.equal(p.status, 'SUCCEEDED');
    assert.ok(p.fulfilledAt);
    assert.equal(p.cardMask, '411111******1111');
  });

  test('forged webhook is rejected with 401 and changes nothing', opts, async () => {
    const u = await mkUser();
    const res = await checkout.checkout(u, { purpose: 'WALLET_TOPUP', amount: 500, method: 'CARD' });
    const fake = { event: 'order.approved', order: { orderId: 'ord_x', merchantOrderId: res.paymentId, amount: 500, currency: 'AZN', status: 'APPROVED' } };
    const raw = JSON.stringify(fake);
    const ts = String(Date.now());
    const r = await fetch(`${apiUrl}/api/v1/payments/webhook/mockbank`, {
      method: 'POST', body: raw,
      headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': 'evtap', 'X-Timestamp': ts, 'X-Signature': signMockbank('wrong-secret', ts, raw) },
    });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).code, 'INVALID_SIGNATURE');
    assert.equal((await getWallet(u)).balance, 0);
  });

  test('declined card → FAILED, nothing granted', opts, async () => {
    const u = await mkUser();
    const res = await checkout.checkout(u, { purpose: 'WALLET_TOPUP', amount: 500, method: 'CARD' });
    const r1 = await fetch(`${res.paymentUrl}?card=4000000000000002`, { redirect: 'manual' });
    const r2 = await fetch(r1.headers.get('location')!, { redirect: 'manual' });
    assert.match(r2.headers.get('location')!, /status=FAILED/);
    assert.equal((await getWallet(u)).balance, 0);
  });

  test('bookings: concurrent requests for the same dates → exactly one hold; wallet booking confirms; refund policy applied', opts, async () => {
    const host = await mkUser('Host');
    const [l] = await db.insert(schema.listings).values({
      ownerId: host, dealType: 'RENT_DAILY', propertyType: 'APARTMENT', title: 'Dəniz kənarında mənzil', description: 'Integration test daily rent listing',
      price: 80, cityId: 'baku', area: 50, rooms: 2, contactName: 'Host', contactPhone: '+994501234567', status: 'ACTIVE', maxGuests: 3, minNights: 1,
    }).returning();
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const guests = await Promise.all([1, 2, 3, 4].map(() => mkUser('Guest')));
    for (const g of guests) await wallet.credit(g, 100000, 'TOPUP', 'test');
    const input = { listingId: l.id, checkIn: day(10), checkOut: day(12), guests: 2, method: 'WALLET' as const };
    const results = await Promise.allSettled(guests.map((g) => bookingsSvc.create(g, input)));
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    assert.equal(ok.length, 1, 'exactly one booking wins');
    for (const r of results) if (r.status === 'rejected') assert.equal((r.reason as any).getResponse().code, 'DATES_UNAVAILABLE');
    const { booking } = ok[0].value;
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal(booking.total, 17280); // 2 × 80 ₼ + 8 %

    const winner = booking.guest.id;
    const before = await getWallet(winner);
    const cancelled = await bookingsSvc.cancel({ id: winner, role: 'USER' }, booking.id, 'test'); // 10 days ahead → full refund
    assert.equal(cancelled.refundedAmount, 17280);
    assert.equal((await getWallet(winner)).balance, before.balance + 17280);
    // cancelling twice is refused
    await assert.rejects(bookingsSvc.cancel({ id: winner, role: 'USER' }, booking.id), (e: any) => e.getResponse().code === 'BOOKING_NOT_CANCELLABLE');
  });
});
