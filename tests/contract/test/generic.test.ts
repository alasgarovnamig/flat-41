/** Cross-cutting rules: error shape (401 / 404 / 400 VALIDATION_ERROR), pagination envelope, base path. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as D from '../src/dto';
import { err, ok, shape } from '../src/expect';
import { newUser, randomUuid } from '../src/fixtures';
import { anon } from '../src/http';

describe('generic contract rules', () => {
  test('401: protected endpoint without a token → UNAUTHORIZED', async () => {
    for (const path of ['/auth/me', '/wallet', '/favorites', '/me/listings', '/notifications']) {
      err(await anon().get(path), 401, 'UNAUTHORIZED');
    }
  });

  test('401: malformed / forged bearer token is rejected', async () => {
    const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    for (const token of ['not-a-jwt', forged]) {
      const res = await anon().get('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      err(res, 401, ['TOKEN_INVALID', 'UNAUTHORIZED']);
    }
  });

  test('public endpoints ignore a missing token but still answer', async () => {
    ok(await anon().get('/listings', { query: { pageSize: 1 } }), D.Paginated(D.ListingCard));
  });

  test('404: unknown resource id → NOT_FOUND with ApiError shape', async () => {
    err(await anon().get(`/listings/${randomUuid()}`), 404, 'NOT_FOUND');
    err(await anon().get(`/users/${randomUuid()}`), 404, 'NOT_FOUND');
    err(await anon().get('/agencies/no-such-agency-slug-contract'), 404, 'NOT_FOUND');
  });

  test('404: unknown route answers 404 with an ApiError body', async () => {
    const res = await anon().get('/no-such-route-contract');
    assert.equal(res.status, 404);
    const body = shape(D.ApiError, res.body);
    assert.equal(body.statusCode, 404);
  });

  test('malformed ids in the path → 400 or 404 ApiError, never 5xx', async () => {
    const u = await newUser();
    const paths: [string, string][] = [
      ['GET', '/listings/not-a-uuid'], ['GET', '/users/not-a-uuid'], ['GET', '/bookings/not-a-uuid'], ['GET', '/payments/not-a-uuid'],
      ['GET', '/conversations/not-a-uuid/messages'], ['POST', '/notifications/not-a-uuid/read'], ['POST', '/favorites/not-a-uuid'],
      ['DELETE', '/saved-searches/not-a-uuid'], ['POST', '/listings/not-a-uuid/apply-credit'],
    ];
    for (const [method, path] of paths) {
      const res = await u.call(method, path, method === 'POST' ? { body: { credit: 'BUMP' } } : {});
      assert.ok([400, 404].includes(res.status), `${method} ${path} → HTTP ${res.status} ${res.text.slice(0, 200)}`);
      err(res, res.status, res.status === 404 ? 'NOT_FOUND' : undefined);
    }
  });

  test('400: request validation errors use code VALIDATION_ERROR', async () => {
    err(await anon().post('/auth/otp/request', { phone: '12345' }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/auth/otp/request', {}), 400, 'VALIDATION_ERROR');
    err(await anon().get('/listings', { query: { pageSize: 1000 } }), 400, 'VALIDATION_ERROR');
    err(await anon().get('/listings', { query: { sort: 'bogus' } }), 400, 'VALIDATION_ERROR');
    const u = await newUser();
    err(await u.post('/listings', { title: 'x' }), 400, 'VALIDATION_ERROR');
    err(await u.get('/notifications', { query: { page: 0 } }), 400, 'VALIDATION_ERROR');
  });

  test('pagination envelope: { items, total, page, pageSize } echoes the query and applies defaults', async () => {
    const def = ok(await anon().get('/listings'), D.Paginated(D.ListingCard));
    assert.equal(def.page, 1);
    assert.equal(def.pageSize, 24, 'listing search default pageSize = 24 (listingSearchSchema)');
    assert.ok(def.items.length <= 24);

    const p2 = ok(await anon().get('/listings', { query: { page: 2, pageSize: 3 } }), D.Paginated(D.ListingCard));
    assert.equal(p2.page, 2);
    assert.equal(p2.pageSize, 3);
    assert.ok(p2.items.length <= 3);
    assert.ok(p2.total >= 0); // other tests publish listings concurrently, so totals of two calls may differ

    const agencies = ok(await anon().get('/agencies'), D.Paginated(D.Agency));
    assert.equal(agencies.page, 1);
    assert.equal(agencies.pageSize, 20, 'generic pagination default pageSize = 20 (paginationSchema)');

    const u = await newUser();
    const empty = ok(await u.get('/payments', { query: { page: 3, pageSize: 7 } }), D.Paginated(D.Payment));
    assert.deepEqual({ items: empty.items, total: empty.total, page: empty.page, pageSize: empty.pageSize }, { items: [], total: 0, page: 3, pageSize: 7 });
    err(await u.get('/payments', { query: { pageSize: 101 } }), 400, 'VALIDATION_ERROR');
  });
});
