import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { AuthResponse, Me } from '@evtap/shared';
import { config } from '../../config';
import { Database, InjectDb } from '../../db/db.module';
import { conversations, messages, notifications, otpCodes, refreshSessions, users, wallets } from '../../db/schema';
import { AppError } from '../../common/errors';
import { toUserDto, UserRow } from '../../common/mappers';
import { addDays, randomToken, sha256 } from '../../common/util';
import { SmsService } from '../sms/sms.service';
import { QuotaService } from '../settings/settings.service';

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

interface SessionMeta { userAgent?: string | null; ip?: string | null }

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly quota: QuotaService,
  ) {}

  // ───────── OTP (primary login on mobile & web, like bina.az) ─────────
  async requestOtp(phone: string) {
    const [last] = await this.db.select().from(otpCodes).where(eq(otpCodes.phone, phone)).orderBy(desc(otpCodes.createdAt)).limit(1);
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_MS) {
      const retryAfter = Math.ceil((OTP_RESEND_MS - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new AppError('OTP_TOO_FREQUENT', `Retry in ${retryAfter}s`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = config.sms.otpDevCode && !config.isProd ? config.sms.otpDevCode : String(randomInt(100000, 999999));
    await this.db.insert(otpCodes).values({ phone, codeHash: sha256(phone + ':' + code), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    await this.sms.send(phone, `EvTap təsdiq kodu: ${code}`);
    return { sent: true as const, retryAfter: OTP_RESEND_MS / 1000, ...(config.isProd ? {} : { devCode: code }) };
  }

  async verifyOtp(phone: string, code: string, name: string | undefined, meta: SessionMeta): Promise<AuthResponse> {
    const [otp] = await this.db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, new Date())))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!otp) throw new AppError('OTP_EXPIRED', 'Code expired, request a new one');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('OTP_TOO_MANY_ATTEMPTS', 'Too many attempts', HttpStatus.TOO_MANY_REQUESTS);
    if (otp.codeHash !== sha256(phone + ':' + code)) {
      await this.db.update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
      throw new AppError('OTP_INVALID', 'Invalid code');
    }
    await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));

    let [user] = await this.db.select().from(users).where(eq(users.phone, phone));
    let isNew = false;
    if (!user) {
      [user] = await this.db.insert(users).values({ phone, name: name?.trim() || 'İstifadəçi', isPhoneVerified: true }).returning();
      await this.db.insert(wallets).values({ userId: user.id }).onConflictDoNothing();
      isNew = true;
    } else if (!user.isPhoneVerified) {
      [user] = await this.db.update(users).set({ isPhoneVerified: true }).where(eq(users.id, user.id)).returning();
    }
    return { ...(await this.issue(user, meta)), isNew };
  }

  // ───────── Email / password (web, admin panel) ─────────
  async register(input: { name: string; email: string; password: string; phone?: string }, meta: SessionMeta): Promise<AuthResponse> {
    const exists = await this.db.select({ id: users.id }).from(users).where(input.phone ? or(eq(users.email, input.email), eq(users.phone, input.phone)) : eq(users.email, input.email));
    if (exists.length) throw new AppError('USER_EXISTS', 'User with this email or phone already exists', HttpStatus.CONFLICT);
    const [user] = await this.db
      .insert(users)
      .values({ name: input.name, email: input.email, phone: input.phone ?? null, passwordHash: await bcrypt.hash(input.password, 10) })
      .returning();
    await this.db.insert(wallets).values({ userId: user.id }).onConflictDoNothing();
    return { ...(await this.issue(user, meta)), isNew: true };
  }

  async login(login: string, password: string, meta: SessionMeta): Promise<AuthResponse> {
    const normalized = login.includes('@') ? login.toLowerCase() : login.replace(/[\s()-]/g, '');
    const [user] = await this.db.select().from(users).where(or(eq(users.email, normalized), eq(users.phone, normalized)));
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid login or password', HttpStatus.UNAUTHORIZED);
    }
    return this.issue(user, meta);
  }

  // ───────── Tokens ─────────
  async refresh(refreshToken: string, meta: SessionMeta): Promise<AuthResponse> {
    const hash = sha256(refreshToken);
    const [s] = await this.db.select().from(refreshSessions).where(eq(refreshSessions.tokenHash, hash));
    if (!s || s.expiresAt < new Date()) throw new AppError('REFRESH_INVALID', 'Session expired', HttpStatus.UNAUTHORIZED);
    if (s.revokedAt) {
      // Token reuse → possible theft: revoke every session of this user.
      await this.db.update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.userId, s.userId), isNull(refreshSessions.revokedAt)));
      throw new AppError('REFRESH_REUSED', 'Session revoked', HttpStatus.UNAUTHORIZED);
    }
    await this.db.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.id, s.id));
    const [user] = await this.db.select().from(users).where(eq(users.id, s.userId));
    if (!user) throw new AppError('REFRESH_INVALID', 'Session expired', HttpStatus.UNAUTHORIZED);
    return this.issue(user, meta, false);
  }

  async logout(refreshToken: string) {
    await this.db.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.tokenHash, sha256(refreshToken)));
    return { ok: true as const };
  }

  private async issue(user: UserRow, meta: SessionMeta, touchLogin = true): Promise<AuthResponse> {
    if (user.status !== 'ACTIVE') throw new AppError('USER_BLOCKED', 'Account is blocked', HttpStatus.FORBIDDEN);
    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role, acc: user.accountType, ag: user.agencyId },
      { secret: config.jwt.accessSecret, expiresIn: config.jwt.accessTtl },
    );
    const refreshToken = randomToken(48);
    await this.db.insert(refreshSessions).values({
      userId: user.id, tokenHash: sha256(refreshToken), userAgent: meta.userAgent ?? null, ip: meta.ip ?? null,
      expiresAt: addDays(new Date(), config.jwt.refreshTtlDays),
    });
    if (touchLogin) await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return { accessToken, refreshToken, expiresIn: config.jwt.accessTtl, user: toUserDto(user) };
  }

  async me(userId: string): Promise<Me> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status === 'DELETED') throw new AppError('UNAUTHORIZED', 'User not found', HttpStatus.UNAUTHORIZED);
    await this.db.insert(wallets).values({ userId }).onConflictDoNothing();
    const [wallet] = await this.db.select().from(wallets).where(eq(wallets.userId, userId));
    const sub = await this.quota.getActiveSubscription(userId, user.agencyId);
    const [unreadMsg] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(isNull(messages.readAt), sql`${messages.senderId} <> ${userId}`, or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId))));
    const [unreadNotif] = await this.db.select({ c: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return {
      ...toUserDto(user),
      wallet: { balance: wallet.balance, bonusBalance: wallet.bonusBalance, currency: wallet.currency as 'AZN' },
      subscription: sub ? await this.quota.toSubscriptionDto(sub) : null,
      quota: await this.quota.getQuota(userId, user.agencyId),
      unreadMessages: unreadMsg.c,
      unreadNotifications: unreadNotif.c,
    };
  }
}
