import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, InjectDb, Tx } from '../../db/db.module';
import { listings } from '../../db/schema';
import { addDays } from '../../common/util';
import { SettingsService } from '../settings/settings.service';
import { withTx } from '../wallet/tx';

/**
 * Listing state changes caused by payments. The listings table belongs to the marketplace workstream, whose
 * `ListingsService.markListingFeePaid / markVerified` is not available in this worktree yet.
 * TODO: delegate to ListingsService.markListingFeePaid(listingId, tx) / markVerified(listingId, tx) once merged.
 */
@Injectable()
export class ListingFulfilment {
  constructor(@InjectDb() private readonly db: Database, private readonly settings: SettingsService) {}

  /** LISTING_FEE paid: DRAFT → PENDING (or ACTIVE when moderation is disabled); the listing no longer counts against the free quota. */
  async markListingFeePaid(listingId: string, tx?: Tx): Promise<boolean> {
    const s = await this.settings.getSettings();
    return withTx(this.db, tx, async (t) => {
      const [l] = await t.select().from(listings).where(eq(listings.id, listingId)).for('update');
      if (!l) return false;
      const now = new Date();
      const patch: Partial<typeof listings.$inferInsert> = { isFreeQuota: false };
      if (l.status === 'DRAFT') {
        if (s.moderationEnabled) patch.status = 'PENDING';
        else Object.assign(patch, { status: 'ACTIVE', publishedAt: now, bumpedAt: now, expiresAt: addDays(now, s.listingLifetimeDays) });
      }
      await t.update(listings).set(patch).where(eq(listings.id, listingId));
      return true;
    });
  }

  /**
   * VERIFICATION paid. In reality an inspector visits the property first and a moderator sets the badge after
   * the visit; for the MVP we grant the "Yoxlanılıb" badge immediately on payment.
   */
  async markVerified(listingId: string, verified = true, tx?: Tx): Promise<boolean> {
    return withTx(this.db, tx, async (t) => {
      const rows = await t.update(listings).set({ isVerified: verified }).where(eq(listings.id, listingId)).returning({ id: listings.id });
      return rows.length > 0;
    });
  }
}
