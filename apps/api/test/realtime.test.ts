/**
 * Realtime end-to-end test (messaging + notifications over socket.io).
 * Needs a RUNNING API and its database:
 *   pnpm --filter @evtap/api build && node dist/main.js     (in apps/api, .env loaded)
 *   pnpm --filter @evtap/api test
 * Env: API_URL (default http://localhost:$PORT), DATABASE_URL (from apps/api/.env).
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { io, Socket } from 'socket.io-client';

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const BASE = `${API}/api/v1`;
// OTP endpoints are IP-throttled (5/min); a per-run fake client IP keeps repeated runs independent (API trusts 1 proxy hop).
const fakeIp = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;

async function http<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as T };
}

async function login(name: string) {
  const phone = `+99455${randomInt(1_000_000, 9_999_999)}`;
  const r = await http<{ devCode?: string }>('POST', '/auth/otp/request', undefined, { phone });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const v = await http<{ accessToken: string; user: { id: string } }>('POST', '/auth/otp/verify', undefined, { phone, code: r.json.devCode ?? '111111', name });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return { token: v.json.accessToken, id: v.json.user.id };
}

function connect(token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(API, { path: '/ws', auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, timeout: 5000 });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => { s.close(); reject(e); });
  });
}

/** Resolves with the next `event` payload matching `pred`, rejects after `ms`. */
function next<T = any>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off(event, h); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    const h = (p: T) => { if (!pred(p)) return; clearTimeout(t); s.off(event, h); resolve(p); };
    s.on(event, h);
  });
}

/** Collects every `event` payload during `ms`. */
async function collect<T = any>(s: Socket, event: string, ms: number): Promise<T[]> {
  const got: T[] = [];
  const h = (p: T) => got.push(p);
  s.on(event, h);
  await new Promise((r) => setTimeout(r, ms));
  s.off(event, h);
  return got;
}

describe('realtime messaging', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let seller: { token: string; id: string };
  let buyer: { token: string; id: string };
  let listingId: string;
  let sSeller: Socket;
  let sBuyer: Socket;
  let conversationId: string;

  before(async () => {
    seller = await login('RT Seller');
    buyer = await login('RT Buyer');
    const { rows } = await pool.query(
      `insert into listings (owner_id, deal_type, property_type, title, description, price, city_id, area, contact_name, contact_phone, status)
       values ($1, 'SALE', 'APARTMENT', 'Realtime test apartment', 'Realtime test listing description, long enough.', 99000, 'baku', 70, 'RT Seller', '+994550000000', 'ACTIVE')
       returning id`,
      [seller.id],
    );
    listingId = rows[0].id;
    [sSeller, sBuyer] = await Promise.all([connect(seller.token), connect(buyer.token)]);
  });

  after(async () => {
    sSeller?.close();
    sBuyer?.close();
    if (listingId) await pool.query('delete from listings where id = $1', [listingId]); // cascades conversations/messages
    await pool.query('delete from users where id = any($1::uuid[])', [[seller?.id, buyer?.id].filter(Boolean)]).catch(() => undefined);
    await pool.end();
  });

  it('rejects a handshake without a valid token', async () => {
    await assert.rejects(connect(), /UNAUTHORIZED/);
    await assert.rejects(connect('not-a-jwt'), /TOKEN_INVALID/);
  });

  it('delivers message:new and notification:new to the seller when a buyer starts a conversation', async () => {
    const msg = next(sSeller, 'message:new');
    const notif = next(sSeller, 'notification:new', (n) => n.type === 'NEW_MESSAGE');
    const r = await http('POST', '/conversations', buyer.token, { listingId, message: 'Salam! Mənzil hələ satılır?' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    conversationId = r.json.id;

    const m = await msg;
    assert.equal(m.conversationId, conversationId);
    assert.equal(m.senderId, buyer.id);
    assert.equal(m.body, 'Salam! Mənzil hələ satılır?');
    const n = await notif;
    assert.equal(n.data.conversationId, conversationId);
    assert.equal(n.data.listingId, listingId);
    assert.equal(n.readAt, null);
  });

  it('delivers the reply to the buyer, then throttles further NEW_MESSAGE notifications', async () => {
    const msg = next(sBuyer, 'message:new');
    const notif = next(sBuyer, 'notification:new', (n) => n.type === 'NEW_MESSAGE');
    const r = await http('POST', `/conversations/${conversationId}/messages`, seller.token, { body: 'Bəli, satılır.' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await msg).id, r.json.id);
    assert.equal((await notif).data.conversationId, conversationId);

    // second message within 10 min: realtime message yes, notification no
    const msgs = collect(sBuyer, 'message:new', 800);
    const notifs = collect(sBuyer, 'notification:new', 800);
    const r2 = await http('POST', `/conversations/${conversationId}/messages`, seller.token, { body: 'Baxmağa gələ bilərsiniz.' });
    assert.equal(r2.status, 201);
    assert.deepEqual((await msgs).map((m) => m.id), [r2.json.id]);
    assert.equal((await notifs).length, 0);
  });

  it('relays typing to the other participant only', async () => {
    const typing = next(sSeller, 'typing');
    const own = collect(sBuyer, 'typing', 500);
    sBuyer.emit('typing', { conversationId });
    assert.deepEqual(await typing, { conversationId, userId: buyer.id });
    assert.equal((await own).length, 0);
  });

  it('emits conversation:read to the sender when the recipient reads', async () => {
    const read = next(sSeller, 'conversation:read');
    const r = await http('POST', `/conversations/${conversationId}/read`, buyer.token);
    assert.equal(r.status, 200);
    const e = await read;
    assert.equal(e.conversationId, conversationId);
    assert.equal(e.readerId, buyer.id);
    assert.ok(!Number.isNaN(Date.parse(e.readAt)));
    const unread = await http('GET', '/conversations/unread-count', buyer.token);
    assert.equal(unread.json.count, 0);
  });
});
