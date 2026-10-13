import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { AppNotification, NotificationType, Paginated } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { notifications } from '../../db/schema';
import { notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';

export const toNotificationDto = (row: typeof notifications.$inferSelect): AppNotification => ({
  id: row.id,
  type: row.type as NotificationType,
  title: row.title,
  body: row.body,
  data: row.data,
  readAt: iso(row.readAt),
  createdAt: iso(row.createdAt)!,
});

/** In-process domain events. Realtime gateway + push sender subscribe with @OnEvent(EVENTS.x). */
export const EVENTS = {
  notificationCreated: 'notification.created', // payload: { userId, notification: AppNotification, skipPush?: boolean }
  messageCreated: 'message.created', // payload: { recipientId, message: Message }
  conversationRead: 'conversation.read', // payload: { recipientId, conversationId, readerId, readAt }
  paymentUpdated: 'payment.updated', // payload: { userId, payment: Payment }
} as const;

/**
 * Central notification entry-point used by every module:
 *   await notifications.notify(userId, 'LISTING_APPROVED', 'Elanınız təsdiqləndi', '...', { listingId })
 * Persists the notification and emits EVENTS.notificationCreated (→ socket.io + mobile push).
 */
@Injectable()
export class NotificationsService {
  constructor(@InjectDb() private readonly db: Database, private readonly events: EventEmitter2) {}

  async notify(userId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown> = {}): Promise<AppNotification> {
    const [row] = await this.db.insert(notifications).values({ userId, type, title, body, data }).returning();
    const n = toNotificationDto(row);
    this.events.emit(EVENTS.notificationCreated, { userId, notification: n });
    return n;
  }

  // ───────── inbox (communication workstream) ─────────

  async list(userId: string, page: number, pageSize: number): Promise<Paginated<AppNotification>> {
    const { limit, offset } = pageArgs(page, pageSize);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(notifications).where(eq(notifications.userId, userId)),
    ]);
    return paginated(rows.map(toNotificationDto), total, page, pageSize);
  }

  async markRead(userId: string, id: string): Promise<{ ok: true }> {
    const [row] = await this.db.select({ id: notifications.id, readAt: notifications.readAt }).from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!row) throw notFound('Notification');
    if (!row.readAt) await this.db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
    return { ok: true };
  }

  async markAllRead(userId: string): Promise<{ ok: true }> {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }
}
