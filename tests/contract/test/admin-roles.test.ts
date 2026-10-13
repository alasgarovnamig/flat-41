/**
 * Role matrix for EVERY /admin/* endpoint, derived from the contract itself (ENDPOINTS legend):
 *   anonymous → 401 · USER → 403 · MODERATOR → allowed on [admin], 403 on [ADMIN] · ADMIN → allowed everywhere.
 * "Allowed" = neither 401 nor 403 (unknown ids / empty bodies make the call a harmless 400 / 404) and never 5xx.
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { ENDPOINTS } from '@evtap/shared';
import { err } from '../src/expect';
import { admin, moderator, newUser, randomUuid } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

interface AdminRoute { key: string; method: string; path: string; adminOnly: boolean }

const ROUTES: AdminRoute[] = Object.entries(ENDPOINTS)
  .filter(([k]) => k.split(' ')[1].startsWith('/admin/'))
  .map(([key, doc]) => {
    const [method, tpl] = key.split(' ');
    const path = tpl
      .replace(':id', randomUuid())
      .replace(':slug', 'contract-no-such-page')
      .replace(':code', 'NO_SUCH_CODE');
    const adminOnly = /^\[ADMIN\]/.test(doc);
    assert.ok(adminOnly || /^\[admin\]/.test(doc), `${key}: legend must be [admin] or [ADMIN]`);
    return { key, method, path, adminOnly };
  });

const send = (api: Api, r: AdminRoute) => api.call(r.method, r.path, ['GET', 'DELETE'].includes(r.method) ? {} : { body: {} });

describe('admin role matrix', () => {
  let user: Api;
  let mod: Api;
  let adm: Api;
  before(async () => {
    [user, mod, adm] = await Promise.all([newUser(), moderator(), admin()]);
  });

  test(`covers all ${ROUTES.length} admin endpoints`, () => {
    assert.ok(ROUTES.length >= 40);
  });

  for (const r of ROUTES) {
    test(`${r.key} [${r.adminOnly ? 'ADMIN' : 'admin'}]`, async () => {
      err(await send(anon(), r), 401, 'UNAUTHORIZED');
      err(await send(user, r), 403, 'FORBIDDEN');
      const m = await send(mod, r);
      if (r.adminOnly) err(m, 403, 'FORBIDDEN');
      else {
        assert.ok(![401, 403].includes(m.status), `MODERATOR must be allowed: HTTP ${m.status} ${m.text.slice(0, 200)}`);
        assert.ok(m.status < 500, `MODERATOR call crashed: HTTP ${m.status} ${m.text.slice(0, 200)}`);
      }
      const a = await send(adm, r);
      assert.ok(![401, 403].includes(a.status), `ADMIN must be allowed: HTTP ${a.status} ${a.text.slice(0, 200)}`);
      assert.ok(a.status < 500, `ADMIN call crashed: HTTP ${a.status} ${a.text.slice(0, 200)}`);
    });
  }
});
