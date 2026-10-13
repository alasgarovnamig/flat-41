import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { RunningServer } from '../src/app';
import { api, orderBody, startReceiver, startTestServer, waitFor, type Receiver } from './helpers';

describe('merchant API: orders', () => {
  let srv: RunningServer;
  let receiver: Receiver;

  before(async () => {
    srv = await startTestServer();
    receiver = await startReceiver();
  });
  after(async () => {
    await srv.close();
    await receiver.close();
  });

  it('creates an order (201 { orderId, status, paymentUrl, expiresAt })', async () => {
    const body = orderBody(receiver);
    const res = await api(srv.url, 'POST', '/orders', body);
    assert.equal(res.status, 201);
    assert.match(res.json.orderId, /^ord_[0-9a-f]+$/);
    assert.equal(res.json.status, 'CREATED');
    assert.equal(res.json.paymentUrl, `${srv.url}/checkout/${res.json.orderId}`);
    const ttl = new Date(res.json.expiresAt).getTime() - Date.now();
    assert.ok(ttl > 29 * 60_000 && ttl <= 30 * 60_000, `expiresAt ~30 min ahead (got ${ttl} ms)`);
    assert.deepEqual(Object.keys(res.json).sort(), ['expiresAt', 'orderId', 'paymentUrl', 'status']);

    const get = await api(srv.url, 'GET', `/orders/${res.json.orderId}`);
    assert.equal(get.status, 200);
    assert.deepEqual(get.json, {
      orderId: res.json.orderId,
      merchantOrderId: body.merchantOrderId,
      amount: 1500,
      currency: 'AZN',
      description: 'VIP (7 gün)',
      status: 'CREATED',
      refundedAmount: 0,
      card: null,
      declineCode: null,
      declineReason: null,
      rrn: null,
      approvalCode: null,
      refunds: [],
      createdAt: get.json.createdAt,
      updatedAt: get.json.updatedAt,
      paidAt: null,
      expiresAt: res.json.expiresAt,
    });
  });

  it('is idempotent on merchantOrderId', async () => {
    const body = orderBody(receiver);
    const first = await api(srv.url, 'POST', '/orders', body);
    const second = await api(srv.url, 'POST', '/orders', { ...body, amount: 999 });
    const parallel = await Promise.all([1, 2, 3].map(() => api(srv.url, 'POST', '/orders', body)));
    assert.equal(first.status, 201);
    assert.equal(second.json.orderId, first.json.orderId);
    for (const p of parallel) assert.equal(p.json.orderId, first.json.orderId);
    const get = await api(srv.url, 'GET', `/orders/${first.json.orderId}`);
    assert.equal(get.json.amount, 1500, 'the original order is returned unchanged');

    // Concurrent first-time creation also yields a single order.
    const fresh = orderBody(receiver);
    const racing = await Promise.all([1, 2, 3, 4].map(() => api(srv.url, 'POST', '/orders', fresh)));
    assert.equal(new Set(racing.map((r) => r.json.orderId)).size, 1);
  });

  it('validates input', async () => {
    const cases: Record<string, unknown>[] = [
      { amount: 0 },
      { amount: -5 },
      { amount: 10.5 },
      { amount: '1500' },
      { currency: 'RUB' },
      { returnUrl: 'not a url' },
      { returnUrl: 'javascript:alert(1)' },
      { callbackUrl: 'ftp://example.com/x' },
      { merchantOrderId: '' },
      { language: 'de' },
      { saveCard: 'yes' },
    ];
    for (const extra of cases) {
      const res = await api(srv.url, 'POST', '/orders', orderBody(receiver, extra));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(extra)}`);
      assert.equal(res.json.error, 'VALIDATION_ERROR');
    }
    const ok = await api(srv.url, 'POST', '/orders', orderBody(receiver, { returnUrl: 'evtap://payment/result', currency: 'GEL', saveCard: true }));
    assert.equal(ok.status, 201);
  });

  it('returns 404 for unknown orders', async () => {
    const res = await api(srv.url, 'GET', '/orders/ord_doesnotexist');
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'ORDER_NOT_FOUND');
  });

  it('cancels only CREATED orders and sends order.cancelled', async () => {
    const created = await api(srv.url, 'POST', '/orders', orderBody(receiver));
    const id = created.json.orderId as string;
    const cancel = await api(srv.url, 'POST', `/orders/${id}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json.status, 'CANCELLED');

    const again = await api(srv.url, 'POST', `/orders/${id}/cancel`);
    assert.equal(again.status, 409);

    const hook = await waitFor(() => receiver.requests.find((r) => r.json?.order?.orderId === id), 5000, 'cancel webhook');
    assert.equal(hook.json.event, 'order.cancelled');
    assert.equal(hook.json.order.status, 'CANCELLED');

    const refund = await api(srv.url, 'POST', `/orders/${id}/refund`, {});
    assert.equal(refund.status, 409);
  });

  it('DELETE /tokens/:cardToken answers { ok: true }', async () => {
    const res = await api(srv.url, 'DELETE', '/tokens/tok_unknown');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  });

  it('GET /health', async () => {
    const res = await fetch(`${srv.url}/health`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { status: string }).status, 'ok');
  });
});
