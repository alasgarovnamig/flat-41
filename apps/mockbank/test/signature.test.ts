import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { RunningServer } from '../src/app';
import { sign, signatureMatches } from '../src/lib/signature';
import { api, createOrder, orderBody, startTestServer } from './helpers';

describe('merchant request signatures', () => {
  let srv: RunningServer;
  let orderId: string;

  before(async () => {
    srv = await startTestServer();
    orderId = (await createOrder(srv.url, null)).orderId;
  });
  after(() => srv.close());

  it('signs as lowercase hex HMAC_SHA256(secret, `${timestamp}.${rawBody}`)', () => {
    const expected = createHmac('sha256', 's3cret').update('1700000000000.{"a":1}').digest('hex');
    assert.equal(sign('s3cret', 1700000000000, '{"a":1}'), expected);
    assert.match(expected, /^[0-9a-f]{64}$/);
    assert.ok(signatureMatches(expected, expected.toUpperCase()));
    assert.ok(!signatureMatches(expected, expected.slice(0, 62)));
    assert.ok(!signatureMatches(expected, 'zz'));
  });

  it('accepts a correctly signed GET (empty raw body) and POST', async () => {
    const get = await api(srv.url, 'GET', `/orders/${orderId}`);
    assert.equal(get.status, 200);
    assert.equal(get.json.orderId, orderId);
    const post = await api(srv.url, 'POST', '/orders', orderBody(null));
    assert.equal(post.status, 201);
  });

  it('rejects a bad signature with 401 INVALID_SIGNATURE', async () => {
    const wrongSecret = await api(srv.url, 'GET', `/orders/${orderId}`, undefined, { secret: 'nope' });
    assert.equal(wrongSecret.status, 401);
    assert.deepEqual(wrongSecret.json.error, 'INVALID_SIGNATURE');

    const tampered = await api(srv.url, 'POST', '/orders', orderBody(null), { tamper: true });
    assert.equal(tampered.status, 401);
    assert.equal(tampered.json.error, 'INVALID_SIGNATURE');
  });

  it('rejects unknown merchants and missing headers', async () => {
    const unknown = await api(srv.url, 'GET', `/orders/${orderId}`, undefined, { merchantId: 'ghost' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error, 'INVALID_SIGNATURE');

    const res = await fetch(`${srv.url}/api/v1/orders/${orderId}`);
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'INVALID_SIGNATURE');
  });

  it('rejects timestamps older than 5 minutes (and accepts slightly old ones)', async () => {
    const expired = await api(srv.url, 'GET', `/orders/${orderId}`, undefined, { timestamp: Date.now() - 5 * 60 * 1000 - 5_000 });
    assert.equal(expired.status, 401);
    assert.equal(expired.json.error, 'INVALID_SIGNATURE');

    const fresh = await api(srv.url, 'GET', `/orders/${orderId}`, undefined, { timestamp: Date.now() - 4 * 60 * 1000 });
    assert.equal(fresh.status, 200);
  });

  it("does not expose another merchant's orders", async () => {
    const res = await api(srv.url, 'GET', `/orders/${orderId}`, undefined, { merchantId: 'other', secret: 'other-secret' });
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'ORDER_NOT_FOUND');
  });
});
