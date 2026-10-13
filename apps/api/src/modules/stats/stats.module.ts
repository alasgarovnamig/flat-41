import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { PAYMENT_PURPOSES, type AdminOverview, type PaymentPurpose, type TimeseriesPoint } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { Roles } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';

const daysSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
/** Net revenue of a payment row (succeeded or partially refunded). */
const NET = sql.raw(`case when status in ('SUCCEEDED','PARTIALLY_REFUNDED') then amount - refunded_amount else 0 end`);
/**
 * Recognised revenue: excludes WALLET_TOPUP — top-ups are customer balance (a liability) and become revenue only
 * when spent on services (those WALLET-method payments are counted). Same rule as GET /admin/stats/revenue.
 */
const REV = sql.raw(`case when status in ('SUCCEEDED','PARTIALLY_REFUNDED') and purpose <> 'WALLET_TOPUP' then amount - refunded_amount else 0 end`);
const PAID_AT = sql.raw(`coalesce(paid_at, created_at)`);

type Row = Record<string, unknown>;
const one = async <T extends Row>(db: Database, q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows[0];

/** Admin dashboard KPIs + marketplace time series. (Revenue series: GET /admin/stats/revenue lives in the payments module.) */
@Injectable()
export class StatsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async overview(): Promise<AdminOverview> {
    const db = this.db;
    const u = await one<{ total: number; new_today: number; new_30d: number; business: number }>(db, sql`
      select count(*) filter (where status <> 'DELETED')::int as total,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as new_today,
        count(*) filter (where created_at >= now() - interval '30 days')::int as new_30d,
        count(*) filter (where account_type = 'BUSINESS' and status <> 'DELETED')::int as business
      from users`);
    const l = await one<{ active: number; pending: number; total: number; new_today: number }>(db, sql`
      select count(*) filter (where status = 'ACTIVE')::int as active,
        count(*) filter (where status = 'PENDING')::int as pending,
        count(*)::int as total,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as new_today
      from listings`);
    const r = await one<{ today: number; last30d: number; total: number; succeeded_30d: number; failed_30d: number }>(db, sql`
      select coalesce(sum(${REV}) filter (where ${PAID_AT} >= date_trunc('day', now())), 0)::int as today,
        coalesce(sum(${REV}) filter (where ${PAID_AT} >= now() - interval '30 days'), 0)::int as last30d,
        coalesce(sum(${REV}), 0)::int as total,
        count(*) filter (where status in ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') and created_at >= now() - interval '30 days')::int as succeeded_30d,
        count(*) filter (where status = 'FAILED' and created_at >= now() - interval '30 days')::int as failed_30d
      from payments`);
    const byPurposeRows = await db.execute<{ purpose: string; amount: number }>(sql`
      select purpose, coalesce(sum(${NET}), 0)::int as amount from payments
      where ${PAID_AT} >= now() - interval '30 days' group by purpose`);
    const byPurpose30d = Object.fromEntries(PAYMENT_PURPOSES.map((p) => [p, 0])) as Record<PaymentPurpose, number>;
    for (const row of byPurposeRows.rows) if (row.purpose in byPurpose30d) byPurpose30d[row.purpose as PaymentPurpose] = row.amount;
    const b = await one<{ confirmed: number; upcoming: number; gmv_30d: number }>(db, sql`
      select count(*) filter (where status = 'CONFIRMED')::int as confirmed,
        count(*) filter (where status = 'CONFIRMED' and check_in >= current_date)::int as upcoming,
        coalesce(sum(total) filter (where status in ('CONFIRMED','COMPLETED') and created_at >= now() - interval '30 days'), 0)::int as gmv_30d
      from bookings`);
    const s = await one<{ active: number; mrr: number }>(db, sql`
      select count(*)::int as active,
        coalesce(sum(case when s.period = 'YEAR' then p.price_yearly / 12.0 else p.price_monthly end), 0)::int as mrr
      from subscriptions s join plans p on p.code = s.plan_code
      where s.status in ('ACTIVE','CANCELLED') and s.current_period_end > now()`);
    const rep = await one<{ open: number }>(db, sql`select count(*)::int as open from listing_reports where status = 'OPEN'`);
    return {
      users: { total: u.total, newToday: u.new_today, new30d: u.new_30d, business: u.business },
      listings: { active: l.active, pending: l.pending, total: l.total, newToday: l.new_today },
      revenue: { today: r.today, last30d: r.last30d, total: r.total, byPurpose30d },
      payments: { succeeded30d: r.succeeded_30d, failed30d: r.failed_30d },
      bookings: { confirmed: b.confirmed, upcoming: b.upcoming, gmv30d: b.gmv_30d },
      subscriptions: { active: s.active, mrr: s.mrr },
      reports: { open: rep.open },
    };
  }

  /** Daily listings: value = created, plus published / rejected. Rejections are dated by updatedAt. */
  async listings(days: number): Promise<TimeseriesPoint[]> {
    const res = await this.db.execute<{ date: string; created: number; published: number; rejected: number }>(sql`
      with d as (select generate_series(current_date - (${days}::int - 1), current_date, interval '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as date,
        (select count(*) from listings l where l.created_at >= d.day and l.created_at < d.day + 1)::int as created,
        (select count(*) from listings l where l.published_at >= d.day and l.published_at < d.day + 1)::int as published,
        (select count(*) from listings l where l.status = 'REJECTED' and l.updated_at >= d.day and l.updated_at < d.day + 1)::int as rejected
      from d order by d.day`);
    return res.rows.map((r) => ({ date: r.date, value: r.created, created: r.created, published: r.published, rejected: r.rejected }));
  }

  async users(days: number): Promise<TimeseriesPoint[]> {
    const res = await this.db.execute<{ date: string; value: number }>(sql`
      with d as (select generate_series(current_date - (${days}::int - 1), current_date, interval '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as date,
        (select count(*) from users u where u.created_at >= d.day and u.created_at < d.day + 1)::int as value
      from d order by d.day`);
    return res.rows.map((r) => ({ date: r.date, value: r.value }));
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview() {
    return this.stats.overview();
  }

  @Get('listings')
  listings(@Query(new ZodPipe(daysSchema)) q: z.output<typeof daysSchema>) {
    return this.stats.listings(q.days);
  }

  @Get('users')
  users(@Query(new ZodPipe(daysSchema)) q: z.output<typeof daysSchema>) {
    return this.stats.users(q.days);
  }
}

@Module({ controllers: [StatsController], providers: [StatsService], exports: [StatsService] })
export class StatsModule {}
