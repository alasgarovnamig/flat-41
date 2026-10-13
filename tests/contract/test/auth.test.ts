/** Auth: phone OTP, e-mail registration / login, refresh-token rotation, logout, GET /auth/me. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OTP_CODE } from '../src/config';
import * as D from '../src/dto';
import { err, ok, okTrue } from '../src/expect';
import { admin, newPasswordUser, newUser, randomEmail, randomPhone } from '../src/fixtures';
import { Api } from '../src/http';

describe('auth: phone OTP', () => {
  test('POST /auth/otp/request → { sent, retryAfter }; POST /auth/otp/verify creates the user (isNew)', async () => {
    const api = new Api();
    const phone = randomPhone();
    const sent = ok(await api.post('/auth/otp/request', { phone }), D.OtpRequestResponse);
    assert.equal(sent.sent, true);
    assert.ok(sent.retryAfter > 0);

    const auth = ok(await api.post('/auth/otp/verify', { phone, code: sent.devCode ?? OTP_CODE, name: 'Otp Contract' }), D.AuthResponse);
    assert.equal(auth.isNew, true);
    assert.equal(auth.user.phone, phone);
    assert.equal(auth.user.name, 'Otp Contract');
    assert.equal(auth.user.isPhoneVerified, true);
    assert.equal(auth.user.role, 'USER');
    assert.equal(auth.user.accountType, 'INDIVIDUAL');
    assert.equal(auth.user.status, 'ACTIVE');
    assert.equal(auth.user.agencyId, null);

    // the issued access token works
    const me = ok(await new Api({ token: auth.accessToken }).get('/auth/me'), D.Me);
    assert.equal(me.id, auth.user.id);
  });

  test('local phone format 050… is normalised to E.164 (+99450…)', async () => {
    const api = new Api();
    const e164 = randomPhone();
    const local = '0' + e164.slice(4); // +99450xxxxxxx → 050xxxxxxx
    ok(await api.post('/auth/otp/request', { phone: local }), D.OtpRequestResponse);
    const auth = ok(await api.post('/auth/otp/verify', { phone: e164, code: OTP_CODE }), D.AuthResponse);
    assert.equal(auth.user.phone, e164);
  });

  test('a second OTP request within the resend window → 429 OTP_TOO_FREQUENT', async () => {
    const api = new Api();
    const phone = randomPhone();
    ok(await api.post('/auth/otp/request', { phone }));
    err(await new Api().post('/auth/otp/request', { phone }), 429, 'OTP_TOO_FREQUENT');
  });

  test('wrong code → 400 OTP_INVALID; correct code afterwards still works', async () => {
    const api = new Api();
    const phone = randomPhone();
    ok(await api.post('/auth/otp/request', { phone }));
    const wrong = OTP_CODE === '000000' ? '999999' : '000000';
    err(await api.post('/auth/otp/verify', { phone, code: wrong }), 400, 'OTP_INVALID');
    ok(await api.post('/auth/otp/verify', { phone, code: OTP_CODE }), D.AuthResponse);
    // the code is single use
    err(await api.post('/auth/otp/verify', { phone, code: OTP_CODE }), 400, ['OTP_EXPIRED', 'OTP_INVALID']);
  });

  test('verify without a pending code → 400 OTP_EXPIRED', async () => {
    err(await new Api().post('/auth/otp/verify', { phone: randomPhone(), code: OTP_CODE }), 400, 'OTP_EXPIRED');
  });

  test('invalid payloads → 400 VALIDATION_ERROR', async () => {
    err(await new Api().post('/auth/otp/verify', { phone: randomPhone(), code: 'abc' }), 400, 'VALIDATION_ERROR');
    err(await new Api().post('/auth/otp/request', { phone: '+1 555 0100' }), 400, 'VALIDATION_ERROR');
  });
});

describe('auth: e-mail registration & login', () => {
  test('POST /auth/register → AuthResponse (isNew); duplicate e-mail → 409 USER_EXISTS', async () => {
    const api = new Api();
    const email = randomEmail();
    const reg = ok(await api.post('/auth/register', { name: 'Reg Contract', email: email.toUpperCase(), password: 'Secret-123' }), D.AuthResponse);
    assert.equal(reg.user.email, email, 'e-mail is stored lower-cased');
    assert.equal(reg.user.phone, null);
    assert.equal(reg.isNew, true);
    err(await new Api().post('/auth/register', { name: 'Reg Again', email, password: 'Secret-456' }), 409, 'USER_EXISTS');
  });

  test('POST /auth/login by e-mail and by phone; wrong password → 401 INVALID_CREDENTIALS', async () => {
    const u = await newPasswordUser('Login Contract', true);
    const byEmail = ok(await new Api().post('/auth/login', { login: u.email, password: u.password }), D.AuthResponse);
    assert.equal(byEmail.user.id, u.id);
    const byPhone = ok(await new Api().post('/auth/login', { login: u.phone, password: u.password }), D.AuthResponse);
    assert.equal(byPhone.user.id, u.id);
    err(await new Api().post('/auth/login', { login: u.email, password: 'wrong-password' }), 401, 'INVALID_CREDENTIALS');
    err(await new Api().post('/auth/login', { login: randomEmail(), password: 'whatever1' }), 401, 'INVALID_CREDENTIALS');
  });

  test('registration validation: short password, bad e-mail → 400 VALIDATION_ERROR', async () => {
    err(await new Api().post('/auth/register', { name: 'X Y', email: randomEmail(), password: 'short' }), 400, 'VALIDATION_ERROR');
    err(await new Api().post('/auth/register', { name: 'X Y', email: 'not-an-email', password: 'long-enough' }), 400, 'VALIDATION_ERROR');
  });

  test('blocked user cannot log in → 403 USER_BLOCKED', async () => {
    const u = await newPasswordUser('Blocked Contract');
    const a = await admin();
    ok(await a.patch(`/admin/users/${u.id}`, { status: 'BLOCKED' }), D.AdminUser);
    err(await new Api().post('/auth/login', { login: u.email, password: u.password }), 403, 'USER_BLOCKED');
    ok(await a.patch(`/admin/users/${u.id}`, { status: 'ACTIVE' }), D.AdminUser);
    ok(await new Api().post('/auth/login', { login: u.email, password: u.password }), D.AuthResponse);
  });
});

describe('auth: tokens', () => {
  test('POST /auth/refresh rotates the refresh token; reusing the old one → 401 REFRESH_REUSED', async () => {
    const u = await newUser();
    const first = u.refreshToken!;
    const rotated = ok(await new Api().post('/auth/refresh', { refreshToken: first }), D.AuthResponse);
    assert.notEqual(rotated.refreshToken, first);
    assert.equal(rotated.user.id, u.id);
    ok(await new Api({ token: rotated.accessToken }).get('/auth/me'), D.Me);

    err(await new Api().post('/auth/refresh', { refreshToken: first }), 401, 'REFRESH_REUSED');
    // reuse detection revokes the whole family
    err(await new Api().post('/auth/refresh', { refreshToken: rotated.refreshToken }), 401, ['REFRESH_REUSED', 'REFRESH_INVALID']);
  });

  test('unknown refresh token → 401 REFRESH_INVALID', async () => {
    err(await new Api().post('/auth/refresh', { refreshToken: 'definitely-not-a-valid-refresh-token' }), 401, 'REFRESH_INVALID');
  });

  test('POST /auth/logout revokes the refresh token; logout needs auth', async () => {
    const u = await newUser();
    err(await new Api().post('/auth/logout', { refreshToken: u.refreshToken }), 401, 'UNAUTHORIZED');
    okTrue(await u.post('/auth/logout', { refreshToken: u.refreshToken }));
    err(await new Api().post('/auth/refresh', { refreshToken: u.refreshToken }), 401, ['REFRESH_INVALID', 'REFRESH_REUSED']);
  });

  test('GET /auth/me → Me (wallet, subscription, quota, unread counters)', async () => {
    const u = await newUser('Me Contract');
    const me = ok(await u.get('/auth/me'), D.Me);
    assert.equal(me.id, u.id);
    assert.equal(me.name, 'Me Contract');
    assert.deepEqual(me.wallet, { balance: 0, bonusBalance: 0, currency: 'AZN' });
    assert.equal(me.subscription, null);
    assert.equal(me.quota.used, 0);
    assert.equal(me.quota.remaining, me.quota.freeLimit);
    assert.equal(me.unreadMessages, 0);
    assert.ok(me.unreadNotifications >= 0);
  });
});
