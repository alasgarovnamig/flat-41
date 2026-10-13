import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import type { AppNotification, Message, Payment } from '@evtap/shared';
import { REALTIME } from '@evtap/shared';
import type { Server, Socket } from 'socket.io';
import { config } from '../../config';
import { EVENTS } from '../notifications/notifications.service';
import { MessagingService } from '../messaging/messaging.service';

export const userRoom = (userId: string) => `user:${userId}`;

interface SocketData { userId: string; role: string; typingAt?: Map<string, number> }
type AuthedSocket = Socket & { data: SocketData };

const TYPING_MIN_INTERVAL_MS = 1000;
const PARTICIPANTS_TTL_MS = 5 * 60_000;
const PARTICIPANTS_CACHE_MAX = 10_000;

/**
 * socket.io at `${API_URL}` path `/ws` (see REALTIME in @evtap/shared).
 * Handshake: `io(API_URL, { path: '/ws', auth: { token: accessToken } })` → unauthenticated
 * connections are rejected with `connect_error` ("UNAUTHORIZED"). Each socket joins `user:<id>`.
 * Server → client events are fanned out from in-process domain EVENTS (see NotificationsService).
 */
@SkipThrottle()
@WebSocketGateway({
  path: REALTIME.path,
  cors: { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server: Server;
  /** conversationId → participants (cached for typing relays). */
  private readonly participants = new Map<string, { ids: [string, string]; at: number }>();

  constructor(private readonly jwt: JwtService, private readonly messaging: MessagingService) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      const raw = (socket.handshake.auth?.token as string | undefined) ?? (socket.handshake.headers.authorization as string | undefined);
      const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
      if (!token) return next(new Error('UNAUTHORIZED'));
      try {
        const p = this.jwt.verify<{ sub: string; role: string }>(token, { secret: config.jwt.accessSecret });
        (socket.data as SocketData).userId = p.sub;
        (socket.data as SocketData).role = p.role;
        next();
      } catch {
        next(new Error('TOKEN_INVALID'));
      }
    });
  }

  async handleConnection(client: AuthedSocket) {
    if (!client.data.userId) return client.disconnect(true);
    await client.join(userRoom(client.data.userId));
  }

  // ───────── client → server ─────────

  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { conversationId?: unknown }) {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    const userId = client.data.userId;
    if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) return;
    // throttle per socket + conversation
    const seen = (client.data.typingAt ??= new Map());
    const now = Date.now();
    if (now - (seen.get(conversationId) ?? 0) < TYPING_MIN_INTERVAL_MS) return;
    seen.set(conversationId, now);

    const ids = await this.getParticipants(conversationId);
    if (!ids || !ids.includes(userId)) return;
    const other = ids[0] === userId ? ids[1] : ids[0];
    this.server.to(userRoom(other)).emit('typing', { conversationId, userId });
  }

  private async getParticipants(conversationId: string): Promise<[string, string] | null> {
    const hit = this.participants.get(conversationId);
    if (hit && Date.now() - hit.at < PARTICIPANTS_TTL_MS) return hit.ids;
    const p = await this.messaging.participants(conversationId);
    if (!p) return null;
    if (this.participants.size >= PARTICIPANTS_CACHE_MAX) this.participants.clear();
    const ids: [string, string] = [p.buyerId, p.sellerId];
    this.participants.set(conversationId, { ids, at: Date.now() });
    return ids;
  }

  // ───────── domain events → clients ─────────

  @OnEvent(EVENTS.notificationCreated)
  onNotification(e: { userId: string; notification: AppNotification }) {
    this.server?.to(userRoom(e.userId)).emit('notification:new', e.notification);
  }

  @OnEvent(EVENTS.messageCreated)
  onMessage(e: { recipientId: string; message: Message }) {
    this.server?.to(userRoom(e.recipientId)).emit('message:new', e.message);
  }

  @OnEvent(EVENTS.conversationRead)
  onRead(e: { recipientId: string; conversationId: string; readerId: string; readAt: string }) {
    this.server?.to(userRoom(e.recipientId)).emit('conversation:read', { conversationId: e.conversationId, readerId: e.readerId, readAt: e.readAt });
  }

  @OnEvent(EVENTS.paymentUpdated)
  onPayment(e: { userId: string; payment: Payment }) {
    this.server?.to(userRoom(e.userId)).emit('payment:updated', e.payment);
  }
}
