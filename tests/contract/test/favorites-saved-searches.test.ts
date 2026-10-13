/** Favorites and saved searches. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { v2 } from '../src/config';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, newUser, randomUuid } from '../src/fixtures';
import { anon } from '../src/http';

describe('favorites', () => {
  test('add (idempotent) → ids / list / isFavorite / favoritesCount → remove', async () => {
    const owner = await newUser();
    const { listing: a } = await activeListing(owner);
    const { listing: b } = await activeListing(owner);
    const u = await newUser();
    okTrue(await u.post(`/favorites/${a.id}`));
    okTrue(await u.post(`/favorites/${b.id}`));
    okTrue(await u.post(`/favorites/${a.id}`)); // idempotent

    const favIds = ok(await u.get('/favorites/ids'), D.id.array());
    assert.deepEqual([...favIds].sort(), [a.id, b.id].sort());
    const page = ok(await u.get('/favorites'), D.Paginated(D.ListingCard));
    assert.equal(page.total, 2);
    assert.deepEqual(page.items.map((c) => c.id).sort(), [a.id, b.id].sort());
    const one = ok(await u.get('/favorites', { query: { pageSize: 1 } }), D.Paginated(D.ListingCard));
    assert.equal(one.items.length, 1);
    assert.equal(one.total, 2);

    const d = ok(await u.get(`/listings/${a.id}`), D.ListingDetail);
    assert.equal(d.isFavorite, true);
    assert.equal(d.favoritesCount, 1, 'adding twice counts once');
    const stats = ok(await owner.get(`/listings/${a.id}/stats`), D.ListingStats);
    assert.equal(stats.favorites, 1);

    okTrue(await u.del(`/favorites/${a.id}`));
    okTrue(await u.del(`/favorites/${a.id}`)); // removing again is harmless
    assert.deepEqual(ok(await u.get('/favorites/ids'), D.id.array()), [b.id]);
    const d2 = ok(await u.get(`/listings/${a.id}`), D.ListingDetail);
    assert.equal(d2.isFavorite, false);
    assert.equal(d2.favoritesCount, 0);
  });

  test('unknown listing → 404; anonymous → 401', async () => {
    const u = await newUser();
    err(await u.post(`/favorites/${randomUuid()}`), 404, 'NOT_FOUND');
    err(await anon().get('/favorites'), 401, 'UNAUTHORIZED');
    err(await anon().get('/favorites/ids'), 401, 'UNAUTHORIZED');
    err(await anon().post(`/favorites/${randomUuid()}`), 401, 'UNAUTHORIZED');
  });
});

describe('saved searches', () => {
  test('create → list → delete; query is kept as given', async () => {
    const u = await newUser();
    const query = { dealType: 'SALE', cityId: 'baku', rooms: '2,3', priceMax: 200000 };
    const s = ok(await u.post('/saved-searches', { name: 'Bakı 2-3 otaq', query }), D.SavedSearch);
    assert.equal(s.name, 'Bakı 2-3 otaq');
    assert.equal(s.notify, true, 'notify defaults to true');
    assert.equal(s.newMatches, 0);
    for (const [k, v] of Object.entries(query)) assert.equal(String(s.query[k]), String(v), `query.${k}`);
    const quiet = ok(await u.post('/saved-searches', { name: 'Quiet', query: { dealType: 'RENT_DAILY' }, notify: false }), D.SavedSearch);
    assert.equal(quiet.notify, false);

    const list = ok(await u.get('/saved-searches'), D.SavedSearch.array());
    assert.deepEqual(list.map((x) => x.id).sort(), [s.id, quiet.id].sort());
    assert.deepEqual(ok(await (await newUser()).get('/saved-searches'), D.SavedSearch.array()), [], 'per user');

    err(await (await newUser()).del(`/saved-searches/${s.id}`), 404, 'NOT_FOUND');
    okTrue(await u.del(`/saved-searches/${s.id}`));
    err(await u.del(`/saved-searches/${s.id}`), 404, 'NOT_FOUND');
    assert.deepEqual(ok(await u.get('/saved-searches'), D.SavedSearch.array()).map((x) => x.id), [quiet.id]);
  });

  test('validation: empty name, query must be a valid listing search', async () => {
    const u = await newUser();
    err(await u.post('/saved-searches', { name: '', query: {} }), 400, 'VALIDATION_ERROR');
    err(await u.post('/saved-searches', { name: 'Bad', query: { dealType: 'BARTER' } }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/saved-searches', { name: 'x', query: {} }), 401, 'UNAUTHORIZED');
  });

  test('[v2] PATCH /saved-searches/:id updates name / notify', v2, async () => {
    const u = await newUser();
    const s = ok(await u.post('/saved-searches', { name: 'Original', query: { cityId: 'baku' } }), D.SavedSearch);
    const renamed = ok(await u.patch(`/saved-searches/${s.id}`, { name: 'Renamed' }), D.SavedSearch);
    assert.equal(renamed.name, 'Renamed');
    assert.equal(renamed.notify, true);
    const muted = ok(await u.patch(`/saved-searches/${s.id}`, { notify: false }), D.SavedSearch);
    assert.equal(muted.notify, false);
    assert.equal(muted.name, 'Renamed');
    assert.deepEqual(muted.query, s.query, 'query untouched');
    err(await (await newUser()).patch(`/saved-searches/${s.id}`, { name: 'Hijack' }), 404, 'NOT_FOUND');
    err(await u.patch(`/saved-searches/${s.id}`, { name: '' }), 400, 'VALIDATION_ERROR');
  });
});
