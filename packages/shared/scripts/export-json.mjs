// Exports the reference data that the Go backend embeds (single source of truth stays in TypeScript).
// Usage: pnpm --filter @evtap/shared export:json   (run after `build`)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const s = require('../dist/index.js');
const target = path.resolve(import.meta.dirname, '../../../apps/api/internal/shared/data');
fs.mkdirSync(target, { recursive: true });
const write = (f, v) => fs.writeFileSync(path.join(target, f), JSON.stringify(v, null, 2) + '\n');
write('locations.json', { countries: s.COUNTRIES, cities: s.CITIES, districts: s.DISTRICTS, metroStations: s.METRO_STATIONS });
write('pricing.json', { services: s.SERVICE_CATALOG, bundles: s.BUNDLES, plans: s.PLANS, settings: s.DEFAULT_SETTINGS });
write('enums.json', {
  dealTypes: s.DEAL_TYPES, propertyTypes: s.PROPERTY_TYPES, repairTypes: s.REPAIR_TYPES, amenities: s.AMENITIES,
  listingStatuses: s.LISTING_STATUSES, paymentPurposes: s.PAYMENT_PURPOSES, paymentStatuses: s.PAYMENT_STATUSES,
  bookingStatuses: s.BOOKING_STATUSES, reportReasons: s.REPORT_REASONS, bannerPlacements: s.BANNER_PLACEMENTS,
  userRoles: s.USER_ROLES, userStatuses: s.USER_STATUSES, currencies: s.CURRENCIES, locales: s.LOCALES, errorCodes: s.ERROR_CODES,
});
console.log('✔ exported shared JSON →', target);
