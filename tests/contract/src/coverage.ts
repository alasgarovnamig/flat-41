/**
 * Endpoint coverage: every request the suite makes is matched against the ENDPOINTS keys of the contract
 * (`packages/shared/src/api.ts`). When CONTRACT_COVERAGE_DIR is set (scripts/run.ts does it), each test process
 * writes its hits there on exit and the runner prints which endpoints were never exercised.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ENDPOINTS } from '@evtap/shared';

interface Route { key: string; method: string; re: RegExp; statics: number }

const ROUTES: Route[] = Object.keys(ENDPOINTS).map((key) => {
  const [method, tpl] = key.split(' ');
  const segs = tpl.split('/').filter(Boolean);
  const re = new RegExp('^/' + segs.map((s) => (s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '/?$');
  return { key, method, re, statics: segs.filter((s) => !s.startsWith(':')).length };
});

/** Most specific template wins (`/listings/featured` over `/listings/:id`). */
export function matchEndpoint(method: string, pathname: string): string | null {
  const hits = ROUTES.filter((r) => r.method === method.toUpperCase() && r.re.test(pathname));
  if (!hits.length) return null;
  hits.sort((a, b) => b.statics - a.statics);
  return hits[0].key;
}

type Hit = { calls: number; ok: number; statuses: Record<string, number> };
const hits = new Map<string, Hit>();

export function record(method: string, pathname: string, status: number) {
  const key = matchEndpoint(method, pathname) ?? `UNMATCHED ${method.toUpperCase()} ${pathname}`;
  const h = hits.get(key) ?? { calls: 0, ok: 0, statuses: {} };
  h.calls++;
  if (status >= 200 && status < 400) h.ok++;
  h.statuses[status] = (h.statuses[status] ?? 0) + 1;
  hits.set(key, h);
}

const dir = process.env.CONTRACT_COVERAGE_DIR;
if (dir) {
  process.on('exit', () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${process.pid}-${Date.now()}.json`), JSON.stringify(Object.fromEntries(hits)));
    } catch {
      /* coverage is best effort */
    }
  });
}

export function readCoverage(fromDir: string): Map<string, Hit> {
  const all = new Map<string, Hit>();
  if (!fs.existsSync(fromDir)) return all;
  for (const f of fs.readdirSync(fromDir)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(fromDir, f), 'utf8')) as Record<string, Hit>;
    for (const [k, h] of Object.entries(data)) {
      const cur = all.get(k) ?? { calls: 0, ok: 0, statuses: {} };
      cur.calls += h.calls;
      cur.ok += h.ok;
      for (const [s, n] of Object.entries(h.statuses)) cur.statuses[s] = (cur.statuses[s] ?? 0) + n;
      all.set(k, cur);
    }
  }
  return all;
}
