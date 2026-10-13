import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, eq, gt, SQL } from 'drizzle-orm';
import { Database, InjectDb } from '../../db/db.module';
import { notifications, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { notificationPushData, PushService } from '../push/push.service';
import { EVENTS, toNotificationDto } from './notifications.service';

export type BroadcastAudience = 'ALL' | 'BUSINESS' | 'INDIVIDUAL';
const BATCH = 1000;

/** Admin broadcast: SYSTEM notification to every active user of the audience, inserted + pushed in batches. */
@Injectable()
export class BroadcastService {
  private readonly log = new Logger('Broadcast');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly events: EventEmitter2,
    private readonly push: PushService,
    private readonly audit: AuditService,
  ) {}

  async broadcast(actorId: string, input: { title: string; body: string; audience: BroadcastAudience }, ip: string | null): Promise<{ sent: number }> {
    const audienceFilter: SQL | undefined = input.audience === 'ALL' ? undefined : eq(users.accountType, input.audience);
    let cursor: string | null = null;
    let sent = 0;
    for (;;) {
      const batch: { id: string }[] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.status, 'ACTIVE'), audienceFilter, cursor ? gt(users.id, cursor) : undefined))
        .orderBy(asc(users.id))
        .limit(BATCH);
      if (!batch.length) break;
      cursor = batch[batch.length - 1].id;

      const rows = await this.db
        .insert(notifications)
        .values(batch.map((u) => ({ userId: u.id, type: 'SYSTEM', title: input.title, body: input.body, data: { broadcast: true } })))
        .returning();
      sent += rows.length;

      // realtime per user; push is sent below in bulk (skipPush avoids one HTTP call per user)
      const byUser = new Map<string, ReturnType<typeof toNotificationDto>>();
      for (const row of rows) {
        const n = toNotificationDto(row);
        byUser.set(row.userId, n);
        this.events.emit(EVENTS.notificationCreated, { userId: row.userId, notification: n, skipPush: true });
      }
      await this.push
        .sendToUsers([...byUser.keys()], (userId) => {
          const n = byUser.get(userId)!;
          return { title: n.title, body: n.body, data: notificationPushData(n) };
        })
        .catch((e) => this.log.warn(`push batch failed: ${(e as Error).message}`));

      if (batch.length < BATCH) break;
    }
    await this.audit.log(actorId, 'notification.broadcast', 'notification', null, { title: input.title, audience: input.audience, sent }, ip);
    return { sent };
  }
}
