import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Banner, BannerInput, CmsPage, CmsPageInput } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { banners, cmsPages } from '../../db/schema';
import { notFound } from '../../common/errors';
import { iso } from '../../common/util';

type BannerRow = typeof banners.$inferSelect;
type PageRow = typeof cmsPages.$inferSelect;

export const toBannerDto = (b: BannerRow): Banner => ({
  id: b.id, placement: b.placement as Banner['placement'], title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl, active: b.active,
  startsAt: iso(b.startsAt), endsAt: iso(b.endsAt), impressions: b.impressions, clicks: b.clicks, sortOrder: b.sortOrder,
});
export const toPageDto = (p: PageRow): CmsPage => ({ slug: p.slug, title: p.title, body: p.body, updatedAt: iso(p.updatedAt)! });

/** Banners (ad slots) + CMS pages. */
@Injectable()
export class ContentService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Active banners for a placement within their date window; counts one impression each. */
  async activeBanners(placement?: string): Promise<Banner[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(banners)
      .where(and(
        eq(banners.active, true),
        placement ? eq(banners.placement, placement) : undefined,
        or(isNull(banners.startsAt), lte(banners.startsAt, now)),
        or(isNull(banners.endsAt), gt(banners.endsAt, now)),
      ))
      .orderBy(asc(banners.sortOrder), desc(banners.createdAt));
    if (rows.length) {
      await this.db.update(banners).set({ impressions: sql`${banners.impressions} + 1` }).where(inArray(banners.id, rows.map((r) => r.id)));
    }
    return rows.map((r) => toBannerDto({ ...r, impressions: r.impressions + 1 }));
  }

  async click(id: string) {
    const r = await this.db.update(banners).set({ clicks: sql`${banners.clicks} + 1` }).where(eq(banners.id, id)).returning({ id: banners.id });
    if (!r.length) throw notFound('Banner');
    return { ok: true as const };
  }

  async allBanners(): Promise<Banner[]> {
    const rows = await this.db.select().from(banners).orderBy(asc(banners.placement), asc(banners.sortOrder));
    return rows.map(toBannerDto);
  }

  private bannerValues(input: Partial<BannerInput>) {
    const v: Partial<typeof banners.$inferInsert> = {};
    for (const k of ['placement', 'title', 'imageUrl', 'linkUrl', 'active', 'sortOrder'] as const) {
      if (input[k] !== undefined) (v as Record<string, unknown>)[k] = input[k];
    }
    if (input.startsAt !== undefined) v.startsAt = input.startsAt ? new Date(input.startsAt) : null;
    if (input.endsAt !== undefined) v.endsAt = input.endsAt ? new Date(input.endsAt) : null;
    return v;
  }

  async createBanner(input: BannerInput): Promise<Banner> {
    const [row] = await this.db.insert(banners).values(this.bannerValues(input) as typeof banners.$inferInsert).returning();
    return toBannerDto(row);
  }

  async updateBanner(id: string, input: Partial<BannerInput>): Promise<Banner> {
    const v = this.bannerValues(input);
    const [row] = Object.keys(v).length
      ? await this.db.update(banners).set(v).where(eq(banners.id, id)).returning()
      : await this.db.select().from(banners).where(eq(banners.id, id));
    if (!row) throw notFound('Banner');
    return toBannerDto(row);
  }

  async deleteBanner(id: string) {
    const r = await this.db.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id });
    if (!r.length) throw notFound('Banner');
    return { ok: true as const };
  }

  async page(slug: string): Promise<CmsPage> {
    const [p] = await this.db.select().from(cmsPages).where(eq(cmsPages.slug, slug));
    if (!p) throw notFound('Page');
    return toPageDto(p);
  }

  async pages(): Promise<CmsPage[]> {
    const rows = await this.db.select().from(cmsPages).orderBy(asc(cmsPages.slug));
    return rows.map(toPageDto);
  }

  async upsertPage(slug: string, input: Pick<CmsPageInput, 'title' | 'body'>): Promise<CmsPage> {
    const [row] = await this.db
      .insert(cmsPages)
      .values({ slug, title: input.title, body: input.body })
      .onConflictDoUpdate({ target: cmsPages.slug, set: { title: input.title, body: input.body, updatedAt: new Date() } })
      .returning();
    return toPageDto(row);
  }

  async deletePage(slug: string) {
    const r = await this.db.delete(cmsPages).where(eq(cmsPages.slug, slug)).returning({ slug: cmsPages.slug });
    if (!r.length) throw notFound('Page');
    return { ok: true as const };
  }
}
