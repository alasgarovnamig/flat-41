import { HttpStatus, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { AdminListing, AdminUser, AuditLog, ListingReport, Paginated, Payment, Wallet, WalletTransaction } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { auditLogs, listingReports, listings, payments, refreshSessions, users, walletTransactions, wallets } from '../../db/schema';
import type { AuthUser } from '../../common/decorators';
import { AppError, notFound } from '../../common/errors';
import { toUserDto } from '../../common/mappers';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';
import { AuditService } from '../audit/audit.service';
import { adminCardColumns, toAdminListing } from '../listings/listing.mapper';
import { reportColumns, toAuditDto, toPaymentDto, toReportDto, toWalletTxDto } from './admin.mappers';

export interface AdminUserQuery { q?: string; role?: string; status?: string; accountType?: string; page: number; pageSize: number }

const adminUserColumns = {
  u: users,
  walletBalance: sql<number>`coalesce((select w.balance from wallets w where w.user_id = "users"."id"), 0)`,
  activeListings: sql<number>`(select count(*)::int from listings l where l.owner_id = "users"."id" and l.status = 'ACTIVE')`,
  totalSpent: sql<number>`(select coalesce(sum(p.amount - p.refunded_amount), 0)::int from payments p
    where p.user_id = "users"."id" and p.status in ('SUCCEEDED','PARTIALLY_REFUNDED') and p.purpose <> 'WALLET_TOPUP')`,
};
type AdminUserRow = { u: typeof users.$inferSelect; walletBalance: number; activeListings: number; totalSpent: number };
const toAdminUser = (r: AdminUserRow): AdminUser => ({
  ...toUserDto(r.u), walletBalance: r.walletBalance, activeListings: r.activeListings, totalSpent: r.totalSpent, lastLoginAt: iso(r.u.lastLoginAt),
});

/** Admin: users, reports, audit log. */
@Injectable()
export class AdminUsersService {
  constructor(@InjectDb() private readonly db: Database, private readonly audit: AuditService) {}

  async list(q: AdminUserQuery): Promise<Paginated<AdminUser>> {
    const conds: SQL[] = [];
    if (q.role) conds.push(eq(users.role, q.role));
    if (q.status) conds.push(eq(users.status, q.status));
    if (q.accountType) conds.push(eq(users.accountType, q.accountType));
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      conds.push(sql`(${users.id}::text = ${q.q} or ${users.name} ilike ${like} or coalesce(${users.email}, '') ilike ${like} or coalesce(${users.phone}, '') ilike ${like})`);
    }
    const where = conds.length ? and(...conds) : undefined;
    const { limit, offset } = pageArgs(q.page, q.pageSize);
    const rows = await this.db.select(adminUserColumns).from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(users).where(where);
    return paginated(rows.map(toAdminUser), c, q.page, q.pageSize);
  }

  async getAdminUser(id: string): Promise<AdminUser> {
    const [row] = await this.db.select(adminUserColumns).from(users).where(eq(users.id, id));
    if (!row) throw notFound('User');
    return toAdminUser(row);
  }

  async detail(id: string): Promise<AdminUser & { listings: AdminListing[]; payments: Payment[]; walletTransactions: WalletTransaction[] }> {
    const user = await this.getAdminUser(id);
    const ls = await this.db.select(adminCardColumns).from(listings).where(eq(listings.ownerId, id)).orderBy(desc(listings.createdAt)).limit(100);
    const ps = await this.db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)).limit(100);
    const txs = await this.db.select().from(walletTransactions).where(eq(walletTransactions.userId, id)).orderBy(desc(walletTransactions.createdAt)).limit(100);
    return { ...user, listings: ls.map(toAdminListing), payments: ps.map(toPaymentDto), walletTransactions: txs.map(toWalletTxDto) };
  }

  async update(id: string, input: { role?: string; status?: string; name?: string }, actor: AuthUser, ip: string | null): Promise<AdminUser> {
    const [cur] = await this.db.select().from(users).where(eq(users.id, id));
    if (!cur) throw notFound('User');
    if (id === actor.id && ((input.role && input.role !== cur.role) || (input.status && input.status !== 'ACTIVE'))) {
      throw new AppError('CANNOT_MODIFY_SELF', 'You cannot change your own role or status', HttpStatus.FORBIDDEN);
    }
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.role !== undefined) patch.role = input.role;
    if (input.status !== undefined) patch.status = input.status;
    if (input.name !== undefined) patch.name = input.name;
    if (Object.keys(patch).length) await this.db.update(users).set(patch).where(eq(users.id, id));
    // Role / status changes take effect on the next login: kill refresh sessions.
    if ((input.role && input.role !== cur.role) || (input.status && input.status !== 'ACTIVE')) {
      await this.db.update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.userId, id), isNull(refreshSessions.revokedAt)));
    }
    await this.audit.log(actor.id, 'user.update', 'user', id, { before: { role: cur.role, status: cur.status, name: cur.name }, after: input }, ip);
    return this.getAdminUser(id);
  }

  // TODO: delegate to WalletService.credit/debit (money workstream) once available; this writes the wallet tables directly.
  async walletAdjust(id: string, amount: number, reason: string, actor: AuthUser, ip: string | null): Promise<Wallet> {
    const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    const wallet = await this.db.transaction(async (tx) => {
      await tx.insert(wallets).values({ userId: id }).onConflictDoNothing();
      const [w] = await tx.select().from(wallets).where(eq(wallets.userId, id)).for('update');
      const balance = w.balance + amount;
      if (balance < 0) throw new AppError('INSUFFICIENT_FUNDS', 'Adjustment would make the balance negative');
      const [nw] = await tx.update(wallets).set({ balance }).where(eq(wallets.userId, id)).returning();
      await tx.insert(walletTransactions).values({
        userId: id, type: 'ADJUSTMENT', amount, bonusAmount: 0, balanceAfter: nw.balance + nw.bonusBalance, description: reason, actorId: actor.id,
      });
      return nw;
    });
    await this.audit.log(actor.id, 'wallet.adjust', 'user', id, { amount, reason }, ip);
    return { balance: wallet.balance, bonusBalance: wallet.bonusBalance, currency: wallet.currency as Wallet['currency'] };
  }

  // ───────── Reports ─────────
  async reports(status: string | undefined, page: number, pageSize: number): Promise<Paginated<ListingReport>> {
    const where = status ? eq(listingReports.status, status) : undefined;
    const { limit, offset } = pageArgs(page, pageSize);
    const rows = await this.db.select(reportColumns).from(listingReports).where(where).orderBy(desc(listingReports.createdAt)).limit(limit).offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(listingReports).where(where);
    return paginated(rows.map(toReportDto), c, page, pageSize);
  }

  async resolveReport(id: string, status: 'RESOLVED' | 'DISMISSED', actor: AuthUser, ip: string | null): Promise<ListingReport> {
    const r = await this.db
      .update(listingReports)
      .set({ status, resolvedById: actor.id, resolvedAt: new Date() })
      .where(eq(listingReports.id, id))
      .returning({ id: listingReports.id });
    if (!r.length) throw notFound('Report');
    await this.audit.log(actor.id, 'report.' + status.toLowerCase(), 'report', id, {}, ip);
    const [row] = await this.db.select(reportColumns).from(listingReports).where(eq(listingReports.id, id));
    return toReportDto(row);
  }

  // ───────── Audit log ─────────
  async auditLogs(q: { entity?: string; actorId?: string; page: number; pageSize: number }): Promise<Paginated<AuditLog>> {
    const where = and(q.entity ? eq(auditLogs.entity, q.entity) : undefined, q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined);
    const { limit, offset } = pageArgs(q.page, q.pageSize);
    const rows = await this.db
      .select({ a: auditLogs, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    return paginated(rows.map((r) => toAuditDto(r.a, r.actorName)), c, q.page, q.pageSize);
  }
}
