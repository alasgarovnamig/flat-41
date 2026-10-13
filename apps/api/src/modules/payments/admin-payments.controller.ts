import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, count, desc, eq, gte, inArray, lt, SQL, sql } from 'drizzle-orm';
import { adminPaymentQuerySchema, PAYMENT_PURPOSES, refundSchema, type TimeseriesPoint } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { ZodPipe } from '../../common/zod.pipe';
import { Database, InjectDb } from '../../db/db.module';
import { payments, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { toPaymentDto } from './payment.mapper';
import { PaymentsService } from './payments.service';

const uuidPipe = new ZodPipe(z.string().uuid());
const daysSchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
/** Day boundaries for stats follow Baku time (inlined literal so SELECT and GROUP BY expressions are identical). */
const TZ = sql.raw(`'Asia/Baku'`);

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminPaymentsController {
  constructor(@InjectDb() private readonly db: Database, private readonly payments: PaymentsService, private readonly audit: AuditService) {}

  @Roles('MODERATOR')
  @Get('payments')
  async list(@Query(new ZodPipe(adminPaymentQuerySchema)) q: z.output<typeof adminPaymentQuerySchema>) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(payments.status, q.status));
    if (q.purpose) conds.push(eq(payments.purpose, q.purpose));
    if (q.userId) conds.push(eq(payments.userId, q.userId));
    if (q.from) conds.push(gte(payments.createdAt, new Date(`${q.from}T00:00:00+04:00`)));
    if (q.to) conds.push(lt(payments.createdAt, new Date(new Date(`${q.to}T00:00:00+04:00`).getTime() + 86_400_000)));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await this.db
      .select({ p: payments, userName: users.name })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.userId))
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(q.pageSize)
      .offset(pageArgs(q.page, q.pageSize).offset);
    const [{ total }] = await this.db.select({ total: count() }).from(payments).where(where);
    return paginated(rows.map((r) => ({ ...toPaymentDto(r.p), userName: r.userName })), total, q.page, q.pageSize);
  }

  @Roles('MODERATOR')
  @Get('payments/:id')
  async get(@Param('id', uuidPipe) id: string) {
    const [r] = await this.db
      .select({ p: payments, user: { id: users.id, name: users.name, phone: users.phone, email: users.email } })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.userId))
      .where(eq(payments.id, id));
    if (!r) throw notFound('Payment');
    return { ...toPaymentDto(r.p), user: r.user, providerData: r.p.providerData, metadata: r.p.metadata, fulfilledAt: r.p.fulfilledAt };
  }

  /** Card → bank refund, wallet → wallet REFUND credit; also reverses the fulfilment where it makes sense. */
  @Roles('ADMIN')
  @Post('payments/:id/refund')
  @HttpCode(200)
  async refund(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodPipe(refundSchema)) body: z.output<typeof refundSchema>,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    const p = await this.payments.refund(id, { amount: body.amount, reason: body.reason ?? 'Admin tərəfindən geri qaytarma', actorId: user.id, reverse: true });
    await this.audit.log(user.id, 'payment.refund', 'payment', id, { amount: body.amount ?? null, reason: body.reason ?? null, refundedAmount: p.refundedAmount }, ip);
    return toPaymentDto(p);
  }

  /**
   * Daily revenue. One key per PaymentPurpose = paid amount net of refunds. `value` = total excluding WALLET_TOPUP
   * (top-ups are prepaid balance; that money is counted when it is spent on a purpose). BOOKING is the full
   * guest payment (GMV incl. host share); `bookingCommission` = platform take (guest fee + host fee) of those bookings.
   */
  @Roles('MODERATOR')
  @Get('stats/revenue')
  async revenue(@Query(new ZodPipe(daysSchema)) q: z.output<typeof daysSchema>): Promise<TimeseriesPoint[]> {
    const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - (q.days - 1) * 86_400_000).toISOString().slice(0, 10);
    const since = new Date(`${start}T00:00:00+04:00`);
    const day = sql<string>`to_char((${payments.paidAt} at time zone ${TZ})::date, 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ day, purpose: payments.purpose, net: sql<number>`coalesce(sum(${payments.amount} - ${payments.refundedAmount}), 0)::int` })
      .from(payments)
      .where(and(inArray(payments.status, ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED']), gte(payments.paidAt, since)))
      .groupBy(day, payments.purpose);
    const commission = await this.db.execute<{ day: string; v: number }>(sql`
      select to_char((p.paid_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, coalesce(sum(b.guest_fee + b.host_fee), 0)::int as v
      from payments p join bookings b on b.id = p.booking_id
      where p.purpose = 'BOOKING' and p.paid_at >= ${since} and b.status in ('CONFIRMED', 'COMPLETED')
      group by 1`);

    const points = new Map<string, TimeseriesPoint>();
    for (let i = 0; i < q.days; i++) {
      const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
      const pt: TimeseriesPoint = { date, value: 0, bookingCommission: 0 };
      for (const purpose of PAYMENT_PURPOSES) pt[purpose] = 0;
      points.set(date, pt);
    }
    for (const r of rows) {
      const pt = points.get(r.day);
      if (!pt) continue;
      pt[r.purpose] = (pt[r.purpose] as number) + r.net;
      if (r.purpose !== 'WALLET_TOPUP') pt.value += r.net;
    }
    for (const r of commission.rows) {
      const pt = points.get(r.day);
      if (pt) pt.bookingCommission = Number(r.v);
    }
    return [...points.values()];
  }
}
