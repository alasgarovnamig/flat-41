/**
 * Realtime client per the REALTIME contract: plain WebSocket at `ws(s)://<API host>/ws?token=<accessToken>`,
 * UTF-8 JSON frames `{ "event": "<name>", "data": <payload> }`, close code 4401 for a missing / invalid token.
 */
import WebSocket from 'ws';
import { API_URL, ASYNC_TIMEOUT_MS } from './config';

export interface Frame<T = any> { event: string; data?: T }

export interface RtClient {
  ws: WebSocket;
  frames: Frame[];
  /** Resolves with the next frame of `event` matching `pred` (also frames already received since `from`). */
  next<T = any>(event: string, pred?: (data: T) => boolean, ms?: number): Promise<T>;
  /** Frames of `event` received during the next `ms`. */
  collect<T = any>(event: string, ms: number): Promise<T[]>;
  send(event: string, data?: unknown): void;
  close(): Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
}

export const wsUrl = (token?: string) => {
  const u = new URL('/ws', API_URL.replace(/^http/, 'ws'));
  if (token !== undefined) u.searchParams.set('token', token);
  return u.toString();
};

/** Opens a socket; resolves once open (rejects on handshake failure). */
export function connect(token?: string, opts: { autoPong?: boolean } = {}): Promise<RtClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(token));
    const frames: Frame[] = [];
    const waiters = new Set<(f: Frame) => void>();
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
    ws.on('message', (raw) => {
      let f: Frame;
      try {
        f = JSON.parse(raw.toString());
      } catch {
        f = { event: '__invalid__', data: raw.toString() };
      }
      frames.push(f);
      if (f.event === 'ping' && opts.autoPong !== false) ws.send(JSON.stringify({ event: 'pong' }));
      for (const w of [...waiters]) w(f);
    });
    const client: RtClient = {
      ws,
      frames,
      closed,
      next(event, pred = () => true, ms = ASYNC_TIMEOUT_MS) {
        const seen = frames.find((f) => f.event === event && pred(f.data));
        if (seen) {
          frames.splice(frames.indexOf(seen), 1);
          return Promise.resolve(seen.data);
        }
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            waiters.delete(w);
            rej(new Error(`timeout waiting for realtime "${event}" (got: ${frames.map((f) => f.event).join(', ') || 'nothing'})`));
          }, ms);
          const w = (f: Frame) => {
            if (f.event !== event || !pred(f.data)) return;
            clearTimeout(t);
            waiters.delete(w);
            frames.splice(frames.indexOf(f), 1);
            res(f.data);
          };
          waiters.add(w);
        });
      },
      async collect(event, ms) {
        const start = frames.length;
        await new Promise((r) => setTimeout(r, ms));
        return frames.slice(start).filter((f) => f.event === event).map((f) => f.data);
      },
      send(event, data) {
        ws.send(JSON.stringify(data === undefined ? { event } : { event, data }));
      },
      async close() {
        if (ws.readyState === WebSocket.CLOSED) return;
        ws.close();
        await Promise.race([closed, new Promise((r) => setTimeout(r, 1000))]);
      },
    };
    ws.once('open', () => resolve(client));
    ws.once('error', (e) => reject(e));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`WebSocket upgrade refused: HTTP ${res.statusCode}`)));
  });
}

/** Opens a socket and waits for the server to close it (auth failure cases). */
export function connectExpectClose(token?: string, ms = ASYNC_TIMEOUT_MS): Promise<{ code: number; reason: string; opened: boolean }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(token));
    let opened = false;
    const t = setTimeout(() => {
      ws.terminate();
      reject(new Error('server did not close the unauthenticated socket'));
    }, ms);
    ws.on('open', () => (opened = true));
    ws.on('close', (code, reason) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString(), opened });
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(t);
      reject(new Error(`WebSocket upgrade refused with HTTP ${res.statusCode} (contract: accept, then close with 4401)`));
    });
    ws.on('error', () => undefined);
  });
}
