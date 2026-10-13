/**
 * Runs the contract suite (node:test, one process per file) and prints endpoint coverage against
 * ENDPOINTS from packages/shared/src/api.ts.  Usage: `pnpm --filter @evtap/contract-tests test [-- test/auth.test.ts ...]`
 * Env: see README.md. CONCURRENCY (default 4) = test files run in parallel.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDPOINTS } from '@evtap/shared';
import { API_BASE } from '../src/config';
import { readCoverage } from '../src/coverage';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => a !== '--');
const files = args.filter((a) => !a.startsWith('-'));
const flags = args.filter((a) => a.startsWith('-'));
const testFiles = files.length
  ? files
  : fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.ts')).sort().map((f) => path.join('test', f));

const reachable = await fetch(`${API_BASE}/listings?pageSize=1`, { signal: AbortSignal.timeout(5000) }).then((r) => r.status < 500, () => false);
if (!reachable) {
  console.error(`Contract suite: API not reachable at ${API_BASE} — start the backend and set API_URL (see tests/contract/README.md).`);
  process.exit(1);
}

const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evtap-contract-cov-'));
const res = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', `--test-concurrency=${process.env.CONCURRENCY ?? 4}`, ...flags, ...testFiles],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CONTRACT_COVERAGE_DIR: covDir } },
);

const hits = readCoverage(covDir);
fs.rmSync(covDir, { recursive: true, force: true });
const keys = Object.keys(ENDPOINTS);
const missing = keys.filter((k) => !hits.has(k));
const noSuccess = keys.filter((k) => hits.has(k) && hits.get(k)!.ok === 0);
const unmatched = [...hits.keys()].filter((k) => k.startsWith('UNMATCHED'));

console.log(`\n── Endpoint coverage: ${keys.length - missing.length}/${keys.length} contract endpoints exercised ──`);
if (missing.length) console.log(`never called (${missing.length}):\n  ${missing.join('\n  ')}`);
if (noSuccess.length) console.log(`called but never answered 2xx/3xx (${noSuccess.length}):\n  ${noSuccess.map((k) => `${k}  ${JSON.stringify(hits.get(k)!.statuses)}`).join('\n  ')}`);
if (unmatched.length) console.log(`requests outside the contract (${unmatched.length}):\n  ${unmatched.join('\n  ')}`);
process.exit(res.status ?? 1);
