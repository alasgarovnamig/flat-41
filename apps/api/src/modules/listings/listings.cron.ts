import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { Database, InjectDb } from '../../db/db.module';
import { listings, notifications } from '../../db/schema';
import { addDays, iso } from '../../common/util';
import { NotificationsService } from '../notifications/notifications.service';

const EXPIRING_NOTICE_DAYS = 3;

@Injectable()
export class ListingsCron {
  private readonly log = new Logger('ListingsCron');
  constructor(@InjectDb() private readonly db: Database, private readonly notifications: NotificationsService) {}

  /** Hourly: ACTIVE → EXPIRED past expiresAt; warn owners 3 days before (once per expiresAt value). */
  @Cron(CronExpression.EVERY_HOUR, { name: 'listing-expiry' })
  async run() {
    try {
      const expired = await this.expire();
      const warned = await this.warnExpiring();
      if (expired || warned) this.log.log(`expired ${expired}, warned ${warned}`);
    } catch (e) {
      this.log.error(e instanceof Error ? e.stack : String(e));
    }
  }

  async expire(now = new Date()) {
    const rows = await this.db
      .update(listings)
      .set({ status: 'EXPIRED' })
      .where(and(eq(listings.status, 'ACTIVE'), lte(listings.expiresAt, now)))
      .returning({ id: listings.id, ownerId: listings.ownerId, title: listings.title });
    for (const r of rows) {
      await this.notifications.notify(
        r.ownerId, 'LISTING_EXPIRED', 'Elanın müddəti bitdi',
        `"${r.title}" elanı deaktiv edildi. "Yenilə" düyməsi ilə onu yenidən aktivləşdirə bilərsiniz.`,
        { listingId: r.id },
      );
    }
    return rows.length;
  }

  async warnExpiring(now = new Date()) {
    // The notification's data.expiresAt de-duplicates: a renewed listing (new expiresAt) is warned again.
    const rows = await this.db
      .select({ id: listings.id, ownerId: listings.ownerId, title: listings.title, expiresAt: listings.expiresAt })
      .from(listings)
      .where(and(
        eq(listings.status, 'ACTIVE'),
        gt(listings.expiresAt, now),
        lte(listings.expiresAt, addDays(now, EXPIRING_NOTICE_DAYS)),
        sql`not exists (select 1 from ${notifications} n where n.user_id = ${listings.ownerId} and n.type = 'LISTING_EXPIRING'
          and n.data->>'listingId' = ${listings.id}::text
          and abs(extract(epoch from ((n.data->>'expiresAt')::timestamptz - ${listings.expiresAt}))) < 1)`,
      ));
    for (const r of rows) {
      const days = Math.max(1, Math.ceil((r.expiresAt!.getTime() - now.getTime()) / 86_400_000));
      await this.notifications.notify(
        r.ownerId, 'LISTING_EXPIRING', 'Elanın müddəti bitir',
        `"${r.title}" elanının müddəti ${days} gün sonra bitəcək. Elanı yeniləməyi unutmayın.`,
        { listingId: r.id, expiresAt: iso(r.expiresAt) },
      );
    }
    return rows.length;
  }
}
