/**
 * Daily-rent bookings (Airbnb model): quote math (calcBooking), wallet / card payment, overlap rejection,
 * cancellation refund policy, reviews & host replies, resume payment, admin cancellation.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { calcBooking, nightsBetween } from '@evtap/shared';
import { CARDS, payByCard } from '../src/bank';
import { bankOpts, CLIENT_RETURN_URL, dbOpts, v2 } from '../src/config';
import { closeDb, markBookingCompleted } from '../src/db';
import * as D from '../src/dto';
import { err, ok } from '../src/expect';
import { activeListing, admin, catalog, fund, localDay, moderator, newUser, randomUuid, wallet } from '../src/fixtures';
import { anon } from '../src/http';

const bank = await bankOpts();
after(closeDb);

async function dailySetup(price = 80, over: Record<string, unknown> = {}) {
  const host = await newUser('Host Contract');
  const { listing } = await activeListing(host, { price, ...over }, 'daily');
  return { host, listing };
}

async function fundedGuest(amount = 500_000, name = 'Guest Contract') {
  const g = await newUser(name);
  await fund(g, amount);
  return g;
}

describe('bookings: quote', () => {
  test('POST /bookings/quote → BookingQuote using calcBooking with the current fee settings', async () => {
    const { listing } = await dailySetup(85);
    const { settings } = await catalog();
    const checkIn = localDay(10);
    const checkOut = localDay(13);
    const q = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn, checkOut, guests: 2 }), D.BookingQuote);
    const calc = calcBooking(85, 3, settings);
    assert.deepEqual(
      { listingId: q.listingId, checkIn: q.checkIn, checkOut: q.checkOut, nights: q.nights, guests: q.guests, nightlyPrice: q.nightlyPrice, currency: q.currency },
      { listingId: listing.id, checkIn, checkOut, nights: 3, guests: 2, nightlyPrice: 85, currency: 'AZN' },
    );
    assert.equal(q.subtotal, calc.subtotal);
    assert.equal(q.guestFee, calc.guestFee);
    assert.equal(q.total, calc.total);
    assert.equal(q.total, q.subtotal + q.guestFee);
    assert.equal(q.available, true);
    assert.equal(q.unavailableReason, undefined);
  });

  test('quote reports unavailability (too many guests, own listing) instead of failing', async () => {
    const { host, listing } = await dailySetup();
    const tooMany = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(10), checkOut: localDay(12), guests: 9 }), D.BookingQuote);
    assert.equal(tooMany.available, false);
    assert.ok(tooMany.unavailableReason);
    const own = ok(await host.post('/bookings/quote', { listingId: listing.id, checkIn: localDay(10), checkOut: localDay(12), guests: 1 }), D.BookingQuote);
    assert.equal(own.available, false);
  });

  test('quote errors: not a daily listing → NOT_BOOKABLE, unknown listing → 404, bad dates → 400', async () => {
    const owner = await newUser();
    const { listing: sale } = await activeListing(owner);
    err(await anon().post('/bookings/quote', { listingId: sale.id, checkIn: localDay(5), checkOut: localDay(6), guests: 1 }), 400, 'NOT_BOOKABLE');
    err(await anon().post('/bookings/quote', { listingId: randomUuid(), checkIn: localDay(5), checkOut: localDay(6), guests: 1 }), 404, 'LISTING_NOT_AVAILABLE');
    const { listing } = await dailySetup();
    err(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(6), checkOut: localDay(6), guests: 1 }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: '06.10.2026', checkOut: localDay(6), guests: 1 }), 400, 'VALIDATION_ERROR');
  });
});

describe('bookings: wallet payment, overlap, visibility', () => {
  test('book by WALLET → CONFIRMED + SUCCEEDED payment; dates taken; overlap rejected; back-to-back allowed', async () => {
    const { host, listing } = await dailySetup(80);
    const { settings } = await catalog();
    const guest = await fundedGuest(100_000);
    const checkIn = localDay(12);
    const checkOut = localDay(14);
    const res = ok(await guest.post('/bookings', { listingId: listing.id, checkIn, checkOut, guests: 2, method: 'WALLET' }));
    const booking = D.Booking.parse(res.booking);
    const checkout = D.CheckoutResponse.parse(res.checkout);
    const calc = calcBooking(80, 2, settings);
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal(booking.nights, 2);
    assert.equal(booking.subtotal, calc.subtotal);
    assert.equal(booking.guestFee, calc.guestFee);
    assert.equal(booking.hostFee, calc.hostFee);
    assert.equal(booking.total, calc.total);
    assert.equal(booking.hostPayout, calc.hostPayout);
    assert.equal(booking.refundedAmount, 0);
    assert.equal(booking.cancelledBy, null);
    assert.equal(booking.canReview, false);
    assert.equal(booking.guest.id, guest.id);
    assert.equal(booking.host.id, host.id);
    assert.equal(booking.listing.id, listing.id);
    assert.ok(['NOT_DUE', 'PENDING'].includes(booking.payoutStatus));
    assert.equal(checkout.status, 'SUCCEEDED');
    assert.equal(checkout.amount, calc.total);
    assert.equal(checkout.paymentUrl, null);
    assert.equal(booking.paymentId, checkout.paymentId);
    assert.equal((await wallet(guest)).balance, 100_000 - calc.total);
    const payment = ok(await guest.get(`/payments/${checkout.paymentId}`), D.Payment);
    assert.equal(payment.purpose, 'BOOKING');
    assert.equal(payment.method, 'WALLET');
    assert.equal(payment.bookingId, booking.id);
    assert.equal(payment.status, 'SUCCEEDED');

    // visibility
    assert.equal(ok(await guest.get(`/bookings/${booking.id}`), D.Booking).id, booking.id);
    assert.equal(ok(await host.get(`/bookings/${booking.id}`), D.Booking).id, booking.id);
    err(await (await newUser()).get(`/bookings/${booking.id}`), 404, 'NOT_FOUND');
    const asGuest = ok(await guest.get('/bookings', { query: { role: 'guest' } }), D.Paginated(D.Booking));
    assert.deepEqual(asGuest.items.map((b) => b.id), [booking.id]);
    const asHost = ok(await host.get('/bookings', { query: { role: 'host' } }), D.Paginated(D.Booking));
    assert.deepEqual(asHost.items.map((b) => b.id), [booking.id]);
    const confirmed = ok(await host.get('/bookings', { query: { role: 'host', status: 'CONFIRMED' } }), D.Paginated(D.Booking));
    assert.equal(confirmed.total, 1);
    assert.equal(ok(await host.get('/bookings', { query: { role: 'guest' } }), D.Paginated(D.Booking)).total, 0);

    // calendar
    const av = ok(await anon().get(`/listings/${listing.id}/availability`), D.Availability);
    assert.deepEqual(av.bookedRanges, [{ checkIn, checkOut }]);
    const quote = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(13), checkOut: localDay(15), guests: 1 }), D.BookingQuote);
    assert.equal(quote.available, false);

    // back-to-back stay (check-in on the previous check-out day) is allowed
    const next = await fundedGuest(100_000, 'Next Guest');
    const b2 = ok(await next.post('/bookings', { listingId: listing.id, checkIn: checkOut, checkOut: localDay(15), guests: 1, method: 'WALLET' }));
    assert.equal(b2.booking.status, 'CONFIRMED');
  });

  test('overlapping stay → 409 (nothing charged); the host cannot book the own listing → 409', async () => {
    const { host, listing } = await dailySetup(80);
    const first = await fundedGuest(100_000);
    ok(await first.post('/bookings', { listingId: listing.id, checkIn: localDay(12), checkOut: localDay(14), guests: 1, method: 'WALLET' }));
    const rival = await fundedGuest(100_000, 'Rival');
    for (const [checkIn, checkOut] of [[localDay(13), localDay(16)], [localDay(11), localDay(13)], [localDay(10), localDay(16)]]) {
      err(await rival.post('/bookings', { listingId: listing.id, checkIn, checkOut, guests: 1, method: 'WALLET' }), 409);
    }
    assert.equal((await wallet(rival)).balance, 100_000, 'rejected bookings charge nothing');
    await fund(host, 50_000);
    err(await host.post('/bookings', { listingId: listing.id, checkIn: localDay(30), checkOut: localDay(31), guests: 1, method: 'WALLET' }), 409);
  });

  test('wallet too small → 402 INSUFFICIENT_FUNDS and the dates stay free', async () => {
    const { listing } = await dailySetup(80);
    const poor = await newUser();
    err(await poor.post('/bookings', { listingId: listing.id, checkIn: localDay(8), checkOut: localDay(10), guests: 1, method: 'WALLET' }), 402, 'INSUFFICIENT_FUNDS');
    const q = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(8), checkOut: localDay(10), guests: 1 }), D.BookingQuote);
    assert.equal(q.available, true);
    assert.equal(ok(await poor.get('/bookings'), D.Paginated(D.Booking)).items.filter((b) => b.status !== 'CANCELLED').length, 0);
  });

  test('validation & auth: guests > 50, unknown method, returnUrl not allowed, anonymous', async () => {
    const { listing } = await dailySetup();
    const g = await fundedGuest();
    const body = { listingId: listing.id, checkIn: localDay(9), checkOut: localDay(10), guests: 1, method: 'WALLET' };
    err(await g.post('/bookings', { ...body, guests: 51 }), 400, 'VALIDATION_ERROR');
    err(await g.post('/bookings', { ...body, method: 'CASH' }), 400, 'VALIDATION_ERROR');
    err(await g.post('/bookings', { ...body, returnUrl: 'https://evil.example.com/pay' }), 400, 'RETURN_URL_NOT_ALLOWED');
    err(await anon().post('/bookings', body), 401, 'UNAUTHORIZED');
    err(await anon().get('/bookings'), 401, 'UNAUTHORIZED');
  });
});

describe('bookings: cancellation policy', () => {
  test('guest cancels ≥ freeCancellationHours before check-in → 100 % refund to the wallet; dates free again', async () => {
    const { listing } = await dailySetup(90);
    const guest = await fundedGuest(100_000);
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(15), checkOut: localDay(18), guests: 2, method: 'WALLET' }));
    const b = D.Booking.parse(r.booking);
    const cancelled = ok(await guest.post(`/bookings/${b.id}/cancel`, { reason: 'Planlar dəyişdi' }), D.Booking);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.cancelledBy, 'GUEST');
    assert.equal(cancelled.cancelReason, 'Planlar dəyişdi');
    assert.equal(cancelled.refundedAmount, b.total);
    assert.equal((await wallet(guest)).balance, 100_000);
    const pay = ok(await guest.get(`/payments/${b.paymentId}`), D.Payment);
    assert.equal(pay.status, 'REFUNDED');
    assert.equal(pay.refundedAmount, b.total);
    const q = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(15), checkOut: localDay(18), guests: 2 }), D.BookingQuote);
    assert.equal(q.available, true, 'cancelled booking releases the dates');
    err(await guest.post(`/bookings/${b.id}/cancel`, {}), 409, 'BOOKING_NOT_CANCELLABLE');
    err(await (await newUser()).post(`/bookings/${b.id}/cancel`, {}), 404, 'NOT_FOUND');
  });

  test('guest cancels late (< freeCancellationHours) → 50 % of the subtotal refunded', async () => {
    const { listing } = await dailySetup(100, { checkInTime: '14:00' });
    const { settings } = await catalog();
    const guest = await fundedGuest(100_000);
    const checkIn = localDay(1);
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn, checkOut: localDay(3), guests: 1, method: 'WALLET' }));
    const b = D.Booking.parse(r.booking);
    const hoursBefore = (Date.parse(`${checkIn}T14:00:00+04:00`) - Date.now()) / 3_600_000;
    const expected = hoursBefore >= settings.freeCancellationHours ? b.total : Math.floor(b.subtotal / 2);
    const balanceBefore = (await wallet(guest)).balance;
    const c = ok(await guest.post(`/bookings/${b.id}/cancel`, {}), D.Booking);
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.refundedAmount, expected);
    assert.equal((await wallet(guest)).balance, balanceBefore + expected);
    assert.equal(ok(await guest.get(`/payments/${b.paymentId}`), D.Payment).refundedAmount, expected);
  });

  test('host cancels → guest gets 100 % back', async () => {
    const { host, listing } = await dailySetup(70);
    const guest = await fundedGuest(100_000);
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(2), checkOut: localDay(4), guests: 1, method: 'WALLET' }));
    const c = ok(await host.post(`/bookings/${r.booking.id}/cancel`, { reason: 'Təmir' }), D.Booking);
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.cancelledBy, 'HOST');
    assert.equal(c.refundedAmount, r.booking.total);
    assert.equal((await wallet(guest)).balance, 100_000);
  });
});

describe('bookings: reviews', () => {
  test('review only after the stay → 409 BOOKING_NOT_COMPLETED; unknown review reply → 404', async () => {
    const { listing } = await dailySetup();
    const guest = await fundedGuest();
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(5), checkOut: localDay(6), guests: 1, method: 'WALLET' }));
    err(await guest.post(`/bookings/${r.booking.id}/review`, { rating: 5, comment: 'Əla yer idi!' }), 409, 'BOOKING_NOT_COMPLETED');
    err(await guest.post(`/reviews/${randomUuid()}/reply`, { reply: 'Təşəkkürlər' }), 404, 'NOT_FOUND');
  });

  test('completed stay: guest reviews once, host replies; listing & host rating updated', dbOpts, async () => {
    const { host, listing } = await dailySetup();
    const guest = await fundedGuest(100_000, 'Reviewer');
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(3), checkOut: localDay(5), guests: 1, method: 'WALLET' }));
    await markBookingCompleted(r.booking.id);
    const b = ok(await guest.get(`/bookings/${r.booking.id}`), D.Booking);
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.canReview, true);
    assert.equal(ok(await host.get(`/bookings/${r.booking.id}`), D.Booking).canReview, false, 'only the guest reviews');

    err(await guest.post(`/bookings/${b.id}/review`, { rating: 6, comment: 'Too good' }), 400, 'VALIDATION_ERROR');
    err(await host.post(`/bookings/${b.id}/review`, { rating: 5, comment: 'Self review' }), 404, 'NOT_FOUND');
    const review = ok(await guest.post(`/bookings/${b.id}/review`, { rating: 4, comment: 'Təmiz və rahat mənzil.' }), D.Review);
    assert.equal(review.rating, 4);
    assert.equal(review.listingId, listing.id);
    assert.equal(review.bookingId, b.id);
    assert.equal(review.author.id, guest.id);
    assert.equal(review.author.name, 'Reviewer');
    assert.equal(review.hostReply, null);
    err(await guest.post(`/bookings/${b.id}/review`, { rating: 5, comment: 'İkinci rəy' }), 409, 'ALREADY_REVIEWED');
    assert.equal(ok(await guest.get(`/bookings/${b.id}`), D.Booking).canReview, false);

    err(await guest.post(`/reviews/${review.id}/reply`, { reply: 'Not my listing' }), 403, 'FORBIDDEN');
    const replied = ok(await host.post(`/reviews/${review.id}/reply`, { reply: 'Təşəkkür edirik!' }), D.Review);
    assert.equal(replied.hostReply, 'Təşəkkür edirik!');

    const list = ok(await anon().get(`/listings/${listing.id}/reviews`), D.Paginated(D.Review));
    assert.equal(list.total, 1);
    assert.equal(list.items[0].id, review.id);
    assert.equal(list.items[0].hostReply, 'Təşəkkür edirik!');
    const d = ok(await anon().get(`/listings/${listing.id}`), D.ListingDetail);
    assert.equal(d.rating, 4);
    assert.equal(d.reviewsCount, 1);
    const pub = ok(await anon().get(`/users/${host.id}`), D.PublicUser);
    assert.equal(pub.rating, 4);
    assert.equal(pub.reviewsCount, 1);
  });
});

describe('bookings: card payment through the bank', () => {
  test('CARD booking → PENDING_PAYMENT holding the dates → hosted checkout → CONFIRMED', bank, async () => {
    const { listing } = await dailySetup(75);
    const guest = await newUser();
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(20), checkOut: localDay(22), guests: 2, method: 'CARD', returnUrl: CLIENT_RETURN_URL }));
    const b = D.Booking.parse(r.booking);
    const co = D.CheckoutResponse.parse(r.checkout);
    assert.equal(b.status, 'PENDING_PAYMENT');
    assert.equal(co.status, 'PENDING');
    assert.ok(co.paymentUrl);
    assert.equal(co.amount, b.total);
    const held = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(21), checkOut: localDay(23), guests: 1 }), D.BookingQuote);
    assert.equal(held.available, false, 'dates are held while the payment is pending');

    const result = await payByCard(co.paymentUrl!, { card: CARDS.frictionless });
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.paymentId, co.paymentId);
    assert.ok(result.clientUrl.startsWith(CLIENT_RETURN_URL));
    const after = ok(await guest.get(`/bookings/${b.id}`), D.Booking);
    assert.equal(after.status, 'CONFIRMED');
    assert.equal(after.paymentId, co.paymentId);
    const p = ok(await guest.get(`/payments/${co.paymentId}`), D.Payment);
    assert.equal(p.status, 'SUCCEEDED');
    assert.equal(p.method, 'CARD');
    assert.equal(p.cardMask, '411111******1111');
  });

  test('declined card → booking released (CANCELLED) and payment FAILED', bank, async () => {
    const { listing } = await dailySetup(75);
    const guest = await newUser();
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(24), checkOut: localDay(25), guests: 1, method: 'CARD', returnUrl: CLIENT_RETURN_URL }));
    const result = await payByCard(r.checkout.paymentUrl, { card: CARDS.declined });
    assert.equal(result.status, 'FAILED');
    assert.equal(ok(await guest.get(`/bookings/${r.booking.id}`), D.Booking).status, 'CANCELLED');
    const q = ok(await anon().post('/bookings/quote', { listingId: listing.id, checkIn: localDay(24), checkOut: localDay(25), guests: 1 }), D.BookingQuote);
    assert.equal(q.available, true);
  });

  test('guest cancels an unpaid booking → CANCELLED without refund', bank, async () => {
    const { listing } = await dailySetup(75);
    const guest = await newUser();
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(26), checkOut: localDay(27), guests: 1, method: 'CARD', returnUrl: CLIENT_RETURN_URL }));
    const c = ok(await guest.post(`/bookings/${r.booking.id}/cancel`, {}), D.Booking);
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.refundedAmount, 0);
  });

  test('[v2] POST /bookings/:id/pay resumes payment of a PENDING_PAYMENT booking (WALLET)', { ...v2, ...bank }, async () => {
    const { listing } = await dailySetup(75);
    const guest = await newUser();
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(28), checkOut: localDay(30), guests: 1, method: 'CARD', returnUrl: CLIENT_RETURN_URL }));
    const b = D.Booking.parse(r.booking);
    err(await (await newUser()).post(`/bookings/${b.id}/pay`, { method: 'WALLET' }), 404, 'NOT_FOUND');
    err(await guest.post(`/bookings/${b.id}/pay`, { method: 'WALLET' }), 402, 'INSUFFICIENT_FUNDS');
    await fund(guest, b.total);
    const co = ok(await guest.post(`/bookings/${b.id}/pay`, { method: 'WALLET' }), D.CheckoutResponse);
    assert.equal(co.status, 'SUCCEEDED');
    assert.equal(co.amount, b.total);
    assert.equal(co.paymentUrl, null);
    const after = ok(await guest.get(`/bookings/${b.id}`), D.Booking);
    assert.equal(after.status, 'CONFIRMED');
    assert.equal(after.paymentId, co.paymentId);
    assert.equal((await wallet(guest)).balance, 0);
    err(await guest.post(`/bookings/${b.id}/pay`, { method: 'WALLET' }), 409);
  });

  test('[v2] POST /bookings/:id/pay with CARD returns a new hosted checkout', { ...v2, ...bank }, async () => {
    const { listing } = await dailySetup(75);
    const guest = await newUser();
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(31), checkOut: localDay(32), guests: 1, method: 'CARD', returnUrl: CLIENT_RETURN_URL }));
    const co = ok(await guest.post(`/bookings/${r.booking.id}/pay`, { method: 'CARD', returnUrl: CLIENT_RETURN_URL }), D.CheckoutResponse);
    assert.equal(co.status, 'PENDING');
    assert.ok(co.paymentUrl);
    const result = await payByCard(co.paymentUrl!, { card: CARDS.threeDs });
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(ok(await guest.get(`/bookings/${r.booking.id}`), D.Booking).status, 'CONFIRMED');
  });
});

describe('bookings: admin', () => {
  test('GET /admin/bookings (filters) and POST /admin/bookings/:id/cancel → full refund (ADMIN only)', async () => {
    const { listing } = await dailySetup(60);
    const guest = await fundedGuest(100_000);
    const r = ok(await guest.post('/bookings', { listingId: listing.id, checkIn: localDay(1), checkOut: localDay(2), guests: 1, method: 'WALLET' }));
    const a = await admin();
    const list = ok(await a.get('/admin/bookings', { query: { status: 'CONFIRMED', pageSize: 100 } }), D.Paginated(D.Booking));
    assert.ok(list.items.every((b) => b.status === 'CONFIRMED'));
    const mod = await moderator();
    ok(await mod.get('/admin/bookings', { query: { pageSize: 5 } }), D.Paginated(D.Booking));
    err(await mod.post(`/admin/bookings/${r.booking.id}/cancel`, { reason: 'Moderator try' }), 403, 'FORBIDDEN');
    err(await a.post(`/admin/bookings/${r.booking.id}/cancel`, {}), 400, 'VALIDATION_ERROR');
    const c = ok(await a.post(`/admin/bookings/${r.booking.id}/cancel`, { reason: 'Saxta elan' }), D.Booking);
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.cancelledBy, 'ADMIN');
    assert.equal(c.refundedAmount, r.booking.total, 'admin cancellation refunds in full');
    assert.equal((await wallet(guest)).balance, 100_000);
    assert.equal(nightsBetween(c.checkIn, c.checkOut), c.nights);
  });
});
