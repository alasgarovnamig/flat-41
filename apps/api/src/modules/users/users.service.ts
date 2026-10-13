import { HttpStatus, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { PublicUser, User } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { agencies, agencyMembers, listings, pushTokens, refreshSessions, reviews, savedSearches, users } from '../../db/schema';
import { AppError, notFound } from '../../common/errors';
import { toUserDto } from '../../common/mappers';
import { iso } from '../../common/util';
import { toAgencySummary } from '../agencies/agency.mapper';

export interface UpdateMe { name?: string; email?: string; avatarUrl?: string | null; locale?: string }

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getPublicUser(id: string): Promise<PublicUser> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('User');
    const [agency] = u.agencyId ? await this.db.select().from(agencies).where(eq(agencies.id, u.agencyId)) : [];
    const [active] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.ownerId, id), eq(listings.status, 'ACTIVE')));
    const [rv] = await this.db
      .select({ avg: sql<number | null>`avg(${reviews.rating})::float`, c: sql<number>`count(*)::int` })
      .from(reviews)
      .innerJoin(listings, eq(reviews.listingId, listings.id))
      .where(eq(listings.ownerId, id));
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      accountType: u.accountType as PublicUser['accountType'],
      agency: agency ? toAgencySummary(agency) : null,
      memberSince: iso(u.createdAt)!,
      activeListings: active.c,
      rating: rv.avg != null ? Math.round(rv.avg * 10) / 10 : null,
      reviewsCount: rv.c,
    };
  }

  async updateMe(userId: string, input: UpdateMe): Promise<User> {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.email !== undefined) {
      const [taken] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.email, input.email), ne(users.id, userId)));
      if (taken) throw new AppError('EMAIL_TAKEN', 'Email is already used by another account', HttpStatus.CONFLICT);
      const [cur] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
      if (cur?.email !== input.email) {
        patch.email = input.email;
        patch.isEmailVerified = false;
      }
    }
    const [u] = Object.keys(patch).length
      ? await this.db.update(users).set(patch).where(eq(users.id, userId)).returning()
      : await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound('User');
    return toUserDto(u);
  }

  async changePassword(userId: string, currentPassword: string | undefined, newPassword: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound('User');
    if (u.passwordHash) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, u.passwordHash))) {
        throw new AppError('INVALID_PASSWORD', 'Current password is incorrect');
      }
    }
    await this.db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, 10) }).where(eq(users.id, userId));
    return { ok: true as const };
  }

  /** GDPR / App Store account deletion: anonymise PII, archive listings, revoke sessions & push tokens. */
  async deleteMe(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ name: 'Silinmiş istifadəçi', phone: null, email: null, passwordHash: null, avatarUrl: null, status: 'DELETED', isPhoneVerified: false, isEmailVerified: false })
        .where(eq(users.id, userId));
      await tx
        .update(listings)
        .set({ status: 'ARCHIVED' })
        .where(and(eq(listings.ownerId, userId), inArray(listings.status, ['DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'EXPIRED'])));
      await tx.update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
      await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));
      await tx.delete(savedSearches).where(eq(savedSearches.userId, userId));
      // Agents leave their agency; an agency owner's agency stays (admins can deal with it).
      const left = await tx.delete(agencyMembers).where(and(eq(agencyMembers.userId, userId), eq(agencyMembers.role, 'AGENT'))).returning();
      if (left.length) await tx.update(users).set({ agencyId: null }).where(eq(users.id, userId));
    });
    return { ok: true as const };
  }

  async addPushToken(userId: string, token: string, platform: string) {
    await this.db
      .insert(pushTokens)
      .values({ token, userId, platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform } });
    return { ok: true as const };
  }

  async removePushToken(userId: string, token: string) {
    await this.db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
    return { ok: true as const };
  }
}
