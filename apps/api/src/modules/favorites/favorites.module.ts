import { Controller, Delete, Get, HttpCode, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { paginationSchema, type ListingCard, type Paginated } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { favorites, listings } from '../../db/schema';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { cardColumns, toCard } from '../listings/listing.mapper';

@Injectable()
export class FavoritesService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(userId: string, page: number, pageSize: number): Promise<Paginated<ListingCard>> {
    const { limit, offset } = pageArgs(page, pageSize);
    const rows = await this.db
      .select(cardColumns)
      .from(favorites)
      .innerJoin(listings, eq(favorites.listingId, listings.id))
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(favorites).where(eq(favorites.userId, userId));
    return paginated(rows.map((r) => toCard(r)), c, page, pageSize);
  }

  async ids(userId: string): Promise<string[]> {
    const rows = await this.db.select({ id: favorites.listingId }).from(favorites).where(eq(favorites.userId, userId)).orderBy(desc(favorites.createdAt));
    return rows.map((r) => r.id);
  }

  async add(userId: string, listingId: string) {
    const [l] = await this.db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
    if (!l) throw notFound('Listing');
    await this.db.transaction(async (tx) => {
      const ins = await tx.insert(favorites).values({ userId, listingId }).onConflictDoNothing().returning({ id: favorites.listingId });
      if (ins.length) await tx.update(listings).set({ favoritesCount: sql`${listings.favoritesCount} + 1` }).where(eq(listings.id, listingId));
    });
    return { ok: true as const };
  }

  async remove(userId: string, listingId: string) {
    await this.db.transaction(async (tx) => {
      const del = await tx.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.listingId, listingId))).returning({ id: favorites.listingId });
      if (del.length) await tx.update(listings).set({ favoritesCount: sql`greatest(${listings.favoritesCount} - 1, 0)` }).where(eq(listings.id, listingId));
    });
    return { ok: true as const };
  }
}

@ApiTags('favorites')
@ApiBearerAuth()
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.favorites.list(user.id, q.page, q.pageSize);
  }

  @Get('ids')
  ids(@CurrentUser() user: AuthUser) {
    return this.favorites.ids(user.id);
  }

  @Post(':listingId')
  @HttpCode(200)
  add(@CurrentUser() user: AuthUser, @UuidParam('listingId') listingId: string) {
    return this.favorites.add(user.id, listingId);
  }

  @Delete(':listingId')
  remove(@CurrentUser() user: AuthUser, @UuidParam('listingId') listingId: string) {
    return this.favorites.remove(user.id, listingId);
  }
}

@Module({ controllers: [FavoritesController], providers: [FavoritesService], exports: [FavoritesService] })
export class FavoritesModule {}
