import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { inArray } from 'drizzle-orm';
import type { AppNotification } from '@evtap/shared';
import { config } from '../../config';
import { Database, InjectDb } from '../../db/db.module';
import { pushTokens } from '../../db/schema';
import { EVENTS } from '../notifications/notifications.service';
import { ConsolePushProvider, ExpoPushProvider, PushMessage, PushProvider } from './push.providers';

export interface PushPayload { title: string; body: string; data: Record<string, unknown> }

/** Deep-link friendly push data: `{ type, notificationId, ...notification.data }` (conversationId, listingId, paymentId, bookingId…). */
export const notificationPushData = (n: AppNotification): Record<string, unknown> => ({ ...n.data, type: n.type, notificationId: n.id });

@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  readonly provider: PushProvider = config.push.provider === 'expo' ? new ExpoPushProvider(config.push.expoAccessToken) : new ConsolePushProvider();

  constructor(@InjectDb() private readonly db: Database) {}

  /** Every notification goes to the user's devices. Broadcasts set `skipPush` and push in bulk themselves. */
  @OnEvent(EVENTS.notificationCreated, { async: true })
  async onNotificationCreated(e: { userId: string; notification: AppNotification; skipPush?: boolean }) {
    if (e.skipPush) return;
    try {
      await this.sendToUsers([e.userId], { title: e.notification.title, body: e.notification.body, data: notificationPushData(e.notification) });
    } catch (err) {
      this.log.warn(`push for notification ${e.notification.id} failed: ${(err as Error).message}`);
    }
  }

  /** Sends one payload to all devices of the given users. Returns the number of device messages handed to the provider. */
  async sendToUsers(userIds: string[], payload: PushPayload | ((userId: string) => PushPayload)): Promise<number> {
    if (!userIds.length) return 0;
    const tokens = await this.db.select({ token: pushTokens.token, userId: pushTokens.userId }).from(pushTokens).where(inArray(pushTokens.userId, userIds));
    if (!tokens.length) return 0;
    const messages: PushMessage[] = tokens.map((t) => ({ to: t.token, ...(typeof payload === 'function' ? payload(t.userId) : payload) }));
    const { invalidTokens } = await this.provider.send(messages);
    await this.removeTokens(invalidTokens);
    return messages.length;
  }

  @Interval('push-receipts', 5 * 60_000)
  async checkReceipts() {
    if (!this.provider.collectReceipts) return;
    const { invalidTokens } = await this.provider.collectReceipts();
    await this.removeTokens(invalidTokens);
  }

  private async removeTokens(tokens: string[]) {
    if (!tokens.length) return;
    await this.db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
    this.log.log(`removed ${tokens.length} unregistered push token(s)`);
  }
}
