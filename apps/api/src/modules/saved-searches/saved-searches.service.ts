import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, sql } from 'drizzle-orm';
import { listingSearchSchema, type SavedSearch } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { savedSearches, users } from '../../db/schema';
import { AppError, notFound } from '../../common/errors';
import { iso } from '../../common/util';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_PER_USER = 30;
/** Paging / sorting keys are irrelevant for matching. */
const IGNORED_KEYS = ['page', 'pageSize', 'sort', 'bbox'];

type Row = typeof savedSearches.$inferSelect;
const toDto = (r: Row): SavedSearch => ({ id: r.id, name: r.name, query: r.query, notify: r.notify, newMatches: r.newMatches, createdAt: iso(r.createdAt)! });

@Injectable()
export class SavedSearchesService {
  private readonly log = new Logger('SavedSearches');
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Lists saved searches; the returned `newMatches` are then marked as seen (reset to 0). */
  async list(userId: string): Promise<SavedSearch[]> {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.userId, userId)).orderBy(desc(savedSearches.createdAt));
    if (rows.some((r) => r.newMatches > 0)) {
      await this.db.update(savedSearches).set({ newMatches: 0 }).where(and(eq(savedSearches.userId, userId), sql`${savedSearches.newMatches} > 0`));
    }
    return rows.map(toDto);
  }

  async create(userId: string, input: { name: string; query: Record<string, unknown>; notify: boolean }): Promise<SavedSearch> {
    const parsed = listingSearchSchema.safeParse(input.query);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'query is not a valid listing search');
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(savedSearches).where(eq(savedSearches.userId, userId));
    if (c >= MAX_PER_USER) throw new AppError('LIMIT_REACHED', `Max ${MAX_PER_USER} saved searches`);
    const query = Object.fromEntries(Object.entries(input.query).filter(([k, v]) => !IGNORED_KEYS.includes(k) && v !== undefined && v !== null && v !== ''));
    const [row] = await this.db.insert(savedSearches).values({ userId, name: input.name, query, notify: input.notify }).returning();
    return toDto(row);
  }

  async remove(userId: string, id: string) {
    const r = await this.db.delete(savedSearches).where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId))).returning({ id: savedSearches.id });
    if (!r.length) throw notFound('Saved search');
    return { ok: true as const };
  }

  /** Every 15 min: count listings published since lastCheckedAt that match each saved search. */
  @Cron('0 */15 * * * *', { name: 'saved-search-matcher' })
  async runMatcher() {
    try {
      const n = await this.match();
      if (n) this.log.log(`notified ${n} saved searches`);
    } catch (e) {
      this.log.error(e instanceof Error ? e.stack : String(e));
    }
  }

  async match(now = new Date()) {
    const rows = await this.db
      .select({ s: savedSearches })
      .from(savedSearches)
      .innerJoin(users, eq(savedSearches.userId, users.id))
      .where(eq(users.status, 'ACTIVE'));
    let notified = 0;
    for (const { s } of rows) {
      const parsed = listingSearchSchema.safeParse(s.query);
      let count = 0;
      if (parsed.success) count = await this.listings.countNewMatches(parsed.data, s.lastCheckedAt, now, s.userId);
      await this.db
        .update(savedSearches)
        .set({ lastCheckedAt: now, ...(count ? { newMatches: sql`${savedSearches.newMatches} + ${count}` } : {}) })
        .where(eq(savedSearches.id, s.id));
      if (count && s.notify) {
        await this.notifications.notify(
          s.userId, 'SAVED_SEARCH_MATCH', 'Yeni elanlar',
          `"${s.name}" axtarışınıza uyğun ${count} yeni elan var.`,
          { savedSearchId: s.id, count, query: s.query },
        );
        notified++;
      }
    }
    return notified;
  }
}
