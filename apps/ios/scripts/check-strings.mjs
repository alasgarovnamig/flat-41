#!/usr/bin/env node
// Verifies that every localization key referenced from Swift (L("…"), LE("group", …) enum groups and the dynamic
// key families) exists in EvTap/Resources/Localizable.xcstrings for az, ru and en.
//   node apps/ios/scripts/check-strings.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'EvTap/Resources/Localizable.xcstrings'), 'utf8'));
const langs = ['az', 'ru', 'en'];
const has = (key, lang) => Boolean(catalog.strings[key]?.localizations?.[lang]?.stringUnit?.value);

const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f))) : p.endsWith('.swift') ? [p] : []);
const used = new Set();
const groups = new Set();
for (const f of [...walk(path.join(root, 'EvTap')), ...walk(path.join(root, 'Packages/EvTapCore/Sources'))]) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bL\("([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/\bLE\("([a-zA-Z]+)"/g)) groups.add(m[1]);
  for (const m of s.matchAll(/ValidationIssue\("([a-z]+\.[a-zA-Z]+)"/g)) used.add(m[1]);
}
// Enum groups: every value present for the group in the catalog must exist in all languages, and the group must exist.
const missing = [];
for (const g of groups) {
  const prefix = `enums.${g}.`;
  const keys = Object.keys(catalog.strings).filter((k) => k.startsWith(prefix));
  if (!keys.length) missing.push(`${prefix}* (group missing)`);
  keys.forEach((k) => used.add(k));
}
for (const prefix of ['sort.', 'post.steps.', 'myListings.tabs.', 'business.features.', 'post.field.', 'tabs.']) {
  if (!Object.keys(catalog.strings).some((k) => k.startsWith(prefix))) missing.push(`${prefix}* (family missing)`);
}
for (const key of used) for (const l of langs) if (!has(key, l)) missing.push(`${key} [${l}]`);

if (missing.length) {
  console.error(`Missing translations (${missing.length}):\n  ` + missing.sort().join('\n  '));
  process.exit(1);
}
console.log(`OK — ${used.size} keys referenced from Swift, all present in ${langs.join('/')}`);
