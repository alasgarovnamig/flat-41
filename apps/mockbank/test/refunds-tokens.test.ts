import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { RunningServer } from '../src/app';
import {
  adminAuth,
  api,
  createOrder,
  getPage,
  startReceiver,
  startTestServer,
  submitCard,
  submitOtp,
  waitFor,
  type Receiver,
} from './helpers';

describe('refunds and saved-card charges', () => {
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

  async function paidOrder(extra: Record<string, unknown> = {}) {
    const { orderId } = await createOrder(srv.url, receiver, extra);
    await submitCard(srv.url, orderId, '4111111111111111', extra.saveCard ? { saveCard: '1' } : {});
    return orderId;
  }

  it('refunds partially, then the remainder, then refuses with 409', async () => {
    const orderId = await paidOrder();

    const notPaid = await createOrder(srv.url, receiver);
    assert.equal((await api(srv.url, 'POST', `/orders/${notPaid.orderId}/refund`, {})).status, 409);

    const partial = await api(srv.url, 'POST', `/orders/${orderId}/refund`, { amount: 500, reason: 'partial' });
    assert.equal(partial.status, 200);
    assert.equal(partial.json.status, 'PARTIALLY_REFUNDED');
    assert.equal(partial.json.refundedAmount, 500);
    assert.equal(partial.json.refunds.length, 1);
    assert.match(partial.json.refunds[0].id, /^rf_/);
    assert.equal(partial.json.refunds[0].amount, 500);
    assert.equal(partial.json.refunds[0].reason, 'partial');

    const tooMuch = await api(srv.url, 'POST', `/orders/${orderId}/refund`, { amount: 1001 });
    assert.equal(tooMuch.status, 409);
    const invalid = await api(srv.url, 'POST', `/orders/${orderId}/refund`, { amount: -1 });
    assert.equal(invalid.status, 400);

    const rest = await api(srv.url, 'POST', `/orders/${orderId}/refund`, {}); // default = remaining
    assert.equal(rest.status, 200);
    assert.equal(rest.json.status, 'REFUNDED');
    assert.equal(rest.json.refundedAmount, 1500);
    assert.deepEqual(rest.json.refunds.map((r: { amount: number }) => r.amount), [500, 1000]);

    const again = await api(srv.url, 'POST', `/orders/${orderId}/refund`, { amount: 1 });
    assert.equal(again.status, 409);
    assert.equal(again.json.error, 'NOT_REFUNDABLE');

    const events = await waitFor(() => {
      const hooks = hooksFor(orderId).map((h) => `${h.json.event}:${h.json.order.status}`);
      return hooks.length === 3 ? hooks : null;
    });
    assert.deepEqual(events.sort(), ['order.approved:APPROVED', 'order.refunded:PARTIALLY_REFUNDED', 'order.refunded:REFUNDED']);
  });

  it('full refund without amount on a fresh order', async () => {
    const orderId = await paidOrder();
    const res = await api(srv.url, 'POST', `/orders/${orderId}/refund`);
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'REFUNDED');
    assert.equal(res.json.refundedAmount, 1500);
  });

  it('charges a saved card token (APPROVED), idempotently', async () => {
    const orderId = await paidOrder({ saveCard: true, customer: { id: 'user-1' } });
    const token = (await api(srv.url, 'GET', `/orders/${orderId}`)).json.card.token as string;
    assert.match(token, /^tok_/);

    const merchantOrderId = crypto.randomUUID();
    const body = { amount: 2900, currency: 'AZN', merchantOrderId, description: 'Agency PRO renewal', cardToken: token, callbackUrl: receiver.url };
    const charge = await api(srv.url, 'POST', '/orders/charge-token', body);
    assert.equal(charge.status, 200);
    assert.equal(charge.json.status, 'APPROVED');
    assert.equal(charge.json.amount, 2900);
    assert.equal(charge.json.merchantOrderId, merchantOrderId);
    assert.deepEqual(charge.json.card, { mask: '411111******1111', brand: 'VISA', token });
    assert.match(charge.json.rrn, /^\d{12}$/);
    assert.ok(charge.json.paidAt);

    const replay = await api(srv.url, 'POST', '/orders/charge-token', body);
    assert.equal(replay.json.orderId, charge.json.orderId);

    const hook = await waitFor(() => hooksFor(charge.json.orderId)[0]);
    assert.equal(hook.json.event, 'order.approved');

    // A token charge can be refunded like any other order.
    const refund = await api(srv.url, 'POST', `/orders/${charge.json.orderId}/refund`, { amount: 900 });
    assert.equal(refund.json.status, 'PARTIALLY_REFUNDED');
  });

  it('declines token charges with INSUFFICIENT_FUNDS when forced in the bank admin, TOKEN_INVALID when deleted', async () => {
    const orderId = await paidOrder({ saveCard: true });
    const token = (await api(srv.url, 'GET', `/orders/${orderId}`)).json.card.token as string;

    // Toggle the flag through the admin UI (basic auth + CSRF token from the page).
    const page = await getPage(`${srv.url}/admin/tokens`, { headers: adminAuth() });
    assert.equal(page.status, 200);
    assert.match(page.html, new RegExp(token));
    const csrf = page.html.match(/name="csrf" value="([^"]+)"/)![1]!;
    const toggle = await fetch(`${srv.url}/admin/tokens/${token}/insufficient`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...adminAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, value: '1' }),
    });
    assert.equal(toggle.status, 303);

    const declined = await api(srv.url, 'POST', '/orders/charge-token', {
      amount: 2900,
      currency: 'AZN',
      merchantOrderId: crypto.randomUUID(),
      description: 'renewal',
      cardToken: token,
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.json.status, 'DECLINED');
    assert.equal(declined.json.declineCode, 'INSUFFICIENT_FUNDS');
    assert.equal(declined.json.rrn, null);

    const del = await api(srv.url, 'DELETE', `/tokens/${token}`);
    assert.deepEqual(del.json, { ok: true });
    const invalid = await api(srv.url, 'POST', '/orders/charge-token', {
      amount: 2900,
      currency: 'AZN',
      merchantOrderId: crypto.randomUUID(),
      description: 'renewal',
      cardToken: token,
    });
    assert.equal(invalid.json.status, 'DECLINED');
    assert.equal(invalid.json.declineCode, 'TOKEN_INVALID');
    assert.equal(invalid.json.card, null);
  });

  it("does not let a merchant charge another merchant's token", async () => {
    const { orderId } = await createOrder(srv.url, receiver, { saveCard: true });
    await submitCard(srv.url, orderId, '5555555555554444', { saveCard: '1' });
    await submitOtp(srv.url, orderId, '111111');
    const token = (await api(srv.url, 'GET', `/orders/${orderId}`)).json.card.token as string;
    const res = await api(
      srv.url,
      'POST',
      '/orders/charge-token',
      { amount: 100, currency: 'USD', merchantOrderId: 'x-1', description: 'x', cardToken: token },
      { merchantId: 'other', secret: 'other-secret' },
    );
    assert.equal(res.json.declineCode, 'TOKEN_INVALID');
  });
});
