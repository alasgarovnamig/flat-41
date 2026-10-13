import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { RunningServer } from '../src/app';
import { sign } from '../src/lib/signature';
import {
  api,
  createOrder,
  extractNonce,
  getPage,
  MERCHANT_ID,
  MERCHANT_SECRET,
  postForm,
  startReceiver,
  startTestServer,
  submitCard,
  submitOtp,
  waitFor,
  type Receiver,
} from './helpers';

describe('hosted checkout', () => {
  let srv: RunningServer;
  let receiver: Receiver;

  before(async () => {
    srv = await startTestServer();
    receiver = await startReceiver();
  });
  beforeEach(() => {
    receiver.respond = () => 200;
  });
  after(async () => {
    await srv.close();
    await receiver.close();
  });

  const hooksFor = (orderId: string) => receiver.requests.filter((r) => r.json?.order?.orderId === orderId);

  it('renders the card form with merchant, amount, test cards and localisation', async () => {
    const { orderId } = await createOrder(srv.url, receiver, { language: 'az', saveCard: true });
    const page = await getPage(`${srv.url}/checkout/${orderId}`);
    assert.equal(page.status, 200);
    assert.match(page.html, /<html lang="az">/);
    assert.match(page.html, /EvTap/);
    assert.match(page.html, /15\.00 ₼/);
    assert.match(page.html, /Kartın nömrəsi/);
    assert.match(page.html, /name="saveCard"/);
    assert.match(page.html, /4111 1111 1111 1111/, 'test-cards table shown outside production');

    const ru = await getPage(`${srv.url}/checkout/${orderId}?lang=ru`);
    assert.match(ru.html, /Номер карты/);
    assert.match(ru.html, /action="\/checkout\/[^"]+\/pay\?lang=ru"/);

    const noSave = await createOrder(srv.url, receiver, { language: 'ru' });
    const page2 = await getPage(`${srv.url}/checkout/${noSave.orderId}`);
    assert.doesNotMatch(page2.html, /name="saveCard"/);
    assert.match(page2.html, /Номер карты/);

    const missing = await getPage(`${srv.url}/checkout/ord_nope`);
    assert.equal(missing.status, 404);
  });

  it('approves 4111… frictionless, sends a signed webhook, then redirects to returnUrl', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    const res = await submitCard(srv.url, orderId, '4111 1111 1111 1111');
    assert.equal(res.status, 303);
    assert.equal(res.location, `/checkout/${orderId}`);

    // The webhook is POSTed before the browser is sent back.
    const [hook] = hooksFor(orderId);
    assert.ok(hook, 'webhook delivered before the redirect');
    assert.equal(hook.json.event, 'order.approved');
    assert.equal(hook.headers['x-merchant-id'], MERCHANT_ID);
    const ts = String(hook.headers['x-timestamp']);
    assert.ok(Math.abs(Date.now() - Number(ts)) < 60_000);
    assert.equal(hook.headers['x-signature'], sign(MERCHANT_SECRET, ts, hook.body));
    assert.equal(hook.json.order.status, 'APPROVED');
    assert.deepEqual(hook.json.order.card, { mask: '411111******1111', brand: 'VISA', token: null });
    assert.match(hook.json.order.rrn, /^\d{12}$/);
    assert.match(hook.json.order.approvalCode, /^[A-Z0-9]{6}$/);
    assert.ok(hook.json.order.paidAt);

    const result = await getPage(`${srv.url}/checkout/${orderId}`);
    assert.equal(result.status, 200);
    assert.match(result.html, /Payment successful/);
    assert.match(result.html, /http-equiv="refresh"/);
    assert.match(result.html, new RegExp(`href="/checkout/${orderId}/return"`));

    const back = await getPage(`${srv.url}/checkout/${orderId}/return`);
    assert.equal(back.status, 302);
    const merchantOrderId = hook.json.order.merchantOrderId;
    assert.equal(
      back.location,
      `https://evtap.test/api/v1/payments/return/mockbank?paymentId=p1&orderId=${orderId}&merchantOrderId=${merchantOrderId}&status=APPROVED`,
    );

    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'APPROVED');

    // The page can't be paid twice.
    const again = await postForm(`${srv.url}/checkout/${orderId}/pay`, { nonce: 'x', number: '4111111111111111' });
    assert.equal(again.status, 303);
    assert.equal(hooksFor(orderId).length, 1);
  });

  it('approves 4242… frictionless and uses "?" when returnUrl has no query', async () => {
    const { orderId } = await createOrder(srv.url, receiver, { returnUrl: 'https://shop.test/done' });
    await submitCard(srv.url, orderId, '4242424242424242');
    const back = await getPage(`${srv.url}/checkout/${orderId}/return`);
    assert.match(back.location!, /^https:\/\/shop\.test\/done\?orderId=ord_[0-9a-f]+&merchantOrderId=[^&]+&status=APPROVED$/);
  });

  it('runs 3-D Secure for 5555… and approves with OTP 111111, saving the card when asked', async () => {
    const { orderId } = await createOrder(srv.url, receiver, { saveCard: true, customer: { id: 'u1', phone: '+994501234567' } });
    const res = await submitCard(srv.url, orderId, '5555555555554444', { saveCard: '1' });
    assert.equal(res.status, 303);
    assert.equal(res.location, `/checkout/${orderId}/3ds`);

    const mid = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(mid.json.status, 'PROCESSING');
    assert.equal(hooksFor(orderId).length, 0);

    const acs = await getPage(`${srv.url}/checkout/${orderId}/3ds`);
    assert.match(acs.html, /Mock Bank 3-D Secure/);
    assert.match(acs.html, /Test OTP: 111111/);
    assert.match(acs.html, /\+994 \*\* \*\*\* 45 67/);

    const ok = await submitOtp(srv.url, orderId, '111111');
    assert.equal(ok.status, 303);
    assert.equal(ok.location, `/checkout/${orderId}`);
    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'APPROVED');
    assert.equal(order.json.card.brand, 'MASTERCARD');
    assert.equal(order.json.card.mask, '555555******4444');
    assert.match(order.json.card.token, /^tok_[0-9a-f]+$/);
    const [hook] = hooksFor(orderId);
    assert.equal(hook!.json.event, 'order.approved');
    assert.equal(hook!.json.order.card.token, order.json.card.token);
  });

  it('does not save the card when the customer unticks the box', async () => {
    const { orderId } = await createOrder(srv.url, receiver, { saveCard: true });
    await submitCard(srv.url, orderId, '4111111111111111');
    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'APPROVED');
    assert.equal(order.json.card.token, null);
  });

  it('sends unknown Luhn-valid cards through 3-D Secure (4000…3220 too)', async () => {
    for (const pan of ['4000000000003220', '4012888888881881']) {
      const { orderId } = await createOrder(srv.url, receiver);
      const res = await submitCard(srv.url, orderId, pan);
      assert.equal(res.location, `/checkout/${orderId}/3ds`, pan);
      await submitOtp(srv.url, orderId, '111111');
      assert.equal((await api(srv.url, 'GET', `/orders/${orderId}`)).json.status, 'APPROVED');
    }
  });

  it('declines the decline test cards with the right codes', async () => {
    const cases = {
      '4000000000000002': 'DO_NOT_HONOR',
      '4000000000009995': 'INSUFFICIENT_FUNDS',
      '4000000000000069': 'EXPIRED_CARD',
      '4000000000000119': 'PROCESSING_ERROR',
    };
    for (const [pan, code] of Object.entries(cases)) {
      const { orderId } = await createOrder(srv.url, receiver);
      const res = await submitCard(srv.url, orderId, pan);
      assert.equal(res.location, `/checkout/${orderId}`);
      const order = await api(srv.url, 'GET', `/orders/${orderId}`);
      assert.equal(order.json.status, 'DECLINED', pan);
      assert.equal(order.json.declineCode, code, pan);
      assert.ok(order.json.declineReason);
      assert.equal(order.json.rrn, null);
      const [hook] = hooksFor(orderId);
      assert.equal(hook!.json.event, 'order.declined');
      assert.equal(hook!.json.order.declineCode, code);

      const page = await getPage(`${srv.url}/checkout/${orderId}`);
      assert.match(page.html, /Payment declined/);
      const back = await getPage(`${srv.url}/checkout/${orderId}/return`);
      assert.match(back.location!, /&status=DECLINED$/);
    }
  });

  it('declines with 3DS_FAILED after 3 wrong OTPs', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    await submitCard(srv.url, orderId, '5555555555554444');
    const first = await submitOtp(srv.url, orderId, '000000');
    assert.equal(first.status, 422);
    assert.match(first.html, /Attempts left: 2/);
    const second = await submitOtp(srv.url, orderId, '123456');
    assert.match(second.html, /Attempts left: 1/);
    assert.equal(hooksFor(orderId).length, 0);
    const third = await submitOtp(srv.url, orderId, '999999');
    assert.equal(third.status, 303);
    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'DECLINED');
    assert.equal(order.json.declineCode, '3DS_FAILED');
    assert.equal(hooksFor(orderId)[0]!.json.event, 'order.declined');
  });

  it('re-renders the form for invalid input instead of declining', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    const bad = await submitCard(srv.url, orderId, '4111111111111112', { expiry: '01/20', cvv: '12', holder: '' });
    assert.equal(bad.status, 422);
    assert.match(bad.html, /Enter a valid card number/);
    assert.match(bad.html, /This card has expired/);
    assert.match(bad.html, /Enter the 3-digit security code/);
    assert.match(bad.html, /Enter the name as shown on the card/);
    assert.doesNotMatch(bad.html, /name="cvv"[^>]*value=/, 'CVV is never echoed back');
    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'CREATED');
    assert.equal(order.json.card, null);
  });

  it('rejects a form post with a wrong nonce', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    const res = await postForm(`${srv.url}/checkout/${orderId}/pay`, {
      nonce: 'forged',
      number: '4111111111111111',
      expiry: '12/40',
      cvv: '123',
      holder: 'A B',
    });
    assert.equal(res.status, 403);
    assert.equal((await api(srv.url, 'GET', `/orders/${orderId}`)).json.status, 'CREATED');
  });

  it('Cancel button → CANCELLED, webhook, 302 back with status=CANCELLED', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    const page = await getPage(`${srv.url}/checkout/${orderId}`);
    const res = await postForm(`${srv.url}/checkout/${orderId}/cancel`, { nonce: extractNonce(page.html) });
    assert.equal(res.status, 302);
    assert.match(res.location!, /^https:\/\/evtap\.test\/.*\?paymentId=p1&orderId=ord_\w+&merchantOrderId=.+&status=CANCELLED$/);
    const hook = await waitFor(() => hooksFor(orderId)[0]);
    assert.equal(hook.json.event, 'order.cancelled');
  });

  it('cancelling the 3-D Secure step declines with 3DS_FAILED', async () => {
    const { orderId } = await createOrder(srv.url, receiver);
    await submitCard(srv.url, orderId, '5555555555554444');
    const acs = await getPage(`${srv.url}/checkout/${orderId}/3ds`);
    const res = await postForm(`${srv.url}/checkout/${orderId}/3ds/cancel`, { nonce: extractNonce(acs.html) });
    assert.equal(res.status, 303);
    const order = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(order.json.status, 'DECLINED');
    assert.equal(order.json.declineCode, '3DS_FAILED');
  });
});
