import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppNotification, NotificationType } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { notifications } from '../../db/schema';
import { iso } from '../../common/util';

/** In-process domain events. Realtime gateway + push sender subscribe with @OnEvent(EVENTS.x). */
export const EVENTS = {
  notificationCreated: 'notification.created', // payload: { userId, notification: AppNotification }
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
    const n: AppNotification = { id: row.id, type: row.type as NotificationType, title: row.title, body: row.body, data: row.data, readAt: null, createdAt: iso(row.createdAt)! };
    this.events.emit(EVENTS.notificationCreated, { userId, notification: n });
    return n;
  }
}
