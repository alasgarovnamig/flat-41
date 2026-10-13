import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Conversation, Message, Paginated } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { conversations, listingImages, listings, messages, notifications, users } from '../../db/schema';
import { AppError, forbidden, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';
import { EVENTS, NotificationsService } from '../notifications/notifications.service';

type MessageRow = typeof messages.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;

/** Anti-spam: max messages a single user may send per minute (across all conversations). */
export const MESSAGES_PER_MINUTE = 30;
/** At most one NEW_MESSAGE notification (→ push) per conversation per recipient within this window. */
export const NEW_MESSAGE_NOTIFY_WINDOW_MS = 10 * 60_000;
const PREVIEW_LEN = 140;

/**
 * Strips characters that are invisible or can be abused for spoofing / breaking clients:
 * C0/C1 control chars (keeps \n and \t), zero-width chars, bidi overrides. Normalises line
 * breaks and collapses runs of blank lines. Returns '' when nothing visible remains.
 */
export function sanitizeMessage(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const toMessageDto = (m: MessageRow): Message => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  body: m.body,
  createdAt: iso(m.createdAt)!,
  readAt: iso(m.readAt),
});

@Injectable()
export class MessagingService {
  private readonly log = new Logger('Messaging');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────── Conversations ─────────

  async list(userId: string, page: number, pageSize: number): Promise<Paginated<Conversation>> {
    const mine = or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId));
    const { limit, offset } = pageArgs(page, pageSize);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(conversations).where(mine).orderBy(desc(conversations.lastMessageAt), desc(conversations.id)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(conversations).where(mine),
    ]);
    return paginated(await this.toDtos(userId, rows), total, page, pageSize);
  }

  async get(userId: string, conversationId: string): Promise<Conversation> {
    const conv = await this.getParticipating(userId, conversationId);
    const [dto] = await this.toDtos(userId, [conv]);
    return dto;
  }

  /** POST /conversations — re-uses the (listing, buyer) conversation, then sends the first message. */
  async start(userId: string, listingId: string, body: string): Promise<Conversation> {
    const [listing] = await this.db.select({ id: listings.id, ownerId: listings.ownerId, status: listings.status }).from(listings).where(eq(listings.id, listingId));
    if (!listing) throw notFound('Listing');
    if (listing.status === 'BLOCKED') throw new AppError('LISTING_BLOCKED', 'This listing is blocked', HttpStatus.FORBIDDEN);
    if (listing.ownerId === userId) throw new AppError('CANNOT_MESSAGE_SELF', 'You cannot message yourself');
    const text = this.cleanOrThrow(body);
    await this.assertRecipientAvailable(listing.ownerId);
    await this.assertRateLimit(userId);

    await this.db.insert(conversations).values({ listingId, buyerId: userId, sellerId: listing.ownerId }).onConflictDoNothing();
    const [conv] = await this.db.select().from(conversations).where(and(eq(conversations.listingId, listingId), eq(conversations.buyerId, userId)));
    await this.insertAndDispatch(conv, userId, text);
    return this.get(userId, conv.id);
  }

  async messages(userId: string, conversationId: string, before: string | undefined, limit: number): Promise<Message[]> {
    await this.getParticipating(userId, conversationId);
    let cursor = undefined;
    if (before) {
      const [b] = await this.db.select({ id: messages.id }).from(messages).where(and(eq(messages.id, before), eq(messages.conversationId, conversationId)));
      if (!b) throw new AppError('INVALID_CURSOR', 'Unknown "before" message');
      // Row comparison inside SQL keeps Postgres' microsecond precision (JS Dates would truncate to ms).
      cursor = sql`(${messages.createdAt}, ${messages.id}) < (select m2.created_at, m2.id from ${messages} m2 where m2.id = ${b.id})`;
    }
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), cursor))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows.reverse().map(toMessageDto); // newest last
  }

  async send(userId: string, conversationId: string, body: string): Promise<Message> {
    const conv = await this.getParticipating(userId, conversationId);
    const text = this.cleanOrThrow(body);
    const [listing] = await this.db.select({ status: listings.status }).from(listings).where(eq(listings.id, conv.listingId));
    if (listing?.status === 'BLOCKED') throw new AppError('LISTING_BLOCKED', 'This listing is blocked', HttpStatus.FORBIDDEN);
    await this.assertRecipientAvailable(this.otherId(conv, userId));
    await this.assertRateLimit(userId);
    return this.insertAndDispatch(conv, userId, text);
  }

  /** Marks every message from the other participant as read and tells them over realtime. */
  async markRead(userId: string, conversationId: string): Promise<{ ok: true }> {
    const conv = await this.getParticipating(userId, conversationId);
    const readAt = new Date();
    const updated = await this.db
      .update(messages)
      .set({ readAt })
      .where(and(eq(messages.conversationId, conversationId), ne(messages.senderId, userId), isNull(messages.readAt)))
      .returning({ id: messages.id });
    if (updated.length) {
      this.events.emit(EVENTS.conversationRead, { recipientId: this.otherId(conv, userId), conversationId, readerId: userId, readAt: readAt.toISOString() });
    }
    return { ok: true };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const [r] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(isNull(messages.readAt), ne(messages.senderId, userId), or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId))));
    return { count: r.c };
  }

  /** Participant ids of a conversation, or null when the user is not part of it (used by the realtime gateway). */
  async participants(conversationId: string): Promise<{ buyerId: string; sellerId: string } | null> {
    const [c] = await this.db.select({ buyerId: conversations.buyerId, sellerId: conversations.sellerId }).from(conversations).where(eq(conversations.id, conversationId));
    return c ?? null;
  }

  // ───────── internals ─────────

  private otherId(conv: Pick<ConversationRow, 'buyerId' | 'sellerId'>, userId: string) {
    return conv.buyerId === userId ? conv.sellerId : conv.buyerId;
  }

  private async getParticipating(userId: string, conversationId: string): Promise<ConversationRow> {
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) throw notFound('Conversation');
    if (conv.buyerId !== userId && conv.sellerId !== userId) throw forbidden('Not a participant of this conversation');
    return conv;
  }

  private cleanOrThrow(body: string): string {
    const text = sanitizeMessage(body);
    if (!text) throw new AppError('MESSAGE_EMPTY', 'Message is empty');
    return text;
  }

  private async assertRecipientAvailable(recipientId: string) {
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, recipientId));
    if (!u || u.status === 'DELETED') throw new AppError('RECIPIENT_UNAVAILABLE', 'This user is no longer available', HttpStatus.GONE);
  }

  private async assertRateLimit(userId: string) {
    const since = new Date(Date.now() - 60_000);
    const [r] = await this.db.select({ c: count() }).from(messages).where(and(eq(messages.senderId, userId), gt(messages.createdAt, since)));
    if (r.c >= MESSAGES_PER_MINUTE) throw new AppError('RATE_LIMITED', 'Too many messages, slow down', HttpStatus.TOO_MANY_REQUESTS);
  }

  private async insertAndDispatch(conv: ConversationRow, senderId: string, body: string): Promise<Message> {
    const row = await this.db.transaction(async (tx) => {
      const [m] = await tx.insert(messages).values({ conversationId: conv.id, senderId, body }).returning();
      await tx.update(conversations).set({ lastMessageAt: m.createdAt }).where(eq(conversations.id, conv.id));
      return m;
    });
    const message = toMessageDto(row);
    const recipientId = this.otherId(conv, senderId);
    this.events.emit(EVENTS.messageCreated, { recipientId, message });
    // Notification + push are best-effort: never fail the send because of them.
    await this.maybeNotify(recipientId, conv, senderId, message).catch((e) => this.log.warn(`NEW_MESSAGE notify failed: ${(e as Error).message}`));
    return message;
  }

  /** Throttled: one NEW_MESSAGE notification per conversation per recipient per 10 minutes. */
  private async maybeNotify(recipientId: string, conv: ConversationRow, senderId: string, message: Message) {
    const since = new Date(Date.now() - NEW_MESSAGE_NOTIFY_WINDOW_MS);
    const [recent] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.userId, recipientId),
        eq(notifications.type, 'NEW_MESSAGE'),
        gt(notifications.createdAt, since),
        sql`${notifications.data}->>'conversationId' = ${conv.id}`,
      ))
      .limit(1);
    if (recent) return;
    const [sender] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, senderId));
    const preview = message.body.length > PREVIEW_LEN ? message.body.slice(0, PREVIEW_LEN - 1) + '…' : message.body;
    await this.notifications.notify(recipientId, 'NEW_MESSAGE', sender?.name ?? 'Yeni mesaj', preview, {
      conversationId: conv.id,
      listingId: conv.listingId,
      senderId,
      messageId: message.id,
    });
  }

  /** Builds Conversation DTOs for `userId` with 4 batched queries (no N+1). */
  private async toDtos(userId: string, rows: ConversationRow[]): Promise<Conversation[]> {
    if (!rows.length) return [];
    const convIds = rows.map((r) => r.id);
    const listingIds = [...new Set(rows.map((r) => r.listingId))];
    const otherIds = [...new Set(rows.map((r) => this.otherId(r, userId)))];

    const [listingRows, coverRows, userRows, lastRows, unreadRows] = await Promise.all([
      this.db
        .select({ id: listings.id, title: listings.title, price: listings.price, currency: listings.currency, pricePeriod: listings.pricePeriod, status: listings.status })
        .from(listings)
        .where(inArray(listings.id, listingIds)),
      this.db
        .selectDistinctOn([listingImages.listingId], { listingId: listingImages.listingId, url: listingImages.thumbUrl })
        .from(listingImages)
        .where(inArray(listingImages.listingId, listingIds))
        .orderBy(listingImages.listingId, asc(listingImages.order)),
      this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, status: users.status }).from(users).where(inArray(users.id, otherIds)),
      this.db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, convIds))
        .orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id)),
      this.db
        .select({ conversationId: messages.conversationId, c: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(inArray(messages.conversationId, convIds), ne(messages.senderId, userId), isNull(messages.readAt)))
        .groupBy(messages.conversationId),
    ]);

    const listingMap = new Map(listingRows.map((l) => [l.id, l]));
    const coverMap = new Map(coverRows.map((c) => [c.listingId, c.url]));
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const lastMap = new Map(lastRows.map((m) => [m.conversationId, m]));
    const unreadMap = new Map(unreadRows.map((u) => [u.conversationId, u.c]));

    return rows.map((r) => {
      const l = listingMap.get(r.listingId)!;
      const other = userMap.get(this.otherId(r, userId));
      const last = lastMap.get(r.id);
      return {
        id: r.id,
        listing: {
          id: l.id,
          title: l.title,
          coverUrl: coverMap.get(l.id) ?? null,
          price: l.price,
          currency: l.currency as Conversation['listing']['currency'],
          pricePeriod: l.pricePeriod as Conversation['listing']['pricePeriod'],
          status: l.status as Conversation['listing']['status'],
        },
        otherUser: other && other.status !== 'DELETED'
          ? { id: other.id, name: other.name, avatarUrl: other.avatarUrl }
          : { id: this.otherId(r, userId), name: other?.name ?? 'İstifadəçi', avatarUrl: null },
        lastMessage: last ? toMessageDto(last) : null,
        unreadCount: unreadMap.get(r.id) ?? 0,
        updatedAt: iso(r.lastMessageAt)!,
      };
    });
  }
}
