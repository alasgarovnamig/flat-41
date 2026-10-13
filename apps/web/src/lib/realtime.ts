'use client';

/**
 * Typed realtime client over a plain WebSocket (contract: REALTIME in @evtap/shared).
 *   ws(s)://<API host>/ws?token=<accessToken>, frames `{ event, data }`, server `ping` → client `pong`.
 * - one shared connection while logged in; closed on logout
 * - reconnect with exponential back-off 1 s → 30 s (+ jitter); after a 4401 close the access token is refreshed first
 * - exposes a status store so screens can fall back to polling while the socket is not `open`
 */
import { REALTIME, type AppNotification, type Message, type Payment, type RealtimeFrame } from '@evtap/shared';
import { refreshSession } from './api';
import { API_URL } from './config';
import { tokenStore } from './tokens';

export interface ServerEvents {
  'message:new': Message & { conversationId: string };
  'conversation:read': { conversationId: string; readerId: string; readAt: string };
  'notification:new': AppNotification;
  'payment:updated': Payment;
  typing: { conversationId: string; userId: string };
  ping: null;
}
export interface ClientEvents {
  typing: { conversationId: string };
  pong: null;
}
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';
type Handler<E extends keyof ServerEvents> = (data: ServerEvents[E]) => void;

const MIN_DELAY = 1_000;
const MAX_DELAY = 30_000;
const UNAUTHORIZED = 4401;

export const wsUrl = (token: string) => {
  const u = new URL(API_URL);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = REALTIME.path;
  u.search = `?token=${encodeURIComponent(token)}`;
  return u.toString();
};

class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<keyof ServerEvents, Set<(d: unknown) => void>>();
  private statusListeners = new Set<() => void>();
  private _status: RealtimeStatus = 'idle';
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private lastTyping = new Map<string, number>();

  get status() {
    return this._status;
  }

  private setStatus(s: RealtimeStatus) {
    if (s === this._status) return;
    this._status = s;
    this.statusListeners.forEach((l) => l());
  }

  subscribeStatus = (l: () => void) => {
    this.statusListeners.add(l);
    return () => {
      this.statusListeners.delete(l);
    };
  };

  /** Start (idempotent). Connects when an access token is available. */
  start() {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    this.wanted = true;
    if (this.ws || this.timer) return;
    this.connect();
  }

  /** Stop and close (logout). */
  stop() {
    this.wanted = false;
    this.attempt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = ws.onerror = null;
      try {
        ws.close(1000, 'logout');
      } catch {
        /* ignore */
      }
    }
    this.setStatus('idle');
  }

  /** Reconnect with the current token (e.g. after a token refresh elsewhere). */
  restart() {
    const was = this.wanted;
    this.stop();
    if (was) this.start();
  }

  private connect() {
    this.timer = null;
    const token = tokenStore.access;
    if (!this.wanted || !token) {
      this.setStatus('idle');
      return;
    }
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
    };
    ws.onmessage = (e) => this.onFrame(e.data);
    ws.onerror = () => {
      /* the close event follows; nothing to do here (no console noise from our side) */
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      if (!this.wanted) return;
      if (e.code === UNAUTHORIZED) {
        // expired / invalid access token → refresh, then reconnect (a failed refresh logs the user out → stop())
        void refreshSession().then((ok) => (ok ? this.scheduleReconnect(0) : this.scheduleReconnect()));
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(delay?: number) {
    if (!this.wanted || this.timer) return;
    const base = Math.min(MAX_DELAY, MIN_DELAY * 2 ** this.attempt);
    this.attempt += 1;
    const wait = delay ?? Math.round(base * (0.8 + Math.random() * 0.4));
    this.timer = setTimeout(() => this.connect(), wait);
  }

  private onFrame(raw: unknown) {
    if (typeof raw !== 'string') return;
    let frame: RealtimeFrame;
    try {
      frame = JSON.parse(raw) as RealtimeFrame;
    } catch {
      return;
    }
    if (!frame || typeof frame.event !== 'string') return;
    if (frame.event === 'ping') {
      this.send('pong', null);
      return;
    }
    this.handlers.get(frame.event as keyof ServerEvents)?.forEach((h) => {
      try {
        h(frame.data);
      } catch {
        /* a broken listener must not kill the socket */
      }
    });
  }

  send<E extends keyof ClientEvents>(event: E, data: ClientEvents[E]) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(data === null ? { event } : { event, data }));
    return true;
  }

  /** Throttled typing indicator (≤ 1 per second per conversation). */
  typing(conversationId: string) {
    const now = Date.now();
    if (now - (this.lastTyping.get(conversationId) ?? 0) < 1000) return;
    if (this.send('typing', { conversationId })) this.lastTyping.set(conversationId, now);
  }

  on<E extends keyof ServerEvents>(event: E, h: Handler<E>) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(h as (d: unknown) => void);
    return () => {
      set!.delete(h as (d: unknown) => void);
    };
  }
}

export const realtime = new RealtimeClient();

// keep the connection in sync with the session
if (typeof window !== 'undefined') {
  let lastToken = tokenStore.access;
  tokenStore.subscribe((has) => {
    const token = tokenStore.access;
    if (!has) realtime.stop();
    else if (token !== lastToken && realtime.status !== 'idle') realtime.restart();
    lastToken = token;
  });
}
