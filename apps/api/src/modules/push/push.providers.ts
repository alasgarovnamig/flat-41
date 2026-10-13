import { Logger } from '@nestjs/common';

export interface PushMessage {
  to: string; // device push token
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushSendResult {
  /** Tokens the provider reported as permanently invalid (uninstalled app, revoked permission) → delete them. */
  invalidTokens: string[];
}

export interface PushProvider {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushSendResult>;
  /** Optional delayed delivery receipts (Expo); returns more invalid tokens. Called periodically. */
  collectReceipts?(): Promise<PushSendResult>;
}

/** Dev provider: just logs. */
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  private readonly log = new Logger('Push:console');
  async send(messages: PushMessage[]): Promise<PushSendResult> {
    for (const m of messages) this.log.log(`→ ${m.to.slice(0, 32)}… "${m.title}" ${m.body.slice(0, 60)} ${JSON.stringify(m.data)}`);
    return { invalidTokens: [] };
  }
}

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_BATCH = 100; // Expo limit per request
const RECEIPTS_BATCH = 1000; // Expo limit per request
const RECEIPT_DELAY_MS = 15 * 60_000; // receipts are reliably available after ~15 min
const RECEIPT_MAX_AGE_MS = 24 * 3_600_000; // Expo keeps receipts for 24 h
const MAX_PENDING_RECEIPTS = 100_000;

type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };
type ExpoReceipt = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

export const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[.+\]$/.test(t);

/** Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  private readonly log = new Logger('Push:expo');
  /** ticket id → token, kept in memory until the receipt has been checked (best-effort, lost on restart). */
  private readonly pending = new Map<string, { token: string; at: number }>();

  constructor(private readonly accessToken?: string, private readonly fetchFn: typeof fetch = fetch) {}

  private headers() {
    return {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const invalidTokens: string[] = [];
    const valid = messages.filter((m) => isExpoToken(m.to));
    for (let i = 0; i < valid.length; i += SEND_BATCH) {
      const batch = valid.slice(i, i + SEND_BATCH);
      try {
        const res = await this.fetchFn(EXPO_SEND_URL, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(batch.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default', priority: 'high' }))),
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: unknown[] };
        if (!res.ok || !Array.isArray(json.data)) {
          this.log.warn(`send failed: HTTP ${res.status} ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
          continue;
        }
        json.data.forEach((ticket, idx) => {
          const token = batch[idx]?.to;
          if (!token) return;
          if (ticket.status === 'ok') {
            if (this.pending.size < MAX_PENDING_RECEIPTS) this.pending.set(ticket.id, { token, at: Date.now() });
          } else if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(token);
          } else {
            this.log.warn(`ticket error for ${token.slice(0, 32)}…: ${ticket.details?.error ?? ''} ${ticket.message ?? ''}`);
          }
        });
      } catch (e) {
        this.log.warn(`send error: ${(e as Error).message}`);
      }
    }
    return { invalidTokens };
  }

  async collectReceipts(): Promise<PushSendResult> {
    const invalidTokens: string[] = [];
    const now = Date.now();
    const due: string[] = [];
    for (const [id, p] of this.pending) {
      if (now - p.at > RECEIPT_MAX_AGE_MS) this.pending.delete(id);
      else if (now - p.at >= RECEIPT_DELAY_MS) due.push(id);
    }
    for (let i = 0; i < due.length; i += RECEIPTS_BATCH) {
      const ids = due.slice(i, i + RECEIPTS_BATCH);
      try {
        const res = await this.fetchFn(EXPO_RECEIPTS_URL, { method: 'POST', headers: this.headers(), body: JSON.stringify({ ids }), signal: AbortSignal.timeout(15_000) });
        const json = (await res.json().catch(() => ({}))) as { data?: Record<string, ExpoReceipt> };
        if (!res.ok || !json.data) {
          this.log.warn(`getReceipts failed: HTTP ${res.status}`);
          continue;
        }
        for (const [id, receipt] of Object.entries(json.data)) {
          const p = this.pending.get(id);
          this.pending.delete(id);
          if (!p || receipt.status === 'ok') continue;
          if (receipt.details?.error === 'DeviceNotRegistered') invalidTokens.push(p.token);
          else this.log.warn(`receipt error for ${p.token.slice(0, 32)}…: ${receipt.details?.error ?? ''} ${receipt.message ?? ''}`);
        }
      } catch (e) {
        this.log.warn(`getReceipts error: ${(e as Error).message}`);
      }
    }
    return { invalidTokens };
  }
}
