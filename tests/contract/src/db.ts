/**
 * The ONLY place the suite touches the database: fast-forwarding time for flows that otherwise need days to pass
 * (a stay being completed, a subscription period ending). Tests using it run only when DATABASE_URL is set.
 * Table / column names follow the shared Postgres schema (apps/api/src/db/schema.ts); keep this file tiny.
 */
import pg from 'pg';
import { DATABASE_URL } from './config';

let pool: pg.Pool | undefined;
const db = () => (pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 }));

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

/** The stay is over: CONFIRMED → COMPLETED (what the hourly completion job does after check-out). */
export async function markBookingCompleted(bookingId: string) {
  const r = await db().query(`update bookings set status = 'COMPLETED' where id = $1 and status = 'CONFIRMED'`, [bookingId]);
  if (r.rowCount !== 1) throw new Error(`booking ${bookingId} could not be marked COMPLETED`);
}

/** The current subscription period of `userId` ended a minute ago. */
export async function endSubscriptionPeriod(userId: string) {
  const r = await db().query(
    `update subscriptions set current_period_end = now() - interval '1 minute' where user_id = $1 and status in ('ACTIVE', 'CANCELLED', 'PAST_DUE')`,
    [userId],
  );
  if (!r.rowCount) throw new Error(`no subscription of ${userId} to fast-forward`);
}
