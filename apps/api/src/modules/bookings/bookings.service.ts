import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, count, desc, eq, gt, gte, inArray, lt, lte, ne, or, SQL, sql } from 'drizzle-orm';
import {
  calcBooking, formatMoney, nightsBetween, type Booking, type BookingQuote, type Currency, type Paginated, type PlatformSettings, type Review,
} from '@evtap/shared';
import { Database, InjectDb, Tx } from '../../db/db.module';
import { bookings, listingBlockedDates, listings, payments, reviews, users } from '../../db/schema';
import { AppError, forbidden, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';
import { NotificationsService } from '../notifications/notifications.service';
import type { PaymentRow } from '../payments/payment.mapper';
import { Effect, PaymentsService, StartedPayment } from '../payments/payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/providers';
import { listingCovers } from '../promotions/listing-view';
import { SettingsService } from '../settings/settings.service';
import { runEffects } from '../wallet/tx';
import { WalletService } from '../wallet/wallet.service';
import { CancelledBy, cancellationOutcome, checkInMoment, HOLD_MINUTES, localToday, MAX_NIGHTS } from './booking-policy';

type BookingRow = typeof bookings.$inferSelect;
type ListingRow = typeof listings.$inferSelect;
type Db = Database | Tx;

export interface BookingDates { listingId: string; checkIn: string; checkOut: string; guests: number }

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  OWN_LISTING: 'You cannot book your own listing',
  PAST_DATE: 'Check-in date is in the past',
  TOO_LONG: `Bookings are limited to ${MAX_NIGHTS} nights`,
  MIN_NIGHTS: 'Stay is shorter than the minimum number of nights',
  MAX_GUESTS: 'Too many guests for this listing',
  DATES_UNAVAILABLE: 'Selected dates are not available',
};

@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);
  private running = { holds: false, payouts: false };

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
  ) {
    this.payments.registerHandler('BOOKING', {
      fulfil: (p, tx) => this.onPaid(p, tx),
      onFailed: (p, tx) => this.onPaymentFailed(p, tx),
      reverse: (p, amount, tx) => this.onAdminRefund(p, amount, tx),
    });
  }

  // ───────────────────────────── Availability & quote ─────────────────────────────

  /** True when no blocked date and no live booking (CONFIRMED, or PENDING_PAYMENT with a running hold) overlaps. */
  async isAvailable(db: Db, listingId: string, checkIn: string, checkOut: string, excludeBookingId?: string) {
    const [blocked] = await db
      .select({ d: listingBlockedDates.date })
      .from(listingBlockedDates)
      .where(and(eq(listingBlockedDates.listingId, listingId), gte(listingBlockedDates.date, checkIn), lt(listingBlockedDates.date, checkOut)))
      .limit(1);
    if (blocked) return false;
    const conds: SQL[] = [
      eq(bookings.listingId, listingId), lt(bookings.checkIn, checkOut), gt(bookings.checkOut, checkIn),
      or(inArray(bookings.status, ['CONFIRMED', 'COMPLETED']), and(eq(bookings.status, 'PENDING_PAYMENT'), gt(bookings.holdExpiresAt, new Date())))!,
    ];
    if (excludeBookingId) conds.push(ne(bookings.id, excludeBookingId));
    const [clash] = await db.select({ id: bookings.id }).from(bookings).where(and(...conds)).limit(1);
    return !clash;
  }

  private async evaluate(db: Db, l: ListingRow | undefined, input: BookingDates, userId: string | undefined, s: PlatformSettings) {
    if (!l || l.status !== 'ACTIVE') throw new AppError('LISTING_NOT_AVAILABLE', 'Listing is not available', HttpStatus.NOT_FOUND);
    if (l.dealType !== 'RENT_DAILY') throw new AppError('NOT_BOOKABLE', 'Only daily-rent listings can be booked online');
    const nights = nightsBetween(input.checkIn, input.checkOut);
    const calc = calcBooking(l.price, nights, s);
    let reason: string | undefined;
    if (userId && userId === l.ownerId) reason = 'OWN_LISTING';
    else if (input.checkIn < localToday()) reason = 'PAST_DATE';
    else if (nights > MAX_NIGHTS) reason = 'TOO_LONG';
    else if (l.minNights && nights < l.minNights) reason = 'MIN_NIGHTS';
    else if (l.maxGuests && input.guests > l.maxGuests) reason = 'MAX_GUESTS';
    else if (!(await this.isAvailable(db, l.id, input.checkIn, input.checkOut))) reason = 'DATES_UNAVAILABLE';
    const quote: BookingQuote = {
      listingId: l.id, checkIn: input.checkIn, checkOut: input.checkOut, nights, guests: input.guests, nightlyPrice: l.price,
      currency: l.currency as Currency, subtotal: calc.subtotal, guestFee: calc.guestFee, total: calc.total, available: !reason,
      ...(reason ? { unavailableReason: reason } : {}),
    };
    return { quote, calc, reason };
  }

  async quote(input: BookingDates, userId?: string): Promise<BookingQuote> {
    const s = await this.settings.getSettings();
    const [l] = await this.db.select().from(listings).where(eq(listings.id, input.listingId));
    return (await this.evaluate(this.db, l, input, userId, s)).quote;
  }

  // ───────────────────────────── Create & pay ─────────────────────────────

  async create(userId: string, input: BookingDates & { method: 'CARD' | 'WALLET'; returnUrl?: string }) {
    const s = await this.settings.getSettings();
    const [guest] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!guest || guest.status !== 'ACTIVE') throw forbidden('Account is not active');
    const returnUrl = this.payments.resolveReturnUrl(input.returnUrl); // validate before holding dates
    let started: StartedPayment | undefined;
    let title = '';

    // The listing row lock serialises concurrent bookings of the same listing → no double booking.
    const booking = await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(eq(listings.id, input.listingId)).for('update');
      const { calc, reason, quote } = await this.evaluate(tx, l, input, userId, s);
      if (reason) throw new AppError(reason, UNAVAILABLE_MESSAGES[reason] ?? reason, HttpStatus.CONFLICT);
      title = l!.title;
      const [b] = await tx.insert(bookings).values({
        listingId: l!.id, guestId: userId, hostId: l!.ownerId, checkIn: input.checkIn, checkOut: input.checkOut, nights: quote.nights,
        guests: input.guests, nightlyPrice: l!.price, currency: l!.currency, ...calc, status: 'PENDING_PAYMENT', payoutStatus: 'NOT_DUE',
        holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      }).returning();
      if (input.method === 'WALLET') started = await this.payments.startPayment({ ...this.paymentSpec(b, title, userId, returnUrl), method: 'WALLET', tx });
      return b;
    });

    if (input.method === 'WALLET') {
      await started!.afterCommit();
    } else {
      try {
        started = await this.payments.startPayment({
          ...this.paymentSpec(booking, title, userId, returnUrl), method: 'CARD', language: guest.locale as 'az', customer: { phone: guest.phone, email: guest.email },
        });
        await this.db.update(bookings).set({ paymentId: started.payment.id }).where(and(eq(bookings.id, booking.id), eq(bookings.status, 'PENDING_PAYMENT')));
      } catch (e) {
        await this.db.update(bookings).set({ status: 'CANCELLED', payoutStatus: 'CANCELLED', cancelReason: 'Ödəniş başladıla bilmədi', cancelledAt: new Date() }).where(eq(bookings.id, booking.id));
        throw e;
      }
    }
    return { booking: await this.getDto(booking.id, userId), checkout: started!.checkout };
  }

  private paymentSpec(b: BookingRow, title: string, userId: string, returnUrl: string) {
    return {
      userId, purpose: 'BOOKING' as const, amount: b.total, currency: b.currency as Currency, bookingId: b.id, listingId: b.listingId, returnUrl,
      description: `Rezervasiya: "${title}" (${b.checkIn} – ${b.checkOut})`,
      items: [
        { code: 'NIGHTS', name: `${b.nights} gecə × ${b.nightlyPrice} ${b.currency}`, amount: b.subtotal },
        { code: 'SERVICE_FEE', name: 'Xidmət haqqı', amount: b.guestFee },
      ],
    };
  }

  /** BOOKING payment succeeded (runs in the payment transaction). */
  private async onPaid(p: PaymentRow, tx: Tx) {
    if (!p.bookingId) return { refundReason: 'Rezervasiya tapılmadı' };
    const [pre] = await tx.select({ listingId: bookings.listingId }).from(bookings).where(eq(bookings.id, p.bookingId));
    if (!pre) return { refundReason: 'Rezervasiya tapılmadı' };
    await tx.select({ id: listings.id }).from(listings).where(eq(listings.id, pre.listingId)).for('update'); // same lock order as create
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update');
    if (b.paymentId === p.id && ['CONFIRMED', 'COMPLETED'].includes(b.status)) return;
    // A hold cancelled by the system (expired / failed attempt) is revived when the dates are still free.
    const revivable = b.status === 'PENDING_PAYMENT' || (b.status === 'CANCELLED' && !b.cancelledBy && b.refundedAmount === 0);
    if (!revivable || !(await this.isAvailable(tx, b.listingId, b.checkIn, b.checkOut, b.id))) {
      return { refundReason: 'Seçilmiş tarixlər artıq mövcud deyil' };
    }
    const [c] = await tx.update(bookings).set({
      status: 'CONFIRMED', paymentId: p.id, holdExpiresAt: null, payoutStatus: 'PENDING', cancelReason: null, cancelledAt: null,
    }).where(eq(bookings.id, b.id)).returning();
    return { after: () => this.notifyConfirmed(c) };
  }

  private async onPaymentFailed(p: PaymentRow, tx: Tx) {
    if (!p.bookingId) return;
    await tx
      .update(bookings)
      .set({ status: 'CANCELLED', payoutStatus: 'CANCELLED', cancelReason: 'Ödəniş alınmadı', cancelledAt: new Date(), holdExpiresAt: null })
      .where(and(eq(bookings.id, p.bookingId), eq(bookings.status, 'PENDING_PAYMENT')));
  }

  /** Admin refund of a booking payment (POST /admin/payments/:id/refund). Full refund → REFUNDED, payout cancelled if not paid. */
  private async onAdminRefund(p: PaymentRow, amount: number, tx: Tx) {
    if (!p.bookingId) return;
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update');
    if (!b) return;
    const refundedAmount = b.refundedAmount + amount;
    const full = refundedAmount >= b.total;
    await tx.update(bookings).set({
      refundedAmount,
      ...(full ? { status: 'REFUNDED', ...(b.payoutStatus !== 'PAID' ? { payoutStatus: 'CANCELLED', hostPayout: 0 } : {}) } : {}),
    }).where(eq(bookings.id, b.id));
  }

  private async notifyConfirmed(b: BookingRow) {
    const [l] = await this.db.select({ title: listings.title }).from(listings).where(eq(listings.id, b.listingId));
    const data = { bookingId: b.id, listingId: b.listingId };
    await this.notifications.notify(b.hostId, 'BOOKING_NEW', 'Yeni rezervasiya', `"${l?.title}": ${b.checkIn} – ${b.checkOut}, ${b.guests} qonaq. Qazancınız: ${formatMoney(b.hostPayout, b.currency as Currency)}.`, data);
    await this.notifications.notify(b.guestId, 'BOOKING_CONFIRMED', 'Rezervasiya təsdiqləndi', `"${l?.title}": ${b.checkIn} – ${b.checkOut}. Xoş istirahətlər!`, data);
  }

  // ───────────────────────────── Read ─────────────────────────────

  async list(userId: string, role: 'guest' | 'host', status: string | undefined, page: number, pageSize: number): Promise<Paginated<Booking>> {
    const conds: SQL[] = [role === 'host' ? eq(bookings.hostId, userId) : eq(bookings.guestId, userId)];
    if (status) conds.push(eq(bookings.status, status));
    // hosts don't need to see abandoned unpaid holds
    if (role === 'host' && !status) conds.push(ne(bookings.status, 'PENDING_PAYMENT'));
    return this.page(and(...conds)!, page, pageSize, userId);
  }

  async adminList(q: { status?: string; payoutStatus?: string; page: number; pageSize: number }) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(bookings.status, q.status));
    if (q.payoutStatus) conds.push(eq(bookings.payoutStatus, q.payoutStatus));
    return this.page(conds.length ? and(...conds) : undefined, q.page, q.pageSize, null);
  }

  private async page(where: SQL | undefined, page: number, pageSize: number, viewerId: string | null) {
    const rows = await this.db.select().from(bookings).where(where).orderBy(desc(bookings.createdAt)).limit(pageSize).offset(pageArgs(page, pageSize).offset);
    const [{ total }] = await this.db.select({ total: count() }).from(bookings).where(where);
    return paginated(await this.toDtos(rows, viewerId), total, page, pageSize);
  }

  async get(user: { id: string; role: string }, id: string): Promise<Booking> {
    const [b] = await this.db.select().from(bookings).where(eq(bookings.id, id));
    const isStaff = user.role === 'ADMIN' || user.role === 'MODERATOR';
    if (!b || (!isStaff && b.guestId !== user.id && b.hostId !== user.id)) throw notFound('Booking');
    return (await this.toDtos([b], user.id))[0];
  }

  private async getDto(id: string, viewerId: string) {
    const [b] = await this.db.select().from(bookings).where(eq(bookings.id, id));
    return (await this.toDtos([b], viewerId))[0];
  }

  async toDtos(rows: BookingRow[], viewerId: string | null): Promise<Booking[]> {
    if (!rows.length) return [];
    const listingIds = [...new Set(rows.map((r) => r.listingId))];
    const userIds = [...new Set(rows.flatMap((r) => [r.guestId, r.hostId]))];
    const ls = await this.db.select({ id: listings.id, title: listings.title, cityId: listings.cityId, address: listings.address }).from(listings).where(inArray(listings.id, listingIds));
    const us = await this.db.select({ id: users.id, name: users.name, phone: users.phone, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, userIds));
    const covers = await listingCovers(this.db, listingIds);
    const reviewed = new Set((await this.db.select({ b: reviews.bookingId }).from(reviews).where(inArray(reviews.bookingId, rows.map((r) => r.id)))).map((r) => r.b));
    const lMap = new Map(ls.map((l) => [l.id, l]));
    const uMap = new Map(us.map((u) => [u.id, u]));
    return rows.map((b) => {
      const l = lMap.get(b.listingId);
      // Contact phones are only shared once the stay is paid.
      const showPhones = viewerId === null || ['CONFIRMED', 'COMPLETED'].includes(b.status);
      const person = (id: string) => {
        const u = uMap.get(id);
        return { id, name: u?.name ?? '', phone: showPhones ? (u?.phone ?? null) : null, avatarUrl: u?.avatarUrl ?? null };
      };
      return {
        id: b.id,
        listing: { id: b.listingId, title: l?.title ?? '', coverUrl: covers.get(b.listingId)?.coverUrl ?? null, cityId: l?.cityId ?? '', address: l?.address ?? null },
        guest: person(b.guestId), host: person(b.hostId),
        checkIn: b.checkIn, checkOut: b.checkOut, nights: b.nights, guests: b.guests, nightlyPrice: b.nightlyPrice, currency: b.currency as Currency,
        subtotal: b.subtotal, guestFee: b.guestFee, hostFee: b.hostFee, total: b.total, hostPayout: b.hostPayout,
        status: b.status as Booking['status'], payoutStatus: b.payoutStatus as Booking['payoutStatus'], refundedAmount: b.refundedAmount, paymentId: b.paymentId,
        cancelledBy: (b.cancelledBy as Booking['cancelledBy']) ?? null, cancelReason: b.cancelReason,
        canReview: viewerId === b.guestId && b.status === 'COMPLETED' && !reviewed.has(b.id),
        createdAt: iso(b.createdAt)!,
      };
    });
  }

  // ───────────────────────────── Cancel ─────────────────────────────

  /** Guest / host / admin cancellation with refund per policy (see booking-policy.ts). Refund goes to the original method. */
  async cancel(actor: { id: string; role: string }, id: string, reason: string | undefined, asAdmin = false): Promise<Booking> {
    const [pre] = await this.db.select().from(bookings).where(eq(bookings.id, id));
    if (!pre) throw notFound('Booking');
    let by: CancelledBy;
    if (asAdmin) by = 'ADMIN';
    else if (pre.guestId === actor.id) by = 'GUEST';
    else if (pre.hostId === actor.id) by = 'HOST';
    else throw notFound('Booking');

    const s = await this.settings.getSettings();
    const [l] = await this.db.select({ title: listings.title, checkInTime: listings.checkInTime }).from(listings).where(eq(listings.id, pre.listingId));
    const effects: Effect[] = [];
    let pendingOrderToCancel: string | null = null;

    await this.db.transaction(async (tx) => {
      // lock order: payment → booking (same as the payment finalisation path)
      if (pre.paymentId) await tx.select({ id: payments.id }).from(payments).where(eq(payments.id, pre.paymentId)).for('update');
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
      const now = new Date();
      const base = { status: 'CANCELLED', cancelledBy: by, cancelReason: reason ?? null, cancelledAt: now, holdExpiresAt: null };

      if (b.status === 'PENDING_PAYMENT') {
        await tx.update(bookings).set({ ...base, payoutStatus: 'CANCELLED' }).where(eq(bookings.id, b.id));
        if (b.paymentId) {
          const [p] = await tx.select().from(payments).where(eq(payments.id, b.paymentId));
          if (p?.status === 'PENDING' && p.providerOrderId) pendingOrderToCancel = p.providerOrderId;
        }
        return;
      }
      if (b.status !== 'CONFIRMED') throw new AppError('BOOKING_NOT_CANCELLABLE', `Booking in status ${b.status} cannot be cancelled`, HttpStatus.CONFLICT);

      const hoursBefore = (checkInMoment(b.checkIn, l?.checkInTime).getTime() - now.getTime()) / 3_600_000;
      if (by !== 'ADMIN' && hoursBefore <= 0) throw new AppError('BOOKING_ALREADY_STARTED', 'The stay has already started; contact support', HttpStatus.CONFLICT);
      const outcome = cancellationOutcome(b, by, hoursBefore, s.freeCancellationHours);

      let payoutStatus = outcome.hostPayout > 0 ? 'PENDING' : 'CANCELLED';
      if (b.payoutStatus === 'PAID') {
        // Only possible for admin cancellations during the stay: claw back what the host received beyond the new payout.
        const clawback = b.hostPayout - outcome.hostPayout;
        if (clawback > 0) {
          await this.wallet.debit(b.hostId, clawback, `Rezervasiya ləğvi: ödənişin geri alınması (${b.checkIn} – ${b.checkOut})`, { type: 'ADJUSTMENT', source: 'REAL_ONLY', bookingId: b.id, actorId: actor.id, tx });
        }
        payoutStatus = 'PAID';
      }
      if (outcome.refund > 0 && b.paymentId) {
        await this.payments.refund(b.paymentId, { amount: outcome.refund, reason: `Rezervasiya ləğvi (${by})`, actorId: asAdmin ? actor.id : null, tx, effects });
      }
      await tx.update(bookings).set({ ...base, payoutStatus, hostPayout: outcome.hostPayout, refundedAmount: b.refundedAmount + outcome.refund }).where(eq(bookings.id, b.id));

      const data = { bookingId: b.id, listingId: b.listingId };
      const refundText = outcome.refund > 0 ? ` Geri qaytarılan məbləğ: ${formatMoney(outcome.refund, b.currency as Currency)}.` : '';
      const notifyGuest = by !== 'GUEST'
        ? `"${l?.title}" (${b.checkIn} – ${b.checkOut}) rezervasiyası ${by === 'HOST' ? 'ev sahibi' : 'administrator'} tərəfindən ləğv edildi.${refundText}`
        : `"${l?.title}" (${b.checkIn} – ${b.checkOut}) rezervasiyanız ləğv edildi.${refundText}`;
      effects.push(() => this.notifications.notify(b.guestId, 'BOOKING_CANCELLED', 'Rezervasiya ləğv edildi', notifyGuest, data));
      if (by !== 'HOST') {
        effects.push(() => this.notifications.notify(b.hostId, 'BOOKING_CANCELLED', 'Rezervasiya ləğv edildi', `"${l?.title}" (${b.checkIn} – ${b.checkOut}) rezervasiyası ${by === 'GUEST' ? 'qonaq' : 'administrator'} tərəfindən ləğv edildi.`, data));
      }
    });

    if (pendingOrderToCancel) effects.push(() => this.cancelBankOrder(pendingOrderToCancel!));
    await runEffects(effects, (e) => this.log.error(e));
    return this.get(actor, id);
  }

  private async cancelBankOrder(orderId: string) {
    try {
      await this.payments.applyProviderOrder(await this.provider.cancel(orderId));
    } catch (e) {
      this.log.warn(`Could not cancel bank order ${orderId}: ${(e as Error).message}`);
    }
  }

  // ───────────────────────────── Reviews ─────────────────────────────

  async review(userId: string, bookingId: string, input: { rating: number; comment: string }): Promise<Review> {
    const row = await this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
      if (!b || b.guestId !== userId) throw notFound('Booking');
      if (b.status !== 'COMPLETED') throw new AppError('BOOKING_NOT_COMPLETED', 'Only completed stays can be reviewed', HttpStatus.CONFLICT);
      const [exists] = await tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.bookingId, b.id));
      if (exists) throw new AppError('ALREADY_REVIEWED', 'This booking has already been reviewed', HttpStatus.CONFLICT);
      const [r] = await tx.insert(reviews).values({ bookingId: b.id, listingId: b.listingId, authorId: userId, rating: input.rating, comment: input.comment }).returning();
      await tx.update(listings).set({
        // fully qualified columns: drizzle renders bare column names inside raw sql of single-table statements
        ratingAvg: sql`(select round(avg("reviews"."rating")::numeric, 2)::real from "reviews" where "reviews"."listing_id" = ${b.listingId})`,
        reviewsCount: sql`(select count(*)::int from "reviews" where "reviews"."listing_id" = ${b.listingId})`,
      }).where(eq(listings.id, b.listingId));
      return r;
    });
    return this.toReview(row);
  }

  async reply(userId: string, reviewId: string, reply: string): Promise<Review> {
    const [r] = await this.db.select({ r: reviews, hostId: bookings.hostId }).from(reviews).innerJoin(bookings, eq(bookings.id, reviews.bookingId)).where(eq(reviews.id, reviewId));
    if (!r) throw notFound('Review');
    if (r.hostId !== userId) throw forbidden('Only the host can reply');
    const [u] = await this.db.update(reviews).set({ hostReply: reply }).where(eq(reviews.id, reviewId)).returning();
    return this.toReview(u);
  }

  private async toReview(r: typeof reviews.$inferSelect): Promise<Review> {
    const [a] = await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, r.authorId));
    return {
      id: r.id, listingId: r.listingId, bookingId: r.bookingId, author: a ?? { id: r.authorId, name: '', avatarUrl: null },
      rating: r.rating, comment: r.comment, createdAt: iso(r.createdAt)!, hostReply: r.hostReply,
    };
  }

  // ───────────────────────────── Crons ─────────────────────────────

  /** Every 5 min: unpaid holds past holdExpiresAt → CANCELLED (and the bank order is cancelled when still open). */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'bookings-holds' })
  async releaseExpiredHolds(now = new Date()) {
    if (this.running.holds) return 0;
    this.running.holds = true;
    try {
      const expired = await this.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.status, 'PENDING_PAYMENT'), lt(bookings.holdExpiresAt, now)))
        .limit(500);
      let n = 0;
      for (const { id } of expired) {
        const orderId = await this.db.transaction(async (tx) => {
          const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update', { skipLocked: true });
          if (!b || b.status !== 'PENDING_PAYMENT' || !b.holdExpiresAt || b.holdExpiresAt >= now) return undefined;
          await tx.update(bookings).set({ status: 'CANCELLED', payoutStatus: 'CANCELLED', cancelReason: 'Ödəniş vaxtı bitdi', cancelledAt: now }).where(eq(bookings.id, id));
          n++;
          if (!b.paymentId) return null;
          const [p] = await tx.select({ status: payments.status, orderId: payments.providerOrderId }).from(payments).where(eq(payments.id, b.paymentId));
          return p?.status === 'PENDING' ? p.orderId : null;
        });
        if (orderId) await this.cancelBankOrder(orderId);
      }
      return n;
    } finally {
      this.running.holds = false;
    }
  }

  /**
   * Hourly: CONFIRMED stays whose check-out date has come → COMPLETED; host payouts (wallet PAYOUT of hostPayout)
   * once check-in + payoutDelayHours has passed (PENDING → PAID).
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'bookings-complete-payout' })
  async completeAndPayout(now = new Date()) {
    if (this.running.payouts) return { completed: 0, paidOut: 0 };
    this.running.payouts = true;
    try {
      const completed = await this.db
        .update(bookings)
        .set({ status: 'COMPLETED' })
        .where(and(eq(bookings.status, 'CONFIRMED'), lte(bookings.checkOut, localToday(now))))
        .returning({ id: bookings.id });

      const s = await this.settings.getSettings();
      const tomorrow = localToday(new Date(now.getTime() + 86_400_000));
      const due = await this.db
        .select({ b: bookings, checkInTime: listings.checkInTime, title: listings.title })
        .from(bookings)
        .innerJoin(listings, eq(listings.id, bookings.listingId))
        .where(and(eq(bookings.payoutStatus, 'PENDING'), inArray(bookings.status, ['CONFIRMED', 'COMPLETED', 'CANCELLED']), lte(bookings.checkIn, tomorrow)))
        .limit(500);
      let paidOut = 0;
      for (const { b: pre, checkInTime, title } of due) {
        if (checkInMoment(pre.checkIn, checkInTime).getTime() + s.payoutDelayHours * 3_600_000 > now.getTime()) continue;
        const paid = await this.db.transaction(async (tx) => {
          const [b] = await tx.select().from(bookings).where(eq(bookings.id, pre.id)).for('update', { skipLocked: true });
          if (!b || b.payoutStatus !== 'PENDING') return null;
          // TODO: currency conversion — wallets are AZN; GEL bookings are credited 1:1 until FX rates exist.
          if (b.hostPayout > 0) {
            await this.wallet.credit(b.hostId, b.hostPayout, 'PAYOUT', `Rezervasiya qazancı: "${title}" (${b.checkIn} – ${b.checkOut})`, { bookingId: b.id, tx });
          }
          const [u] = await tx.update(bookings).set({ payoutStatus: b.hostPayout > 0 ? 'PAID' : 'CANCELLED', paidOutAt: new Date() }).where(eq(bookings.id, b.id)).returning();
          return u;
        });
        if (paid && paid.hostPayout > 0) {
          paidOut++;
          await runEffects([() => this.notifications.notify(paid.hostId, 'PAYOUT', 'Qazancınız balansa köçürüldü',
            `"${title}" (${paid.checkIn} – ${paid.checkOut}) rezervasiyası üzrə ${formatMoney(paid.hostPayout, paid.currency as Currency)} balansınıza əlavə olundu.`, { bookingId: paid.id })], (e) => this.log.error(e));
        }
      }
      return { completed: completed.length, paidOut };
    } finally {
      this.running.payouts = false;
    }
  }
}
