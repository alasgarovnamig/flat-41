// Regenerates app/src/main/assets/locations.json from packages/shared/src/locations.ts (single source of truth).
// Usage (from apps/android): node --experimental-strip-types tools/export-locations.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../packages/shared/src/locations.ts');
const out = resolve(here, '../app/src/main/assets/locations.json');
const m = await import(src);
const data = { countries: m.COUNTRIES, cities: m.CITIES, districts: m.DISTRICTS, metroStations: m.METRO_STATIONS };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
console.log(`wrote ${out}: ${data.cities.length} cities, ${data.districts.length} districts, ${data.metroStations.length} metro stations`);
