import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { RunningServer } from '../src/app';
import { sign } from '../src/lib/signature';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from '../src/services/webhooks';
import { Pool } from 'pg';
import { createOrder, MERCHANT_SECRET, startReceiver, startTestServer, submitCard, TEST_DB, waitFor, type Receiver } from './helpers';

describe('webhook delivery & retries', () => {
  let srv: RunningServer;
  let receiver: Receiver;

  before(async () => {
    srv = await startTestServer({ webhookRetryScale: 0.002 }); // 5 s → 10 ms, 30 s → 60 ms, 2 min → 240 ms …
    receiver = await startReceiver();
  });
  after(async () => {
    await srv.close();
    await receiver.close();
  });

  const hooksFor = (orderId: string) => receiver.requests.filter((r) => r.json?.order?.orderId === orderId);

  it('uses the documented back-off schedule (initial + 6 retries)', () => {
    assert.deepEqual(RETRY_DELAYS_MS, [5_000, 30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
    assert.equal(MAX_ATTEMPTS, 7);
  });

  it('retries when the merchant answers 500 and logs every attempt', async () => {
    receiver.respond = (_req, i) => (i < 2 ? 500 : 200);
    const { orderId } = await createOrder(srv.url, receiver);
    await submitCard(srv.url, orderId, '4111111111111111');

    await waitFor(() => hooksFor(orderId).length >= 3, 10_000, 'third delivery attempt');
    const hooks = hooksFor(orderId);
    for (const h of hooks) {
      // Each attempt is freshly signed and carries the same body.
      assert.equal(h.headers['x-signature'], sign(MERCHANT_SECRET, String(h.headers['x-timestamp']), h.body));
      assert.equal(h.body, hooks[0]!.body);
      assert.equal(h.json.event, 'order.approved');
    }

    const delivered = await waitFor(async () => {
      const { webhooks, deliveries } = await srv.services.webhooks.listForOrder(orderId);
      return webhooks[0]?.status === 'DELIVERED' ? { webhooks, deliveries } : null;
    });
    assert.equal(delivered.webhooks[0]!.attempts, 3);
    assert.deepEqual(
      delivered.deliveries.map((d) => [d.attempt, d.responseStatus]).sort(),
      [
        [1, 500],
        [2, 500],
        [3, 200],
      ],
    );
    assert.equal(hooksFor(orderId).length, 3, 'no further attempts after success');
  });

  it('logs network errors and gives up after the last retry', async () => {
    const { orderId } = await createOrder(srv.url, null, { callbackUrl: 'http://127.0.0.1:9/unreachable' });
    // Compress the schedule further for this case.
    srv.services.config.webhookRetryScale = 0.0000005;
    try {
      await submitCard(srv.url, orderId, '4111111111111111');
      const done = await waitFor(async () => {
        const { webhooks, deliveries } = await srv.services.webhooks.listForOrder(orderId);
        return webhooks[0]?.status === 'FAILED' ? { webhooks, deliveries } : null;
      }, 15_000, 'webhook to fail permanently');
      assert.equal(done.webhooks[0]!.attempts, MAX_ATTEMPTS);
      assert.equal(done.deliveries.length, MAX_ATTEMPTS);
      assert.ok(done.deliveries.every((d) => d.responseStatus === null && d.error));
      const timeline = await srv.services.orders.timeline(orderId);
      assert.ok(timeline.some((e) => e.type === 'WEBHOOK_FAILED'));
    } finally {
      srv.services.config.webhookRetryScale = 0.002;
    }
  });

  it('pending retries survive a restart (DB-backed scheduler)', async () => {
    receiver.respond = () => 503;
    const { orderId } = await createOrder(srv.url, receiver);
    srv.services.config.webhookRetryScale = 1; // next retry in 5 s
    await submitCard(srv.url, orderId, '4111111111111111');
    assert.equal(hooksFor(orderId).length, 1);

    // Real restart on the same database; meanwhile the retry became due.
    await srv.close();
    const pool = new Pool({ connectionString: TEST_DB });
    await pool.query(`UPDATE webhooks SET next_attempt_at = now() WHERE order_id = $1`, [orderId]);
    await pool.end();
    receiver.respond = () => 200;
    srv = await startTestServer({ webhookRetryScale: 0.002 }, { keepData: true });

    await waitFor(() => hooksFor(orderId).length === 2, 5_000, 'retry after restart');
    const { webhooks } = await waitFor(async () => {
      const r = await srv.services.webhooks.listForOrder(orderId);
      return r.webhooks[0]?.status === 'DELIVERED' ? r : null;
    });
    assert.equal(webhooks[0]!.attempts, 2);
  });
});
