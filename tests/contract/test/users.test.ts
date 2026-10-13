/** Users: profile update, password, push tokens, public profile, account deletion. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { activeListing, newPasswordUser, newUser, randomEmail, randomUuid, uniq } from '../src/fixtures';
import { Api, anon } from '../src/http';

describe('users', () => {
  test('PATCH /users/me updates name, e-mail (lower-cased, unverified), avatar and locale', async () => {
    const u = await newUser();
    const email = randomEmail();
    const user = ok(
      await u.patch('/users/me', { name: 'Renamed Contract', email: email.toUpperCase(), avatarUrl: 'https://cdn.example.test/a.png', locale: 'ru' }),
      D.User,
    );
    assert.equal(user.id, u.id);
    assert.equal(user.name, 'Renamed Contract');
    assert.equal(user.email, email);
    assert.equal(user.isEmailVerified, false);
    assert.equal(user.avatarUrl, 'https://cdn.example.test/a.png');
    assert.equal(user.locale, 'ru');
    // partial update keeps other fields; null clears the avatar
    const again = ok(await u.patch('/users/me', { avatarUrl: null }), D.User);
    assert.equal(again.name, 'Renamed Contract');
    assert.equal(again.avatarUrl, null);
    const me = ok(await u.get('/auth/me'), D.Me);
    assert.equal(me.locale, 'ru');
  });

  test('PATCH /users/me with another account\'s e-mail → 409 EMAIL_TAKEN; invalid values → 400', async () => {
    const other = await newPasswordUser();
    const u = await newUser();
    err(await u.patch('/users/me', { email: other.email }), 409, 'EMAIL_TAKEN');
    err(await u.patch('/users/me', { locale: 'de' }), 400, 'VALIDATION_ERROR');
    err(await u.patch('/users/me', { name: 'x' }), 400, 'VALIDATION_ERROR');
  });

  test('POST /users/me/password: OTP user sets a first password, then needs the current one', async () => {
    const u = await newUser();
    const email = randomEmail();
    ok(await u.patch('/users/me', { email }), D.User);
    okTrue(await u.post('/users/me/password', { newPassword: 'First-pass-1' }));
    ok(await new Api().post('/auth/login', { login: u.phone, password: 'First-pass-1' }), D.AuthResponse);

    err(await u.post('/users/me/password', { newPassword: 'Second-pass-2' }), 400, 'INVALID_PASSWORD');
    err(await u.post('/users/me/password', { currentPassword: 'wrong-one', newPassword: 'Second-pass-2' }), 400, 'INVALID_PASSWORD');
    okTrue(await u.post('/users/me/password', { currentPassword: 'First-pass-1', newPassword: 'Second-pass-2' }));
    ok(await new Api().post('/auth/login', { login: email, password: 'Second-pass-2' }), D.AuthResponse);
    err(await new Api().post('/auth/login', { login: email, password: 'First-pass-1' }), 401, 'INVALID_CREDENTIALS');
    err(await u.post('/users/me/password', { newPassword: 'short' }), 400, 'VALIDATION_ERROR');
  });

  test('push tokens: register (idempotent) and remove', async () => {
    const u = await newUser();
    const token = `ExponentPushToken[${uniq()}]`;
    okTrue(await u.post('/users/me/push-tokens', { token, platform: 'ios' }));
    okTrue(await u.post('/users/me/push-tokens', { token, platform: 'android' }));
    okTrue(await u.del(`/users/me/push-tokens/${encodeURIComponent(token)}`));
    err(await u.post('/users/me/push-tokens', { token, platform: 'windows' }), 400, 'VALIDATION_ERROR');
    err(await anon().post('/users/me/push-tokens', { token, platform: 'ios' }), 401, 'UNAUTHORIZED');
  });

  test('GET /users/:id → PublicUser with activeListings; no private fields', async () => {
    const u = await newUser('Public Contract');
    await activeListing(u);
    const pub = ok(await anon().get(`/users/${u.id}`), D.PublicUser);
    assert.equal(pub.id, u.id);
    assert.equal(pub.name, 'Public Contract');
    assert.equal(pub.accountType, 'INDIVIDUAL');
    assert.equal(pub.agency, null);
    assert.equal(pub.activeListings, 1);
    assert.equal(pub.reviewsCount, 0);
    assert.equal(pub.rating, null);
    const raw = (await anon().get(`/users/${u.id}`)).body as Record<string, unknown>;
    for (const k of ['phone', 'email', 'role', 'status']) assert.ok(!(k in raw), `PublicUser must not expose ${k}`);
    err(await anon().get(`/users/${randomUuid()}`), 404, 'NOT_FOUND');
  });

  test('DELETE /users/me anonymises the account, archives listings and ends sessions', async () => {
    const u = await newUser('Leaving Contract');
    const { listing } = await activeListing(u);
    okTrue(await u.del('/users/me'));
    err(await u.get('/auth/me'), 401);
    err(await new Api().post('/auth/refresh', { refreshToken: u.refreshToken }), 401, ['REFRESH_INVALID', 'REFRESH_REUSED']);
    err(await anon().get(`/listings/${listing.id}`), 404, 'NOT_FOUND');
    const pub = await anon().get(`/users/${u.id}`);
    if (pub.status === 200) {
      const p = ok(pub, D.PublicUser);
      assert.notEqual(p.name, 'Leaving Contract', 'name must be anonymised');
      assert.equal(p.activeListings, 0);
    } else err(pub, 404, 'NOT_FOUND');
  });
});
