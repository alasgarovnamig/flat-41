/** Messaging REST API: conversations, messages (cursor paging), read receipts, unread counters. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { v2 } from '../src/config';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, admin, newUser, randomUuid } from '../src/fixtures';
import { anon } from '../src/http';

describe('messaging', () => {
  test('buyer starts a conversation; seller replies; unread counters and read receipts', async () => {
    const seller = await newUser('Seller Contract');
    const buyer = await newUser('Buyer Contract');
    const { listing } = await activeListing(seller);

    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: '  Salam! Hələ satılır?  ' }), D.Conversation);
    assert.equal(conv.listing.id, listing.id);
    assert.equal(conv.listing.title, listing.title);
    assert.equal(conv.listing.price, listing.price);
    assert.equal(conv.listing.status, 'ACTIVE');
    assert.deepEqual(conv.otherUser, { id: seller.id, name: 'Seller Contract', avatarUrl: null });
    assert.ok(conv.lastMessage);
    assert.equal(conv.lastMessage.body, 'Salam! Hələ satılır?', 'message is trimmed');
    assert.equal(conv.lastMessage.senderId, buyer.id);
    assert.equal(conv.lastMessage.conversationId, conv.id);
    assert.equal(conv.unreadCount, 0, 'own messages are never unread');

    // starting again re-uses the conversation
    const again = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'Ünvanı deyə bilərsiniz?' }), D.Conversation);
    assert.equal(again.id, conv.id);

    assert.deepEqual(ok(await seller.get('/conversations/unread-count')), { count: 2 });
    const sellerList = ok(await seller.get('/conversations'), D.Paginated(D.Conversation));
    assert.equal(sellerList.total, 1);
    const sc = sellerList.items[0];
    assert.equal(sc.id, conv.id);
    assert.equal(sc.otherUser.id, buyer.id);
    assert.equal(sc.unreadCount, 2);
    assert.equal(sc.lastMessage?.body, 'Ünvanı deyə bilərsiniz?');
    assert.equal(ok(await seller.get('/auth/me'), D.Me).unreadMessages, 2);

    const reply = ok(await seller.post(`/conversations/${conv.id}/messages`, { body: 'Bəli, satılır.' }), D.Message);
    assert.equal(reply.senderId, seller.id);
    assert.equal(reply.conversationId, conv.id);
    assert.equal(reply.readAt, null);

    okTrue(await seller.post(`/conversations/${conv.id}/read`));
    assert.deepEqual(ok(await seller.get('/conversations/unread-count')), { count: 0 });
    const msgs = ok(await buyer.get(`/conversations/${conv.id}/messages`), D.Message.array());
    assert.deepEqual(msgs.map((m) => m.body), ['Salam! Hələ satılır?', 'Ünvanı deyə bilərsiniz?', 'Bəli, satılır.'], 'newest last');
    assert.ok(msgs[0].readAt && msgs[1].readAt, 'buyer messages read by the seller');
    assert.equal(msgs[2].readAt, null);
    assert.deepEqual(ok(await buyer.get('/conversations/unread-count')), { count: 1 });

    const stats = ok(await seller.get(`/listings/${listing.id}/stats`), D.ListingStats);
    assert.equal(stats.messages, 2, 'listing stats count buyer messages');
  });

  test('messages cursor: ?before=<id>&limit=', async () => {
    const seller = await newUser();
    const buyer = await newUser();
    const { listing } = await activeListing(seller);
    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'm1' }), D.Conversation);
    for (const body of ['m2', 'm3', 'm4', 'm5']) ok(await buyer.post(`/conversations/${conv.id}/messages`, { body }), D.Message);
    const last2 = ok(await seller.get(`/conversations/${conv.id}/messages`, { query: { limit: 2 } }), D.Message.array());
    assert.deepEqual(last2.map((m) => m.body), ['m4', 'm5']);
    const older = ok(await seller.get(`/conversations/${conv.id}/messages`, { query: { limit: 2, before: last2[0].id } }), D.Message.array());
    assert.deepEqual(older.map((m) => m.body), ['m2', 'm3']);
    const oldest = ok(await seller.get(`/conversations/${conv.id}/messages`, { query: { before: older[0].id } }), D.Message.array());
    assert.deepEqual(oldest.map((m) => m.body), ['m1']);
    err(await seller.get(`/conversations/${conv.id}/messages`, { query: { before: randomUuid() } }), 400, 'INVALID_CURSOR');
    err(await seller.get(`/conversations/${conv.id}/messages`, { query: { limit: 500 } }), 400, 'VALIDATION_ERROR');
  });

  test('rules: no self-messaging, empty bodies, outsiders, unknown ids, blocked listings', async () => {
    const seller = await newUser();
    const buyer = await newUser();
    const { listing } = await activeListing(seller);
    err(await seller.post('/conversations', { listingId: listing.id, message: 'hi me' }), 400, 'CANNOT_MESSAGE_SELF');
    err(await buyer.post('/conversations', { listingId: listing.id, message: '   ' }), 400, ['VALIDATION_ERROR', 'MESSAGE_EMPTY']);
    err(await buyer.post('/conversations', { listingId: randomUuid(), message: 'hello' }), 404, 'NOT_FOUND');
    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'hello' }), D.Conversation);
    err(await buyer.post(`/conversations/${conv.id}/messages`, { body: '' }), 400, ['VALIDATION_ERROR', 'MESSAGE_EMPTY']);

    const outsider = await newUser();
    err(await outsider.get(`/conversations/${conv.id}/messages`), 403, 'FORBIDDEN');
    err(await outsider.post(`/conversations/${conv.id}/messages`, { body: 'hey' }), 403, 'FORBIDDEN');
    err(await outsider.post(`/conversations/${conv.id}/read`), 403, 'FORBIDDEN');
    err(await buyer.get(`/conversations/${randomUuid()}/messages`), 404, 'NOT_FOUND');
    err(await buyer.post(`/conversations/${randomUuid()}/messages`, { body: 'x' }), 404, 'NOT_FOUND');
    err(await anon().get('/conversations'), 401, 'UNAUTHORIZED');
    err(await anon().get('/conversations/unread-count'), 401, 'UNAUTHORIZED');

    ok(await (await admin()).post(`/admin/listings/${listing.id}/block`, { reason: 'Fırıldaqçılıq şübhəsi' }), D.AdminListing);
    err(await buyer.post(`/conversations/${conv.id}/messages`, { body: 'still there?' }), 403, 'LISTING_BLOCKED');
    err(await (await newUser()).post('/conversations', { listingId: listing.id, message: 'hello' }), 403, 'LISTING_BLOCKED');
  });

  test('messages to a deleted account → 410 RECIPIENT_UNAVAILABLE', async () => {
    const seller = await newUser();
    const buyer = await newUser();
    const { listing } = await activeListing(seller);
    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'hello' }), D.Conversation);
    okTrue(await seller.del('/users/me'));
    err(await buyer.post(`/conversations/${conv.id}/messages`, { body: 'are you there?' }), 410, 'RECIPIENT_UNAVAILABLE');
  });

  test('[v2] GET /conversations/:id → Conversation for participants only', v2, async () => {
    const seller = await newUser();
    const buyer = await newUser();
    const { listing } = await activeListing(seller);
    const conv = ok(await buyer.post('/conversations', { listingId: listing.id, message: 'hello there' }), D.Conversation);
    const forBuyer = ok(await buyer.get(`/conversations/${conv.id}`), D.Conversation);
    assert.equal(forBuyer.id, conv.id);
    assert.equal(forBuyer.otherUser.id, seller.id);
    const forSeller = ok(await seller.get(`/conversations/${conv.id}`), D.Conversation);
    assert.equal(forSeller.otherUser.id, buyer.id);
    assert.equal(forSeller.unreadCount, 1);
    assert.equal(forSeller.lastMessage?.body, 'hello there');
    err(await (await newUser()).get(`/conversations/${conv.id}`), 403, 'FORBIDDEN');
    err(await buyer.get(`/conversations/${randomUuid()}`), 404, 'NOT_FOUND');
  });
});
