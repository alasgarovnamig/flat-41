import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { slugify, type Agency, type AgencyInput, type AgencyMember, type Paginated, type TimeseriesPoint } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { agencies, agencyMembers, listings, users } from '../../db/schema';
import { AppError, forbidden, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { addDays, iso, ymd } from '../../common/util';
import { QuotaService, SettingsService } from '../settings/settings.service';
import { AgencyRow, toAgency } from './agency.mapper';

const activeCount = sql<number>`(select count(*)::int from listings l where l.agency_id = "agencies"."id" and l.status = 'ACTIVE')`;
/** Agents allowed without an active subscription (= the owner alone). */
const DEFAULT_MAX_AGENTS = 1;

export interface AgencyListQuery { type?: string; cityId?: string; q?: string; verified?: boolean; page: number; pageSize: number }

@Injectable()
export class AgenciesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly quota: QuotaService,
    private readonly settings: SettingsService,
  ) {}

  async list(q: AgencyListQuery): Promise<Paginated<Agency>> {
    const conds: SQL[] = [];
    if (q.type) conds.push(eq(agencies.type, q.type));
    if (q.cityId) conds.push(eq(agencies.cityId, q.cityId));
    if (q.verified !== undefined) conds.push(eq(agencies.verified, q.verified));
    if (q.q) conds.push(ilike(agencies.name, `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`));
    const where = conds.length ? and(...conds) : undefined;
    const { limit, offset } = pageArgs(q.page, q.pageSize);
    const rows = await this.db
      .select({ a: agencies, active: activeCount })
      .from(agencies)
      .where(where)
      .orderBy(desc(agencies.verified), desc(activeCount), asc(agencies.name))
      .limit(limit)
      .offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(agencies).where(where);
    return paginated(rows.map((r) => toAgency(r.a, r.active)), c, q.page, q.pageSize);
  }

  async toDto(a: AgencyRow): Promise<Agency> {
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listings).where(and(eq(listings.agencyId, a.id), eq(listings.status, 'ACTIVE')));
    return toAgency(a, c);
  }

  async bySlug(slug: string): Promise<Agency> {
    const [a] = await this.db.select().from(agencies).where(eq(agencies.slug, slug));
    if (!a) throw notFound('Agency');
    return this.toDto(a);
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name) || 'agency';
    const taken = await this.db.select({ slug: agencies.slug }).from(agencies).where(or(eq(agencies.slug, base), sql`${agencies.slug} like ${base + '-%'}`));
    const set = new Set(taken.map((t) => t.slug));
    if (!set.has(base)) return base;
    for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  async create(userId: string, input: AgencyInput): Promise<Agency> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound('User');
    if (u.agencyId) throw new AppError('ALREADY_IN_AGENCY', 'You already belong to an agency', HttpStatus.CONFLICT);
    const slug = await this.uniqueSlug(input.name);
    const agency = await this.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(agencies)
        .values({
          ownerId: userId, name: input.name, slug, type: input.type, description: input.description ?? null, logoUrl: input.logoUrl ?? null,
          phone: input.phone ?? u.phone, email: input.email ?? u.email, website: input.website ?? null, address: input.address ?? null, cityId: input.cityId ?? null,
        })
        .returning();
      await tx.insert(agencyMembers).values({ agencyId: a.id, userId, role: 'OWNER' });
      await tx.update(users).set({ accountType: 'BUSINESS', agencyId: a.id }).where(eq(users.id, userId));
      // The owner's live listings now appear under the agency.
      await tx.update(listings).set({ agencyId: a.id }).where(and(eq(listings.ownerId, userId), inArray(listings.status, ['DRAFT', 'PENDING', 'ACTIVE', 'EXPIRED'])));
      return a;
    });
    return this.toDto(agency);
  }

  /** The caller's agency (any member). */
  async myAgency(userId: string): Promise<AgencyRow> {
    const [m] = await this.db
      .select({ a: agencies, role: agencyMembers.role })
      .from(agencyMembers)
      .innerJoin(agencies, eq(agencyMembers.agencyId, agencies.id))
      .where(eq(agencyMembers.userId, userId));
    if (!m) throw new AppError('NO_AGENCY', 'You are not a member of an agency', HttpStatus.NOT_FOUND);
    return m.a;
  }

  private async ownedAgency(userId: string): Promise<AgencyRow> {
    const a = await this.myAgency(userId);
    const [m] = await this.db.select().from(agencyMembers).where(and(eq(agencyMembers.agencyId, a.id), eq(agencyMembers.userId, userId)));
    if (a.ownerId !== userId && m?.role !== 'OWNER') throw forbidden('Only the agency owner can do this');
    return a;
  }

  async getMine(userId: string) {
    return this.toDto(await this.myAgency(userId));
  }

  async updateMine(userId: string, input: Partial<AgencyInput>): Promise<Agency> {
    const a = await this.ownedAgency(userId);
    const patch: Partial<typeof agencies.$inferInsert> = {};
    for (const k of ['name', 'type', 'description', 'phone', 'email', 'website', 'address', 'cityId', 'logoUrl'] as const) {
      if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    }
    if (!Object.keys(patch).length) return this.toDto(a);
    const [row] = await this.db.update(agencies).set(patch).where(eq(agencies.id, a.id)).returning();
    return this.toDto(row);
  }

  async members(userId: string): Promise<AgencyMember[]> {
    const a = await this.ownedAgency(userId);
    return this.memberList(a.id);
  }

  private async memberList(agencyId: string): Promise<AgencyMember[]> {
    const rows = await this.db
      .select({
        m: agencyMembers, u: users,
        active: sql<number>`(select count(*)::int from listings l where l.owner_id = "users"."id" and l.status = 'ACTIVE')`,
      })
      .from(agencyMembers)
      .innerJoin(users, eq(agencyMembers.userId, users.id))
      .where(eq(agencyMembers.agencyId, agencyId))
      .orderBy(sql`case when ${agencyMembers.role} = 'OWNER' then 0 else 1 end`, asc(agencyMembers.createdAt));
    return rows.map(({ m, u, active }) => ({
      userId: u.id, name: u.name, phone: u.phone, email: u.email, avatarUrl: u.avatarUrl,
      role: m.role as AgencyMember['role'], activeListings: active, joinedAt: iso(m.createdAt)!,
    }));
  }

  async maxAgents(ownerId: string, agencyId: string) {
    const sub = await this.quota.getActiveSubscription(ownerId, agencyId);
    if (!sub) return DEFAULT_MAX_AGENTS;
    const plan = await this.settings.getPlan(sub.planCode);
    return plan?.maxAgents ?? DEFAULT_MAX_AGENTS;
  }

  async addMember(userId: string, login: string): Promise<AgencyMember> {
    const a = await this.ownedAgency(userId);
    const normalized = login.includes('@') ? login.trim().toLowerCase() : login.replace(/[\s()-]/g, '').replace(/^0(\d{9})$/, '+994$1');
    const [target] = await this.db.select().from(users).where(or(eq(users.email, normalized), eq(users.phone, normalized)));
    if (!target || target.status !== 'ACTIVE') throw new AppError('USER_NOT_FOUND', 'No active user with this phone or email', HttpStatus.NOT_FOUND);
    if (target.agencyId === a.id) throw new AppError('ALREADY_MEMBER', 'User is already a member', HttpStatus.CONFLICT);
    if (target.agencyId) throw new AppError('ALREADY_IN_AGENCY', 'User belongs to another agency', HttpStatus.CONFLICT);

    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(agencyMembers).where(eq(agencyMembers.agencyId, a.id));
    const max = await this.maxAgents(a.ownerId, a.id);
    if (c >= max) throw new AppError('AGENT_LIMIT_REACHED', `Your plan allows ${max} member(s). Upgrade the subscription to add more agents.`, HttpStatus.FORBIDDEN);

    await this.db.transaction(async (tx) => {
      await tx.insert(agencyMembers).values({ agencyId: a.id, userId: target.id, role: 'AGENT' });
      await tx.update(users).set({ agencyId: a.id, accountType: 'BUSINESS' }).where(eq(users.id, target.id));
      await tx.update(listings).set({ agencyId: a.id }).where(and(eq(listings.ownerId, target.id), inArray(listings.status, ['DRAFT', 'PENDING', 'ACTIVE', 'EXPIRED'])));
    });
    return (await this.memberList(a.id)).find((m) => m.userId === target.id)!;
  }

  async removeMember(userId: string, memberId: string) {
    const a = await this.ownedAgency(userId);
    if (memberId === a.ownerId) throw new AppError('CANNOT_REMOVE_OWNER', 'The agency owner cannot be removed');
    const del = await this.db.transaction(async (tx) => {
      const r = await tx.delete(agencyMembers).where(and(eq(agencyMembers.agencyId, a.id), eq(agencyMembers.userId, memberId))).returning();
      if (!r.length) return false;
      await tx.update(users).set({ agencyId: null, accountType: 'INDIVIDUAL' }).where(eq(users.id, memberId));
      await tx.update(listings).set({ agencyId: null }).where(and(eq(listings.ownerId, memberId), eq(listings.agencyId, a.id)));
      return true;
    });
    if (!del) throw notFound('Member');
    return { ok: true as const };
  }

  async stats(userId: string, days: number) {
    const a = await this.myAgency(userId);
    const since = ymd(addDays(new Date(), -(days - 1)));
    const daily = await this.db.execute<{ date: string; views: number; phone_views: number; messages: number }>(sql`
      select to_char(d, 'YYYY-MM-DD') as date,
        coalesce((select sum(s.views) from listing_daily_stats s join listings l on l.id = s.listing_id where l.agency_id = ${a.id} and s.date = d::date), 0)::int as views,
        coalesce((select sum(s.phone_views) from listing_daily_stats s join listings l on l.id = s.listing_id where l.agency_id = ${a.id} and s.date = d::date), 0)::int as phone_views,
        (select count(*) from messages m join conversations c on c.id = m.conversation_id join listings l on l.id = c.listing_id
          where l.agency_id = ${a.id} and m.sender_id <> c.seller_id and m.created_at >= d and m.created_at < d + interval '1 day')::int as messages
      from generate_series(${since}::date, current_date, interval '1 day') d
      order by d`);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listings).where(and(eq(listings.agencyId, a.id), eq(listings.status, 'ACTIVE')));
    const points: TimeseriesPoint[] = daily.rows.map((r) => ({ date: r.date, value: r.views, views: r.views, phoneViews: r.phone_views, messages: r.messages }));
    return {
      views: points.reduce((s, p) => s + (p.views as number), 0),
      phoneViews: points.reduce((s, p) => s + (p.phoneViews as number), 0),
      messages: points.reduce((s, p) => s + (p.messages as number), 0),
      listings: c,
      daily: points,
    };
  }

  /** Admin: toggle the verified badge. */
  async setVerified(id: string, verified: boolean): Promise<Agency> {
    const [row] = await this.db.update(agencies).set({ verified }).where(eq(agencies.id, id)).returning();
    if (!row) throw notFound('Agency');
    return this.toDto(row);
  }
}

