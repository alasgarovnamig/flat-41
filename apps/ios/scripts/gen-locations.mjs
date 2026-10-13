#!/usr/bin/env node
// Regenerates EvTap/Resources/locations.json from packages/shared/src/locations.ts
// (same shape as `GET /locations`). Requires Node ≥ 22.18 (built-in TypeScript type stripping).
//   node apps/ios/scripts/gen-locations.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../packages/shared/src/locations.ts');
const out = resolve(here, '../EvTap/Resources/locations.json');

const { COUNTRIES, CITIES, DISTRICTS, METRO_STATIONS } = await import(src);
const data = { countries: COUNTRIES, cities: CITIES, districts: DISTRICTS, metroStations: METRO_STATIONS };
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${out}: ${CITIES.length} cities, ${DISTRICTS.length} districts, ${METRO_STATIONS.length} metro stations`);
