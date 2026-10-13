import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { RunningServer } from '../src/app';
import { adminAuth, api, createOrder, getPage, startReceiver, startTestServer, submitCard, waitFor, type Receiver } from './helpers';

describe('order expiry', () => {
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

  const hooksFor = (orderId: string) => receiver.requests.filter((r) => r.json?.order?.orderId === orderId);

  it('expires unpaid orders after their 30-minute window and sends order.expired', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    const processing = await createOrder(srv.url, receiver);
    await submitCard(srv.url, processing.orderId, '5555555555554444'); // stuck in 3-D Secure
    const paid = await createOrder(srv.url, receiver);
    await submitCard(srv.url, paid.orderId, '4111111111111111');

    await srv.services.db.query(`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = ANY($1)`, [
      [orderId, processing.orderId, paid.orderId],
    ]);

    const hook = await waitFor(() => hooksFor(orderId)[0], 5_000, 'order.expired webhook');
    assert.equal(hook.json.event, 'order.expired');
    assert.equal(hook.json.order.status, 'EXPIRED');
    await waitFor(() => hooksFor(processing.orderId)[0], 5_000, 'expired PROCESSING order');

    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'EXPIRED');
    assert.equal((await api(srv.url, 'GET', `/orders/${processing.orderId}`)).json.status, 'EXPIRED');
    assert.equal((await api(srv.url, 'GET', `/orders/${paid.orderId}`)).json.status, 'APPROVED', 'paid orders never expire');

    const page = await getPage(`${srv.url}/checkout/${orderId}`);
    assert.match(page.html, /Payment session expired/);
    const back = await getPage(`${srv.url}/checkout/${orderId}/return`);
    assert.match(back.location!, /&status=CANCELLED$/);
  });

  it('expires on access even before the scheduler runs', async () => {
    await srv.services.scheduler.stop();
    try {
      const { orderId } = await createOrder(srv.url, receiver);
      await srv.services.db.query(`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1`, [orderId]);
      const page = await getPage(`${srv.url}/checkout/${orderId}`);
      assert.equal(page.status, 200);
      assert.match(page.html, /Payment session expired/);
      assert.equal(hooksFor(orderId)[0]?.json.event, 'order.expired');
    } finally {
      srv.services.scheduler.start();
    }
  });
});

describe('bank admin', () => {
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

  it('requires basic auth', async () => {
    const res = await fetch(`${srv.url}/admin/orders`);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /Basic/);
    const wrong = await fetch(`${srv.url}/admin/orders`, { headers: adminAuth('admin', 'nope') });
    assert.equal(wrong.status, 401);
  });

  it('lists, filters and shows orders; resends webhooks; refunds; rejects missing CSRF', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    await submitCard(srv.url, orderId, '4111111111111111');
    const other = await createOrder(srv.url, receiver);

    const list = await getPage(`${srv.url}/admin/orders?status=APPROVED`, { headers: adminAuth() });
    assert.equal(list.status, 200);
    assert.match(list.html, new RegExp(orderId));
    assert.doesNotMatch(list.html, new RegExp(other.orderId));
    const search = await getPage(`${srv.url}/admin/orders?q=${other.orderId.slice(4, 14)}`, { headers: adminAuth() });
    assert.match(search.html, new RegExp(other.orderId));

    const detail = await getPage(`${srv.url}/admin/orders/${orderId}`, { headers: adminAuth() });
    assert.equal(detail.status, 200);
    assert.match(detail.html, /Delivery attempts/);
    assert.match(detail.html, /HTTP 200/);
    assert.match(detail.html, /APPROVED/);
    const csrf = detail.html.match(/name="csrf" value="([^"]+)"/)![1]!;

    const post = (path: string, fields: Record<string, string>) =>
      fetch(`${srv.url}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...adminAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });

    assert.equal((await post(`/admin/orders/${orderId}/resend`, {})).status, 403, 'CSRF token required');

    const before = receiver.requests.length;
    const resend = await post(`/admin/orders/${orderId}/resend`, { csrf });
    assert.equal(resend.status, 303);
    assert.equal(receiver.requests.length, before + 1);
    assert.equal(receiver.requests.at(-1)!.json.event, 'order.approved');

    const refund = await post(`/admin/orders/${orderId}/refund`, { csrf, amount: '5.00', reason: 'goodwill' });
    assert.equal(refund.status, 303);
    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'PARTIALLY_REFUNDED');
    assert.equal(order.json.refundedAmount, 500);
    assert.equal(receiver.requests.at(-1)!.json.event, 'order.refunded');

    const merchants = await getPage(`${srv.url}/admin/merchants`, { headers: adminAuth() });
    assert.match(merchants.html, /Other Shop/);
    assert.doesNotMatch(merchants.html, /test-secret/, 'secrets are masked');
  });
});
