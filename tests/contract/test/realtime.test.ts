/**
 * Realtime (REALTIME in packages/shared/src/api.ts): plain WebSocket at /ws?token=, JSON frames { event, data }.
 * The whole protocol is new in the v2 contract (the NestJS backend still speaks socket.io), hence every test is [v2].
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { v2 } from '../src/config';
import * as D from '../src/dto';
import { ok, okTrue, shape } from '../src/expect';
import { activeListing, fund, newUser, sleep } from '../src/fixtures';
import { connect, connectExpectClose, type RtClient } from '../src/realtime';

describe('realtime WebSocket', () => {
  const open: RtClient[] = [];
  const conn = async (token?: string) => {
    const c = await connect(token);
    open.push(c);
    return c;
  };
  after(async () => {
    await Promise.all(open.map((c) => c.close()));
  });

  test('[v2] missing or invalid token → server closes with 4401', v2, async () => {
    const missing = await connectExpectClose(undefined);
    assert.equal(missing.code, 4401);
    const bad = await connectExpectClose('not-a-jwt');
    assert.equal(bad.code, 4401);
  });

  test('[v2] message:new + notification:new reach the seller when a buyer writes', v2, async () => {
    const seller = await newUser('RT Seller');
    const buyer = await newUser('RT Buyer');
    const { listing } = await activeListing(seller);
    const s = await conn(seller.token);
    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'Salam, realtime!' }), D.Conversation);
    const msg = shape(D.Message, await s.next('message:new'), 'message:new');
    assert.equal(msg.conversationId, conv.id);
    assert.equal(msg.senderId, buyer.id);
    assert.equal(msg.body, 'Salam, realtime!');
    const n = shape(D.AppNotification, await s.next('notification:new', (d: any) => d?.type === 'NEW_MESSAGE'), 'notification:new');
    assert.equal(n.readAt, null);
    assert.equal(n.data.conversationId, conv.id);

    // the reply reaches the buyer, never echoed to the sender
    const b = await conn(buyer.token);
    const echo = s.collect('message:new', 1000);
    const reply = ok(await seller.post(`/conversations/${conv.id}/messages`, { body: 'Bəli!' }), D.Message);
    const got = shape(D.Message, await b.next('message:new'), 'message:new');
    assert.equal(got.id, reply.id);
    assert.deepEqual(await echo, [], 'sender does not receive its own message');
  });

  test('[v2] typing is relayed to the other participant only; conversation:read reaches the sender', v2, async () => {
    const seller = await newUser();
    const buyer = await newUser();
    const { listing } = await activeListing(seller);
    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'typing test' }), D.Conversation);
    const s = await conn(seller.token);
    const b = await conn(buyer.token);
    const own = b.collect('typing', 800);
    b.send('typing', { conversationId: conv.id });
    assert.deepEqual(await s.next('typing'), { conversationId: conv.id, userId: buyer.id });
    assert.deepEqual(await own, []);

    // an outsider cannot inject typing events
    const outsider = await newUser();
    const o = await conn(outsider.token);
    const leak = s.collect('typing', 1200);
    await sleep(1100); // typing is throttled ~1/s per sender
    o.send('typing', { conversationId: conv.id });
    assert.deepEqual(await leak, []);

    okTrue(await seller.post(`/conversations/${conv.id}/read`));
    const read = await b.next<any>('conversation:read');
    assert.equal(read.conversationId, conv.id);
    assert.equal(read.readerId, seller.id);
    shape(D.isoDateTime, read.readAt, 'readAt');
  });

  test('[v2] payment:updated is pushed to the payer', v2, async () => {
    const u = await newUser();
    const { listing } = await activeListing(u);
    await fund(u, 10_000);
    const c = await conn(u.token);
    const pay = ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['BUMP_1'], method: 'WALLET' }), D.CheckoutResponse);
    const p = shape(D.Payment, await c.next('payment:updated', (d: any) => d?.id === pay.paymentId), 'payment:updated');
    assert.equal(p.status, 'SUCCEEDED');
    assert.equal(p.userId, u.id);
  });

  test('[v2] heartbeat: server sends {"event":"ping"} (≤ 25 s), the connection stays open after pong', { ...v2, timeout: 45_000 }, async () => {
    const u = await newUser();
    const c = await conn(u.token);
    await c.next('ping', () => true, 32_000); // connect() answers { event: "pong" } automatically
    await sleep(500);
    assert.equal(c.ws.readyState, c.ws.OPEN);
  });
});
