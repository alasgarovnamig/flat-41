import type { Logger } from '../lib/logger';
import type { OrderService } from './orders';
import type { WebhookService } from './webhooks';

/**
 * DB-backed background loop: due webhook retries + order expiry. All state lives in Postgres,
 * so pending retries survive restarts; `FOR UPDATE SKIP LOCKED` keeps several instances safe.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly orders: OrderService,
    private readonly webhooks: WebhookService,
    private readonly intervalMs: number,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  /** One pass (also handy in tests). */
  async tick(): Promise<void> {
    try {
      const expired = await this.orders.expireDue();
      if (expired) this.log.info('orders expired', { count: expired });
    } catch (err) {
      this.log.error('expiry pass failed', { err: String(err) });
    }
    try {
      await this.webhooks.processDue();
    } catch (err) {
      this.log.error('webhook pass failed', { err: String(err) });
    }
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = null;
        this.schedule(this.intervalMs);
      });
    }, delay);
    this.timer.unref?.();
  }
}
