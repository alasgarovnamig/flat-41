/**
 * Seeds demo data: admin + moderator, settings/catalog defaults, CMS pages, banners, demo users, agencies, ~60 listings,
 * reports, mortgage leads, favorites. Idempotent: deterministic ids + ON CONFLICT DO NOTHING, safe to run repeatedly.
 * Usage: pnpm db:seed
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  DEFAULT_SETTINGS, PLANS, SERVICE_CATALOG, getCity, getDistrict, getMetro,
  type Amenity, type DealType, type PropertyType, type RepairType,
} from '@evtap/shared';
import { config } from '../config';
import { createPool } from './db.module';
import * as schema from './schema';

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * DAY);
const daysAhead = (d: number) => new Date(now + d * DAY);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Deterministic UUIDs so re-running the seed never duplicates rows. */
const sid = (kind: number, n: number) => `5eed0000-0000-4000-8${kind}00-${String(n).padStart(12, '0')}`;

// Deterministic PRNG (mulberry32) → stable demo data between runs.
let seedState = 20261013;
const rand = () => {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));
const jitter = (v: number, spread = 0.008) => Math.round((v + (rand() - 0.5) * spread) * 1e6) / 1e6;

// ───────────────────────────── Images (Unsplash) ─────────────────────────────
/**
 * SEED_IMAGES=local generates placeholder photos into the upload dir instead of hot-linking Unsplash
 * (offline demos, CI, sandboxes where images.unsplash.com is unreachable).
 */
const LOCAL_IMAGES = process.env.SEED_IMAGES === 'local';
const U = (id: string) =>
  LOCAL_IMAGES
    ? { url: `${config.apiPublicUrl}/uploads/seed/${id}.webp`, thumbUrl: `${config.apiPublicUrl}/uploads/seed/${id}_t.webp` }
    : { url: `https://images.unsplash.com/photo-${id}?w=1600&q=80`, thumbUrl: `https://images.unsplash.com/photo-${id}?w=400&q=70` };

async function generateLocalImages() {
  const sharp = (await import('sharp')).default;
  const dir = path.resolve(config.storage.uploadDir, 'seed');
  await fs.mkdir(dir, { recursive: true });
  const palette: Record<string, [string, string]> = {
    interior: ['#E8DCCB', '#B08D6A'], building: ['#C9D6E3', '#5B7A99'], house: ['#D5E8D4', '#5E8B5A'],
    office: ['#DDE3EA', '#4A5568'], land: ['#E9E4C9', '#8A7F3D'], commercial: ['#EADCF0', '#7C5A8C'],
  };
  for (const [kind, ids] of Object.entries(PHOTOS)) {
    const [bg, fg] = palette[kind];
    for (const [i, id] of ids.entries()) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${fg}"/></linearGradient></defs>
        <rect width="1600" height="1200" fill="url(#g)"/>
        <g fill="#ffffff" fill-opacity="0.85" transform="translate(${560 + (i % 3) * 20},${330 + (i % 2) * 20})">
          <path d="M240 0 L480 200 L420 200 L420 440 L60 440 L60 200 L0 200 Z"/><rect x="200" y="290" width="80" height="150" fill="${fg}"/>
        </g>
        <text x="800" y="980" font-family="sans-serif" font-size="64" fill="#ffffff" text-anchor="middle" fill-opacity="0.9">EvTap · ${kind}</text>
      </svg>`;
      const img = sharp(Buffer.from(svg));
      await img.clone().webp({ quality: 80 }).toFile(path.join(dir, `${id}.webp`));
      await img.clone().resize(400).webp({ quality: 70 }).toFile(path.join(dir, `${id}_t.webp`));
    }
  }
}
const PHOTOS = {
  interior: [
    '1502672260266-1c1ef2d93688', '1560448204-e02f11c3d0e2', '1522708323590-d24dbb6b0267', '1493809842364-78817add7ffb',
    '1484154218962-a197022b5858', '1505691938895-1758d7feb511', '1600607687939-ce8a6c25118c', '1600566753190-17f0baa2a6c3',
    '1586023492125-27b2c045efd7', '1554995207-c18c203602cb', '1556909114-f6e7ad7d3136', '1505693416388-ac5ce068fe85',
  ],
  building: ['1545324418-cc1a3fa10c00', '1460317442991-0ec209397118'],
  house: [
    '1512917774080-9991f1c4c750', '1564013799919-ab600027ffc6', '1568605114967-8130f3a36994', '1570129477492-45c003edd2be',
    '1600596542815-ffad4c1539a9', '1600585154340-be6161a56a0c', '1613490493576-7fde63acd811', '1449844908441-8829872d2607', '1518780664697-55e3ad937233',
  ],
  office: ['1497366216548-37526070297c', '1497366811353-6870744d04b2', '1486406146926-c627a92ad1ab'],
  land: ['1500382017468-9049fed747ef'],
  commercial: ['1441986300917-64674bd600d8', '1486406146926-c627a92ad1ab'],
};
const pick = <T>(arr: T[], i: number) => arr[i % arr.length];
function imagesFor(prop: PropertyType, i: number) {
  const n = 3 + (i % 3);
  const ids: string[] = [];
  if (prop === 'HOUSE') ids.push(pick(PHOTOS.house, i), pick(PHOTOS.house, i + 3));
  else if (prop === 'OFFICE') ids.push(pick(PHOTOS.office, i), pick(PHOTOS.office, i + 1));
  else if (prop === 'LAND') ids.push(pick(PHOTOS.land, i), pick(PHOTOS.house, i));
  else if (prop === 'COMMERCIAL') ids.push(pick(PHOTOS.commercial, i), pick(PHOTOS.office, i));
  else ids.push(pick(PHOTOS.interior, i), pick(PHOTOS.building, i));
  for (let k = 0; ids.length < n; k++) ids.push(pick(PHOTOS.interior, i + 2 + k * 5));
  return [...new Set(ids)].map((id, order) => ({ ...U(id), order }));
}

// ───────────────────────────── Users & agencies ─────────────────────────────
interface DemoUser { key: number; name: string; phone: string; email: string | null; business?: boolean; createdDaysAgo: number }
const DEMO_USERS: DemoUser[] = [
  { key: 0, name: 'Elvin Məmmədov', phone: '+994501112233', email: 'elvin@example.az', createdDaysAgo: 29 },
  { key: 1, name: 'Aynur Həsənova', phone: '+994551234567', email: 'aynur@example.az', createdDaysAgo: 26 },
  { key: 2, name: 'Rəşad Quliyev', phone: '+994702345678', email: null, createdDaysAgo: 21 },
  { key: 3, name: 'Leyla Əliyeva', phone: '+994773456789', email: 'leyla@example.az', createdDaysAgo: 14 },
  { key: 4, name: 'Nicat İsmayılov', phone: '+994504567890', email: null, createdDaysAgo: 6 },
  { key: 5, name: 'Kamran Babayev', phone: '+994502220011', email: 'kamran@bakuestate.az', business: true, createdDaysAgo: 30 },
  { key: 6, name: 'Səbinə Rzayeva', phone: '+994552220022', email: 'sebine@xezeremlak.az', business: true, createdDaysAgo: 27 },
  { key: 7, name: 'Tural Hüseynov', phone: '+994702220033', email: 'tural@agsheher.az', business: true, createdDaysAgo: 24 },
  { key: 8, name: 'Orxan Nəbiyev', phone: '+994512220044', email: 'orxan@bakuestate.az', business: true, createdDaysAgo: 18 },
];
const DEMO_PASSWORD = 'Demo12345!';

const AGENCIES = [
  { n: 1, ownerKey: 5, members: [8], name: 'Baku Estate Group', slug: 'baku-estate-group', type: 'AGENCY', verified: true, cityId: 'baku',
    address: 'Bakı, Nəsimi r., Füzuli küç. 49', phone: '+994502220011', email: 'info@bakuestate.az', website: 'https://bakuestate.az',
    description: 'Bakıda 10 ildən artıq təcrübəyə malik daşınmaz əmlak agentliyi. Alqı-satqı, kirayə və hüquqi müşayiət xidmətləri.' },
  { n: 2, ownerKey: 6, members: [], name: 'Xəzər Əmlak', slug: 'xezer-emlak', type: 'AGENCY', verified: false, cityId: 'baku',
    address: 'Bakı, Xətai r., Babək pr. 12', phone: '+994552220022', email: 'office@xezeremlak.az', website: null,
    description: 'Xətai və Nizami rayonlarında mənzil və ofislərin alqı-satqısı, uzunmüddətli kirayə.' },
  { n: 3, ownerKey: 7, members: [], name: 'Ağ Şəhər Residence', slug: 'ag-seher-residence', type: 'DEVELOPER', verified: true, cityId: 'baku',
    address: 'Bakı, Xətai r., Ağ Şəhər', phone: '+994702220033', email: 'sales@agsheher.az', website: 'https://agsheher.az',
    description: 'Yeni yaşayış kompleksləri: çıxarışlı mənzillər, ipoteka imkanı, bağlı həyət və yeraltı parkinq.' },
] as const;

// ───────────────────────────── Listings ─────────────────────────────
const DISTRICT_CENTER: Record<string, [number, number]> = {
  'baku-nasimi': [40.392, 49.825], 'baku-yasamal': [40.383, 49.807], 'baku-narimanov': [40.405, 49.868], 'baku-nizami': [40.402, 49.935],
  'baku-khatai': [40.383, 49.948], 'baku-sabail': [40.360, 49.835], 'baku-binagadi': [40.462, 49.828], 'baku-khazar': [40.488, 50.140],
  'baku-sabunchu': [40.441, 49.940], 'baku-surakhani': [40.420, 50.010], 'baku-garadagh': [40.255, 49.600],
};

type Promo = 'vip' | 'premium' | 'urgent' | 'hl';
interface Spec {
  deal: DealType; prop: PropertyType; city: string; district?: string | null; metro?: string | null; rooms?: number | null; area: number;
  floor?: number | null; total?: number | null; price: number; owner: number; b?: 'NEW' | 'SECONDARY'; repair?: RepairType; am?: Amenity[];
  promo?: Promo[]; status?: string; land?: number; guests?: number; cur?: string; title?: string; doc?: boolean; mortgage?: boolean; verified?: boolean;
}

const APT: Amenity[] = ['BALCONY', 'ELEVATOR', 'KOMBI', 'GAS', 'WATER', 'ELECTRICITY', 'INTERNET'];
const FURN: Amenity[] = ['FURNITURE', 'KITCHEN_FURNITURE', 'WASHING_MACHINE', 'REFRIGERATOR', 'TV', 'AIR_CONDITIONER', 'WIFI'];
const DAILY: Amenity[] = ['WIFI', 'AIR_CONDITIONER', 'TV', 'REFRIGERATOR', 'KITCHEN_FURNITURE', 'FURNITURE', 'KIDS_ALLOWED'];
const VILLA: Amenity[] = ['GARDEN', 'BBQ', 'PARKING', 'WIFI', 'AIR_CONDITIONER', 'KIDS_ALLOWED', 'FURNITURE'];

const SPECS: Spec[] = [
  // Baku — sale, apartments
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-narimanov', metro: 'nariman-narimanov', rooms: 3, area: 128, floor: 9, total: 17, price: 285000, owner: 5, b: 'NEW', repair: 'EURO', am: [...APT, 'PARKING'], promo: ['premium', 'vip'], doc: true, mortgage: true, verified: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-yasamal', metro: 'elmlar-akademiyasi', rooms: 2, area: 74, floor: 5, total: 9, price: 148000, owner: 0, b: 'SECONDARY', repair: 'EURO', am: APT, doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-nasimi', metro: '28-may', rooms: 4, area: 165, floor: 12, total: 20, price: 520000, owner: 5, b: 'NEW', repair: 'DESIGNER', am: [...APT, 'PARKING', 'SECURITY', 'CCTV'], promo: ['vip'], doc: true, mortgage: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-khatai', metro: 'khalglar-dostlugu', rooms: 2, area: 68, floor: 3, total: 5, price: 92000, owner: 1, b: 'SECONDARY', repair: 'COSMETIC', am: ['BALCONY', 'GAS', 'WATER', 'ELECTRICITY'], promo: ['urgent'], doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-khatai', metro: 'hazi-aslanov', rooms: 3, area: 112, floor: 14, total: 18, price: 176000, owner: 7, b: 'NEW', repair: 'NONE', am: ['ELEVATOR', 'PARKING', 'SECURITY'], promo: ['premium'], mortgage: true, doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-khatai', metro: 'hazi-aslanov', rooms: 2, area: 84, floor: 7, total: 18, price: 134000, owner: 7, b: 'NEW', repair: 'EURO', am: ['ELEVATOR', 'PARKING', 'SECURITY', 'CCTV', 'KOMBI'], mortgage: true, doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-khatai', metro: 'ahmadli', rooms: 1, area: 52, floor: 4, total: 16, price: 82000, owner: 7, b: 'NEW', repair: 'NONE', am: ['ELEVATOR', 'SECURITY'], mortgage: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-sabail', metro: 'sahil', rooms: 3, area: 140, floor: 6, total: 12, price: 410000, owner: 6, b: 'NEW', repair: 'DESIGNER', am: [...APT, 'SEA_VIEW', 'PARKING'], promo: ['vip', 'hl'], doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-binagadi', metro: 'azadlig-prospekti', rooms: 3, area: 95, floor: 2, total: 9, price: 138000, owner: 2, b: 'SECONDARY', repair: 'EURO', am: APT, doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-nizami', metro: 'qara-qarayev', rooms: 2, area: 58, floor: 5, total: 5, price: 87000, owner: 3, b: 'SECONDARY', repair: 'COSMETIC', am: ['BALCONY', 'GAS', 'WATER'] },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-nasimi', metro: 'nasimi', rooms: 3, area: 105, floor: 10, total: 16, price: 199000, owner: 8, b: 'NEW', repair: 'EURO', am: [...APT, 'PARKING'], doc: true, mortgage: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-yasamal', metro: 'inshaatchilar', rooms: 4, area: 150, floor: 15, total: 22, price: 330000, owner: 5, b: 'NEW', repair: 'EURO', am: [...APT, 'PARKING', 'SECURITY'], doc: true, status: 'PENDING' },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-narimanov', metro: 'ganjlik', rooms: 2, area: 80, floor: 8, total: 14, price: 165000, owner: 6, b: 'NEW', repair: 'EURO', am: APT, doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-sabail', metro: 'icherisheher', rooms: 5, area: 210, floor: 3, total: 4, price: 600000, owner: 0, b: 'SECONDARY', repair: 'DESIGNER', am: [...APT, 'CENTRAL_HEATING', 'SEA_VIEW'], doc: true, status: 'PENDING' },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-nizami', metro: 'neftchilar', rooms: 1, area: 45, floor: 2, total: 9, price: 72000, owner: 4, b: 'SECONDARY', repair: 'EURO', am: ['GAS', 'WATER', 'ELECTRICITY', 'INTERNET'], status: 'EXPIRED' },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-yasamal', metro: '20-yanvar', rooms: 3, area: 88, floor: 1, total: 9, price: 128000, owner: 1, b: 'SECONDARY', repair: 'COSMETIC', am: ['GAS', 'WATER'], status: 'SOLD' },
  // Baku — sale, houses / land / office / commercial
  { deal: 'SALE', prop: 'HOUSE', city: 'baku', district: 'baku-khazar', rooms: 5, area: 320, land: 8, price: 450000, owner: 5, repair: 'EURO', am: [...VILLA, 'POOL', 'SAUNA'], promo: ['premium'], title: 'Mərdəkanda hovuzlu villa, 8 sot', doc: true },
  { deal: 'SALE', prop: 'HOUSE', city: 'baku', district: 'baku-sabunchu', rooms: 4, area: 180, land: 4, price: 155000, owner: 2, repair: 'COSMETIC', am: ['GARDEN', 'GAS', 'WATER', 'ELECTRICITY'], title: 'Bakıxanovda 4 otaqlı həyət evi' },
  { deal: 'SALE', prop: 'HOUSE', city: 'baku', district: 'baku-khazar', rooms: 6, area: 400, land: 12, price: 590000, owner: 6, repair: 'DESIGNER', am: [...VILLA, 'POOL', 'SEA_VIEW', 'SECURITY'], promo: ['vip'], title: 'Şüvəlanda dənizə yaxın 6 otaqlı villa', doc: true },
  { deal: 'SALE', prop: 'LAND', city: 'baku', district: 'baku-khazar', area: 1000, land: 10, price: 120000, owner: 3, am: ['ELECTRICITY', 'WATER', 'GAS'], title: 'Buzovnada 10 sot torpaq sahəsi, kommunikasiyalar var', doc: true },
  { deal: 'SALE', prop: 'LAND', city: 'absheron', area: 600, land: 6, price: 36000, owner: 4, am: ['ELECTRICITY'], title: 'Masazırda 6 sot torpaq, yaşayış üçün' },
  { deal: 'SALE', prop: 'OFFICE', city: 'baku', district: 'baku-nasimi', metro: '28-may', area: 210, floor: 6, total: 14, price: 480000, owner: 5, repair: 'EURO', am: ['ELEVATOR', 'AIR_CONDITIONER', 'INTERNET', 'SECURITY', 'PARKING'], title: '28 May metrosu yanında 210 m² ofis', doc: true },
  { deal: 'SALE', prop: 'COMMERCIAL', city: 'baku', district: 'baku-yasamal', metro: 'elmlar-akademiyasi', area: 95, floor: 1, total: 12, price: 260000, owner: 6, repair: 'EURO', am: ['ELECTRICITY', 'WATER', 'AIR_CONDITIONER'], title: 'Əsas yol üstündə 95 m² obyekt (mağaza üçün)', doc: true },
  // Baku — long rent
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-nasimi', metro: 'nizami', rooms: 2, area: 70, floor: 4, total: 9, price: 900, owner: 1, b: 'SECONDARY', repair: 'EURO', am: [...APT, ...FURN] },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-narimanov', metro: 'nariman-narimanov', rooms: 3, area: 120, floor: 11, total: 17, price: 1500, owner: 5, b: 'NEW', repair: 'EURO', am: [...APT, ...FURN, 'PARKING'], promo: ['vip'] },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-sabail', metro: 'sahil', rooms: 3, area: 135, floor: 8, total: 15, price: 3000, owner: 6, b: 'NEW', repair: 'DESIGNER', am: [...APT, ...FURN, 'SEA_VIEW', 'DISHWASHER'], promo: ['hl'] },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-khatai', metro: 'shah-ismayil-khatai', rooms: 1, area: 45, floor: 3, total: 9, price: 450, owner: 2, b: 'SECONDARY', repair: 'COSMETIC', am: ['FURNITURE', 'REFRIGERATOR', 'GAS', 'WATER'] },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-yasamal', metro: 'memar-ajami', rooms: 2, area: 65, floor: 6, total: 12, price: 700, owner: 3, b: 'NEW', repair: 'EURO', am: [...APT, ...FURN], promo: ['urgent'] },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-binagadi', metro: '8-noyabr', rooms: 2, area: 60, floor: 2, total: 5, price: 550, owner: 4, b: 'SECONDARY', repair: 'COSMETIC', am: ['FURNITURE', 'KITCHEN_FURNITURE', 'GAS'] },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'baku', district: 'baku-nizami', metro: 'koroghlu', rooms: 3, area: 90, floor: 7, total: 16, price: 850, owner: 8, b: 'NEW', repair: 'EURO', am: [...APT, ...FURN], status: 'PENDING' },
  { deal: 'RENT_LONG', prop: 'ROOM', city: 'baku', district: 'baku-yasamal', metro: 'elmlar-akademiyasi', rooms: 1, area: 18, floor: 3, total: 9, price: 250, owner: 0, b: 'SECONDARY', repair: 'COSMETIC', am: ['FURNITURE', 'WIFI'], title: 'Tələbə qıza otaq kirayə verilir, Elmlər Akademiyası m.' },
  { deal: 'RENT_LONG', prop: 'OFFICE', city: 'baku', district: 'baku-nasimi', metro: 'jafar-jabbarli', area: 120, floor: 5, total: 10, price: 2200, owner: 5, repair: 'EURO', am: ['ELEVATOR', 'AIR_CONDITIONER', 'INTERNET', 'SECURITY'], title: 'Cəfər Cabbarlı metrosu yanında 120 m² ofis kirayəsi' },
  { deal: 'RENT_LONG', prop: 'COMMERCIAL', city: 'baku', district: 'baku-narimanov', metro: 'ganjlik', area: 80, floor: 1, total: 9, price: 1800, owner: 6, repair: 'EURO', am: ['ELECTRICITY', 'WATER'], title: 'Gənclikdə 80 m² obyekt icarəyə verilir (kafe, mağaza)' },
  { deal: 'RENT_LONG', prop: 'HOUSE', city: 'baku', district: 'baku-khazar', rooms: 4, area: 220, land: 6, price: 2500, owner: 2, repair: 'EURO', am: VILLA, title: 'Novxanıda 4 otaqlı villa uzunmüddətli kirayə', status: 'PENDING' },
  // Baku — daily rent
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'baku', district: 'baku-sabail', metro: 'icherisheher', rooms: 2, area: 65, floor: 3, total: 5, price: 120, owner: 3, repair: 'DESIGNER', am: [...DAILY, 'SEA_VIEW'], guests: 4, promo: ['premium'] },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'baku', district: 'baku-nasimi', metro: '28-may', rooms: 1, area: 42, floor: 7, total: 12, price: 60, owner: 1, repair: 'EURO', am: DAILY, guests: 2 },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'baku', district: 'baku-sabail', metro: 'sahil', rooms: 3, area: 110, floor: 10, total: 16, price: 180, owner: 6, repair: 'DESIGNER', am: [...DAILY, 'SEA_VIEW', 'WASHING_MACHINE'], guests: 6, promo: ['vip'] },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'baku', district: 'baku-khazar', rooms: 4, area: 250, land: 10, price: 300, owner: 0, repair: 'EURO', am: [...VILLA, 'POOL', 'SAUNA'], guests: 10, title: 'Mərdəkanda hovuzlu villa günlük kirayə' },
  // Sumgait, Ganja, Absheron
  { deal: 'SALE', prop: 'APARTMENT', city: 'sumgait', district: 'sumgait-center', rooms: 3, area: 85, floor: 4, total: 9, price: 78000, owner: 2, b: 'SECONDARY', repair: 'EURO', am: APT, doc: true },
  { deal: 'SALE', prop: 'APARTMENT', city: 'sumgait', district: 'sumgait-center', rooms: 2, area: 72, floor: 9, total: 16, price: 89000, owner: 7, b: 'NEW', repair: 'NONE', am: ['ELEVATOR', 'SEA_VIEW'], mortgage: true, title: 'Sumqayıt bulvarı yanında yeni tikili, 2 otaq' },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'sumgait', district: 'sumgait-corat', rooms: 2, area: 60, floor: 2, total: 5, price: 400, owner: 4, b: 'SECONDARY', repair: 'COSMETIC', am: ['FURNITURE', 'GAS'] },
  { deal: 'SALE', prop: 'APARTMENT', city: 'ganja', district: 'ganja-kapaz', rooms: 3, area: 100, floor: 5, total: 9, price: 85000, owner: 3, b: 'SECONDARY', repair: 'EURO', am: APT, doc: true },
  { deal: 'SALE', prop: 'HOUSE', city: 'ganja', district: 'ganja-nizami', rooms: 5, area: 240, land: 6, price: 165000, owner: 1, repair: 'EURO', am: ['GARDEN', 'GAS', 'WATER', 'PARKING'], title: 'Gəncədə 5 otaqlı həyət evi, 6 sot', doc: true },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'ganja', district: 'ganja-kapaz', rooms: 2, area: 70, floor: 3, total: 9, price: 400, owner: 0, b: 'SECONDARY', repair: 'EURO', am: FURN },
  { deal: 'SALE', prop: 'HOUSE', city: 'khirdalan', rooms: 3, area: 130, land: 3, price: 98000, owner: 4, repair: 'COSMETIC', am: ['GARDEN', 'GAS', 'WATER'], title: 'Xırdalanda 3 otaqlı həyət evi', status: 'REJECTED' },
  // Resorts — daily rent houses
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'gabala', rooms: 3, area: 140, land: 5, price: 150, owner: 2, repair: 'EURO', am: [...VILLA, 'SAUNA'], guests: 8, title: 'Qəbələdə meşə kənarında kottec, günlük', promo: ['vip'] },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'gabala', rooms: 2, area: 80, land: 3, price: 90, owner: 3, repair: 'EURO', am: VILLA, guests: 5, title: 'Qəbələ, Vəndam yolunda taxta ev günlük kirayə' },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'guba', rooms: 4, area: 180, land: 8, price: 200, owner: 0, repair: 'EURO', am: [...VILLA, 'POOL'], guests: 10, title: 'Qubada hovuzlu bağ evi, almalıqda', promo: ['hl'] },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'guba', rooms: 2, area: 70, land: 2, price: 70, owner: 4, repair: 'COSMETIC', am: ['GARDEN', 'BBQ', 'WIFI'], guests: 4, title: 'Quba, Qəçrəş meşəsində kiçik ev' },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'nabran', rooms: 3, area: 120, land: 6, price: 160, owner: 1, repair: 'EURO', am: [...VILLA, 'SEA_VIEW'], guests: 8, title: 'Nabranda dənizə 300 m məsafədə bağ evi', promo: ['premium'] },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'nabran', rooms: 2, area: 75, land: 4, price: 80, owner: 2, repair: 'COSMETIC', am: ['GARDEN', 'BBQ', 'KIDS_ALLOWED', 'WIFI'], guests: 5, title: 'Nabran, meşə içində iki otaqlı kottec' },
  { deal: 'RENT_DAILY', prop: 'HOUSE', city: 'gusar', rooms: 3, area: 130, land: 5, price: 140, owner: 3, repair: 'EURO', am: [...VILLA, 'SAUNA'], guests: 7, title: 'Qusarda Şahdağ yolunda dağ evi', status: 'PENDING' },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'shaki', rooms: 2, area: 60, floor: 2, total: 3, price: 50, owner: 4, repair: 'EURO', am: DAILY, guests: 4, title: 'Şəkidə mərkəzdə günlük mənzil, Xan sarayına yaxın' },
  // Georgia
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'batumi', district: 'batumi-new', rooms: 1, area: 45, floor: 22, total: 40, price: 75, owner: 0, repair: 'DESIGNER', am: [...DAILY, 'SEA_VIEW', 'POOL'], guests: 3, cur: 'USD', title: 'Batumi, Yeni Bulvar — dəniz mənzərəli studio', promo: ['vip'] },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'batumi', district: 'batumi-old', rooms: 2, area: 70, floor: 5, total: 9, price: 110, owner: 3, repair: 'EURO', am: DAILY, guests: 4, cur: 'USD', title: 'Köhnə Batumidə iki otaqlı günlük mənzil' },
  { deal: 'SALE', prop: 'APARTMENT', city: 'batumi', district: 'batumi-new', rooms: 2, area: 68, floor: 18, total: 35, price: 85000, owner: 6, b: 'NEW', repair: 'EURO', am: ['ELEVATOR', 'POOL', 'SEA_VIEW', 'SECURITY'], cur: 'USD', title: 'Batumidə dəniz kənarında yeni tikili, 2 otaq' },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'tbilisi', district: 'tbilisi-mtatsminda', rooms: 2, area: 65, floor: 3, total: 5, price: 180, owner: 1, repair: 'DESIGNER', am: DAILY, guests: 4, cur: 'GEL', title: 'Tbilisi, Köhnə şəhərdə balkonlu mənzil günlük' },
  { deal: 'SALE', prop: 'APARTMENT', city: 'tbilisi', district: 'tbilisi-vake', rooms: 3, area: 110, floor: 7, total: 12, price: 210000, owner: 5, b: 'NEW', repair: 'EURO', am: [...APT, 'PARKING'], cur: 'USD', title: 'Tbilisi, Vake — 3 otaqlı yeni tikili' },
  { deal: 'RENT_LONG', prop: 'APARTMENT', city: 'tbilisi', district: 'tbilisi-saburtalo', rooms: 2, area: 60, floor: 9, total: 16, price: 1500, owner: 2, b: 'NEW', repair: 'EURO', am: [...APT, ...FURN], cur: 'GEL', title: 'Saburtalo, metroya yaxın 2 otaqlı mənzil kirayə' },
  // more Baku
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-surakhani', rooms: 2, area: 62, floor: 3, total: 5, price: 64000, owner: 4, b: 'SECONDARY', repair: 'COSMETIC', am: ['GAS', 'WATER', 'ELECTRICITY'], title: 'Hövsanda 2 otaqlı mənzil, təcili satılır', promo: ['urgent'] },
  { deal: 'SALE', prop: 'GARAGE', city: 'baku', district: 'baku-yasamal', metro: 'inshaatchilar', area: 22, price: 18000, owner: 0, am: ['ELECTRICITY'], title: 'İnşaatçılar m. yanında qaraj satılır', status: 'PENDING' },
  { deal: 'SALE', prop: 'APARTMENT', city: 'baku', district: 'baku-narimanov', metro: 'bakmil', rooms: 3, area: 98, floor: 6, total: 10, price: 175000, owner: 8, b: 'NEW', repair: 'EURO', am: APT, doc: true, mortgage: true },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', city: 'baku', district: 'baku-nasimi', metro: 'sahil', rooms: 1, area: 38, floor: 4, total: 9, price: 45, owner: 2, repair: 'EURO', am: DAILY, guests: 2, status: 'PENDING' },
];

const REPAIR_TEXT: Record<RepairType, string> = { NONE: 'Təmirsizdir (ağ karkas)', COSMETIC: 'Kosmetik təmirlidir', EURO: 'Avro təmirlidir', DESIGNER: 'Dizayner təmirlidir' };

function placeName(s: Spec) {
  const m = s.metro ? getMetro(s.metro) : undefined;
  if (m) return `${m.name.az} m.`;
  const d = s.district ? getDistrict(s.district) : undefined;
  if (d && s.city === 'baku') return d.name.az;
  return getCity(s.city)!.name.az;
}

function titleOf(s: Spec) {
  if (s.title) return s.title;
  const place = placeName(s);
  const kind = s.b === 'NEW' ? 'yeni tikili' : s.b === 'SECONDARY' ? 'köhnə tikili' : 'mənzil';
  if (s.deal === 'SALE') return `${s.rooms} otaqlı ${kind}, ${place}`;
  if (s.deal === 'RENT_LONG') return `Kirayə ${s.rooms} otaqlı mənzil, ${place}`;
  return `Günlük kirayə ${s.rooms} otaqlı mənzil, ${place}`;
}

function descriptionOf(s: Spec) {
  const place = placeName(s);
  const city = getCity(s.city)!.name.az;
  const repair = s.repair ? REPAIR_TEXT[s.repair] + '.' : '';
  const docs = s.doc ? ' Çıxarış var.' : '';
  const mort = s.mortgage ? ' İpoteka ilə almaq mümkündür.' : '';
  switch (s.prop) {
    case 'HOUSE':
      if (s.deal === 'RENT_DAILY') return `${city} ərazisində ${s.rooms} otaqlı ev günlük kirayə verilir. Həyətdə manqal, oturacaqlar və uşaqlar üçün oyun yeri var. Ev ${s.guests} nəfərə qədər qonaq üçün nəzərdə tutulub, təmiz yataq dəstləri və dəsmallar verilir. Giriş 14:00, çıxış 12:00.`;
      if (s.deal === 'RENT_LONG') return `${place} ərazisində ${s.rooms} otaqlı həyət evi uzunmüddətli kirayəyə verilir. Torpaq sahəsi ${s.land} sot, ev ${s.area} m². ${repair} Ailə üçün ideal seçimdir.`;
      return `${place} ərazisində ${s.land} sot torpaq sahəsində ${s.rooms} otaqlı, ${s.area} m² ev satılır. ${repair}${docs} Bütün kommunikasiyalar qoşulub, həyətdə meyvə ağacları var. Qonşuluq sakit və təhlükəsizdir.`;
    case 'LAND':
      return `${place} ərazisində ${s.land} sot torpaq sahəsi satılır. Ərazi düzənlikdir, yol kənarındadır, işıq və su xətti yaxından keçir.${docs} Fərdi yaşayış evi və ya bağ evi tikmək üçün əlverişlidir.`;
    case 'OFFICE':
      return `${place} yaxınlığında ${s.area} m² ofis sahəsi ${s.deal === 'SALE' ? 'satılır' : 'icarəyə verilir'}. ${repair} Açıq tipli iş zonası, 2 kabinet, iclas otağı və mətbəx var. Binada mühafizə, lift və parkinq mövcuddur.${docs}`;
    case 'COMMERCIAL':
      return `${place} ərazisində, işlək yol üstündə ${s.area} m² qeyri-yaşayış obyekti ${s.deal === 'SALE' ? 'satılır' : 'icarəyə verilir'}. Mağaza, kafe, aptek və ya ofis üçün uyğundur. ${repair}${docs} Böyük vitrin şüşələri və ayrıca giriş var.`;
    case 'GARAGE':
      return `${place} yaxınlığında mühafizə olunan ərazidə ${s.area} m² qaraj satılır. İşıq var, darvaza elektriklidir. Sənədləri qaydasındadır.`;
    case 'ROOM':
      return `${place} yaxınlığında 3 otaqlı mənzildə bir otaq kirayə verilir. Otaq əşyalıdır, Wi-Fi var, kommunal xərclər qiymətə daxildir. Yalnız tələbə qızlara verilir.`;
    default:
      if (s.deal === 'RENT_DAILY') return `${place} ərazisində ${s.rooms} otaqlı rahat mənzil günlük kirayə verilir. Mənzildə Wi-Fi, kondisioner, mətbəx texnikası, təmiz yataq dəstləri var. ${s.guests} nəfərə qədər qonaq qəbul edilir. Giriş 14:00, çıxış 12:00. Siqaret çəkmək qadağandır.`;
      if (s.deal === 'RENT_LONG') return `${place} yaxınlığında ${s.rooms} otaqlı, ${s.area} m² mənzil uzunmüddətli kirayəyə verilir. ${repair} Mənzil əşyalıdır, bütün məişət texnikası var. Ailəyə verilir, depozit bir aylıq kirayə məbləğidir.`;
      return `${place} yaxınlığında ${s.b === 'NEW' ? 'yeni tikili' : 'köhnə tikili'} binada ${s.rooms} otaqlı mənzil satılır. Ümumi sahə ${s.area} m², ${s.floor}/${s.total} mərtəbə. ${repair}${docs}${mort} Mənzil işıqlı və günəşlidir, yaxınlıqda məktəb, bağça, marketlər və ictimai nəqliyyat var.`;
  }
}

function coordsOf(s: Spec): [number, number] {
  const m = s.metro ? getMetro(s.metro) : undefined;
  if (m) return [jitter(m.lat, 0.01), jitter(m.lng, 0.012)];
  const d = s.district ? DISTRICT_CENTER[s.district] : undefined;
  if (d) return [jitter(d[0], 0.02), jitter(d[1], 0.025)];
  const c = getCity(s.city)!;
  return [jitter(c.lat, 0.03), jitter(c.lng, 0.03)];
}

// ───────────────────────────── CMS pages & banners ─────────────────────────────
const PAGES = [
  { slug: 'about', title: { az: 'Haqqımızda', ru: 'О нас', en: 'About us' }, body: {
    az: '## EvTap haqqında\n\nEvTap — Azərbaycanda və Gürcüstanda daşınmaz əmlakın alqı-satqısı, uzunmüddətli və günlük kirayəsi üçün müasir platformadır. Biz yoxlanılmış elanlar, xəritədə axtarış, onlayn rezervasiya və təhlükəsiz ödəniş təklif edirik.',
    ru: '## О EvTap\n\nEvTap — современная платформа для покупки, продажи, долгосрочной и посуточной аренды недвижимости в Азербайджане и Грузии. Проверенные объявления, поиск на карте, онлайн-бронирование и безопасная оплата.',
    en: '## About EvTap\n\nEvTap is a modern marketplace for buying, selling, long-term and daily rentals of real estate in Azerbaijan and Georgia. Verified listings, map search, online booking and secure payments.' } },
  { slug: 'terms', title: { az: 'İstifadə şərtləri', ru: 'Условия использования', en: 'Terms of use' }, body: {
    az: '## İstifadə şərtləri\n\n1. Elan yerləşdirən şəxs məlumatların düzgünlüyünə görə məsuliyyət daşıyır.\n2. Saxta, təkrar və ya yanlış qiymətli elanlar bloklanır.\n3. Ödənişli xidmətlər göstərildikdən sonra geri qaytarılmır, istisnalar qaydalarda göstərilib.\n4. Günlük kirayə rezervasiyalarında ləğv qaydaları tətbiq olunur.',
    ru: '## Условия использования\n\n1. Автор объявления несёт ответственность за достоверность данных.\n2. Фейковые, дублирующиеся объявления и объявления с неверной ценой блокируются.\n3. Платные услуги после оказания не возвращаются, исключения указаны в правилах.\n4. Для посуточных бронирований действуют правила отмены.',
    en: '## Terms of use\n\n1. The author of a listing is responsible for its accuracy.\n2. Fake, duplicate or mispriced listings are blocked.\n3. Paid services are non-refundable once delivered, except as stated in the rules.\n4. Cancellation rules apply to daily-rent bookings.' } },
  { slug: 'privacy', title: { az: 'Məxfilik siyasəti', ru: 'Политика конфиденциальности', en: 'Privacy policy' }, body: {
    az: '## Məxfilik siyasəti\n\nTelefon nömrəniz yalnız giriş və elan əlaqəsi üçün istifadə olunur. Hesabınızı istənilən vaxt tətbiqdən silə bilərsiniz — bu zaman şəxsi məlumatlarınız anonimləşdirilir.',
    ru: '## Политика конфиденциальности\n\nВаш номер телефона используется только для входа и связи по объявлениям. Вы можете удалить аккаунт в любой момент — персональные данные будут обезличены.',
    en: '## Privacy policy\n\nYour phone number is used only for sign-in and listing contact. You can delete your account at any time — your personal data will be anonymised.' } },
  { slug: 'help', title: { az: 'Kömək', ru: 'Помощь', en: 'Help' }, body: {
    az: '## Tez-tez verilən suallar\n\n**Elanı necə yerləşdirim?** "Elan yerləşdir" düyməsini basın, şəkilləri yükləyin və formu doldurun.\n\n**Elanım nə vaxt dərc olunacaq?** Moderasiya adətən 1 saata qədər çəkir.\n\n**Günlük kirayəni necə bron edim?** Tarixləri seçin və kartla və ya balansla ödəyin.',
    ru: '## Частые вопросы\n\n**Как подать объявление?** Нажмите «Подать объявление», загрузите фото и заполните форму.\n\n**Когда объявление опубликуют?** Модерация обычно занимает до 1 часа.\n\n**Как забронировать посуточно?** Выберите даты и оплатите картой или с баланса.',
    en: '## FAQ\n\n**How do I post a listing?** Tap "Post a listing", upload photos and fill in the form.\n\n**When will it be published?** Moderation usually takes up to 1 hour.\n\n**How do I book a daily rental?** Pick dates and pay by card or wallet.' } },
  { slug: 'pricing-info', title: { az: 'Qiymətlər', ru: 'Цены', en: 'Pricing' }, body: {
    az: '## Xidmətlərin qiymətləri\n\n- 30 gündə 2 elan pulsuzdur, sonrakı hər elan — 3 ₼\n- Günlük kirayə elanları pulsuzdur\n- Yuxarı qaldır — 1 ₼, VIP — 1.5 ₼-dan, Premium — 3 ₼-dan\n- Agentliklər üçün abunəliklər: Start 49 ₼, Pro 129 ₼, Enterprise 299 ₼ / ay',
    ru: '## Цены на услуги\n\n- 2 объявления за 30 дней бесплатно, далее — 3 ₼ за объявление\n- Посуточные объявления бесплатны\n- Поднятие — 1 ₼, VIP — от 1.5 ₼, Премиум — от 3 ₼\n- Подписки для агентств: Start 49 ₼, Pro 129 ₼, Enterprise 299 ₼ / мес',
    en: '## Pricing\n\n- 2 free listings per 30 days, then 3 ₼ per listing\n- Daily-rent listings are free\n- Bump — 1 ₼, VIP — from 1.5 ₼, Premium — from 3 ₼\n- Agency plans: Start 49 ₼, Pro 129 ₼, Enterprise 299 ₼ / month' } },
];

const BANNERS = [
  { n: 1, placement: 'HOME_TOP', title: 'Ağ Şəhər Residence — 8% ipoteka ilə yeni mənzillər', imageUrl: U('1545324418-cc1a3fa10c00').url, linkUrl: 'https://evtap.az/agencies/ag-seher-residence', sortOrder: 0 },
  { n: 2, placement: 'SEARCH_SIDEBAR', title: 'Kapital Bank ipotekası — illik 8%-dən', imageUrl: U('1560448204-e02f11c3d0e2').url, linkUrl: 'https://evtap.az/mortgage', sortOrder: 0 },
  { n: 3, placement: 'MOBILE_HOME', title: 'Yay mövsümü: Nabran və Qəbələdə günlük evlər', imageUrl: U('1449844908441-8829872d2607').url, linkUrl: 'https://evtap.az/search?dealType=RENT_DAILY', sortOrder: 0 },
];

async function main() {
  const pool = createPool();
  const db = drizzle(pool, { schema });
  if (LOCAL_IMAGES) {
    await generateLocalImages();
    console.log(`✔ placeholder images generated in ${config.storage.uploadDir}/seed`);
  }

  // Settings & catalog defaults (same as SettingsService.ensureDefaults) so the seed works standalone.
  await db.insert(schema.settings).values({ key: 'platform', value: DEFAULT_SETTINGS }).onConflictDoNothing();
  for (const s of SERVICE_CATALOG) await db.insert(schema.services).values({ ...s }).onConflictDoNothing();
  for (const p of PLANS) await db.insert(schema.plans).values({ ...p }).onConflictDoNothing();

  // Staff
  await db
    .insert(schema.users)
    .values({ name: 'Admin', email: config.admin.email, passwordHash: await bcrypt.hash(config.admin.password, 10), role: 'ADMIN', isEmailVerified: true })
    .onConflictDoNothing();
  await db
    .insert(schema.users)
    .values({ name: 'Moderator', email: 'moderator@evtap.az', phone: '+994500000001', passwordHash: await bcrypt.hash('Moder12345!', 10), role: 'MODERATOR', isEmailVerified: true, isPhoneVerified: true })
    .onConflictDoNothing();

  // Demo users
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userIds: Record<number, string> = {};
  const userRows: Record<number, typeof schema.users.$inferSelect> = {};
  for (const u of DEMO_USERS) {
    await db
      .insert(schema.users)
      .values({
        id: sid(1, u.key + 1), name: u.name, phone: u.phone, email: u.email, passwordHash: demoHash, isPhoneVerified: true, isEmailVerified: !!u.email,
        accountType: u.business ? 'BUSINESS' : 'INDIVIDUAL', createdAt: daysAgo(u.createdDaysAgo), lastLoginAt: daysAgo(between(0, 3)),
      })
      .onConflictDoNothing();
    const [row] = await db.select().from(schema.users).where(eq(schema.users.phone, u.phone));
    userIds[u.key] = row.id;
    userRows[u.key] = row;
    await db.insert(schema.wallets).values({ userId: row.id }).onConflictDoNothing();
  }

  // Agencies + members
  const agencyOf: Record<number, string> = {};
  for (const a of AGENCIES) {
    const ownerId = userIds[a.ownerKey];
    await db
      .insert(schema.agencies)
      .values({ id: sid(2, a.n), ownerId, name: a.name, slug: a.slug, type: a.type, verified: a.verified, cityId: a.cityId, address: a.address, phone: a.phone, email: a.email, website: a.website, description: a.description, createdAt: daysAgo(25) })
      .onConflictDoNothing();
    const [ag] = await db.select().from(schema.agencies).where(eq(schema.agencies.slug, a.slug));
    for (const [key, role] of [[a.ownerKey, 'OWNER'], ...a.members.map((m) => [m, 'AGENT'] as const)] as [number, string][]) {
      await db.insert(schema.agencyMembers).values({ agencyId: ag.id, userId: userIds[key], role }).onConflictDoNothing();
      await db.update(schema.users).set({ agencyId: ag.id, accountType: 'BUSINESS' }).where(eq(schema.users.id, userIds[key]));
      agencyOf[key] = ag.id;
    }
  }

  // Baku Estate Group runs on a PRO subscription (so its quota/agents limits make sense in the demo).
  const bakuEstate = agencyOf[5];
  const [hasSub] = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(eq(schema.subscriptions.agencyId, bakuEstate));
  if (!hasSub) {
    const pro = PLANS.find((p) => p.code === 'PRO')!;
    await db.insert(schema.subscriptions).values({
      userId: userIds[5], agencyId: bakuEstate, planCode: 'PRO', period: 'MONTH', status: 'ACTIVE', autoRenew: true,
      currentPeriodStart: daysAgo(12), currentPeriodEnd: daysAhead(18), bumpsLeft: pro.monthlyBumps - 12, vipCreditsLeft: pro.monthlyVipCredits - 1, premiumCreditsLeft: pro.monthlyPremiumCredits,
    });
  }

  // Listings
  const lifetime = DEFAULT_SETTINGS.listingLifetimeDays;
  let created = 0;
  const listingIds: string[] = [];
  for (let i = 0; i < SPECS.length; i++) {
    const s = SPECS[i];
    const id = sid(3, i + 1);
    listingIds.push(id);
    const owner = userRows[s.owner];
    const status = s.status ?? 'ACTIVE';
    // Spread creation over the last 30 days (expired ones are older).
    const createdAt = status === 'EXPIRED' ? daysAgo(between(32, 40)) : new Date(now - (i / SPECS.length) * 29 * DAY - between(0, 12) * 3_600_000);
    const published = ['ACTIVE', 'EXPIRED', 'SOLD'].includes(status) ? new Date(createdAt.getTime() + between(1, 6) * 3_600_000) : null;
    const bumpedAt = published ? new Date(Math.min(now, published.getTime() + between(0, 3) * DAY)) : createdAt;
    const [lat, lng] = coordsOf(s);
    const promo = status === 'ACTIVE' ? (s.promo ?? []) : [];
    const until = (p: Promo) => (promo.includes(p) ? daysAhead(between(2, 7)) : null);
    const views = status === 'PENDING' ? 0 : between(40, 1800);
    const pricePeriod = s.deal === 'SALE' ? 'TOTAL' : s.deal === 'RENT_LONG' ? 'MONTH' : 'DAY';
    const values: typeof schema.listings.$inferInsert = {
      id, ownerId: owner.id, agencyId: agencyOf[s.owner] ?? null, dealType: s.deal, propertyType: s.prop, buildingType: s.prop === 'APARTMENT' ? (s.b ?? null) : null,
      title: titleOf(s), description: descriptionOf(s), price: s.price, currency: s.cur ?? 'AZN', pricePeriod, country: getCity(s.city)!.country,
      cityId: s.city, districtId: s.district ?? null, metroId: s.metro ?? null, address: s.district ? `${getDistrict(s.district)!.name.az}, ${placeName(s)}` : getCity(s.city)!.name.az,
      lat, lng, area: s.area, landArea: s.land ?? null, rooms: s.rooms ?? null, bathrooms: s.rooms ? Math.max(1, Math.floor(s.rooms / 2)) : null,
      floor: s.floor ?? null, totalFloors: s.total ?? null, yearBuilt: s.b === 'NEW' ? between(2018, 2025) : s.b === 'SECONDARY' ? between(1965, 2005) : null,
      ceilingHeight: s.prop === 'APARTMENT' ? (s.b === 'NEW' ? 3.0 : 2.8) : null, repair: s.repair ?? null, hasDocument: !!s.doc, mortgageAvailable: !!s.mortgage,
      amenities: [...new Set(s.am ?? [])], maxGuests: s.guests ?? null, minNights: s.deal === 'RENT_DAILY' ? (s.prop === 'HOUSE' ? 2 : 1) : null,
      checkInTime: s.deal === 'RENT_DAILY' ? '14:00' : null, checkOutTime: s.deal === 'RENT_DAILY' ? '12:00' : null,
      houseRules: s.deal === 'RENT_DAILY' ? 'Siqaret çəkmək qadağandır. Səs-küy 23:00-dan sonra qadağandır. Ev heyvanları ilə razılaşma əsasında.' : null,
      contactName: owner.name, contactPhone: owner.phone!, status, rejectionReason: status === 'REJECTED' ? 'Şəkillər əmlaka aid deyil, real şəkillər yükləyin.' : null,
      isVerified: !!s.verified, isFreeQuota: true, views, phoneViews: Math.round(views * (0.05 + rand() * 0.1)),
      bumpedAt, vipUntil: until('vip'), premiumUntil: until('premium'), highlightUntil: until('hl'), urgentUntil: until('urgent'),
      publishedAt: published, expiresAt: published ? new Date(published.getTime() + lifetime * DAY) : null, createdAt, updatedAt: createdAt,
    };
    const ins = await db.insert(schema.listings).values(values).onConflictDoNothing().returning({ id: schema.listings.id });
    if (!ins.length) continue;
    created++;
    await db.insert(schema.listingImages).values(imagesFor(s.prop, i).map((img) => ({ ...img, listingId: id })));
    for (const p of promo) {
      const type = { vip: 'VIP', premium: 'PREMIUM', urgent: 'URGENT', hl: 'HIGHLIGHT' }[p];
      const endsAt = values[({ vip: 'vipUntil', premium: 'premiumUntil', urgent: 'urgentUntil', hl: 'highlightUntil' } as const)[p]] as Date;
      await db.insert(schema.listingPromotions).values({ listingId: id, type, serviceCode: `${type}_7`, startsAt: new Date(endsAt.getTime() - 7 * DAY), endsAt, source: 'ADMIN' });
    }
    // Daily view stats since publication (≤ 30 days) so owner/agency charts have data.
    if (published && views) {
      const days = Math.min(30, Math.max(1, Math.ceil((now - published.getTime()) / DAY)));
      const rows = Array.from({ length: days }, (_, k) => {
        const v = Math.max(0, Math.round((views / days) * (0.5 + rand())));
        return { listingId: id, date: ymd(daysAgo(k)), views: v, phoneViews: Math.round(v * 0.08) };
      });
      await db.insert(schema.listingDailyStats).values(rows).onConflictDoNothing();
    }
    if (s.deal === 'RENT_DAILY' && status === 'ACTIVE' && i % 2 === 0) {
      const blocked = [5, 6, 12, 13, 14].map((d) => ({ listingId: id, date: ymd(daysAhead(d)) }));
      await db.insert(schema.listingBlockedDates).values(blocked).onConflictDoNothing();
    }
  }

  // Favorites
  const favs: [number, number][] = [[0, 0], [0, 2], [0, 34], [1, 0], [1, 45], [3, 7], [3, 24], [4, 0], [4, 16], [2, 52]];
  for (const [u, l] of favs) await db.insert(schema.favorites).values({ userId: userIds[u], listingId: listingIds[l] }).onConflictDoNothing();
  await db.execute(sql`update listings l set favorites_count = (select count(*) from favorites f where f.listing_id = l.id)
    where l.id in (${sql.join(listingIds.map((x) => sql`${x}::uuid`), sql`, `)})`);

  // Saved search
  const [hasSaved] = await db.select({ id: schema.savedSearches.id }).from(schema.savedSearches).where(eq(schema.savedSearches.userId, userIds[0]));
  if (!hasSaved) {
    await db.insert(schema.savedSearches).values({ userId: userIds[0], name: 'Nərimanovda 2-3 otaqlı', query: { dealType: 'SALE', cityId: 'baku', districtId: ['baku-narimanov'], rooms: [2, 3], priceMax: 300000 }, notify: true, lastCheckedAt: daysAgo(1) });
  }

  // Reports
  const reports = [
    { n: 1, l: 3, by: 0, reason: 'WRONG_PRICE', comment: 'Zəng etdim, qiymət 110 000 dedilər.' },
    { n: 2, l: 23, by: 3, reason: 'AGENT_AS_OWNER', comment: 'Mülkiyyətçi kimi göstərilib, amma vasitəçidir.' },
    { n: 3, l: 27, by: 4, reason: 'ALREADY_SOLD', comment: null },
    { n: 4, l: 8, by: null, reason: 'FAKE', comment: 'Bu ünvanda belə bina yoxdur.' },
  ];
  for (const r of reports) {
    await db
      .insert(schema.listingReports)
      .values({ id: sid(4, r.n), listingId: listingIds[r.l], reporterId: r.by == null ? null : userIds[r.by], reason: r.reason, comment: r.comment, createdAt: daysAgo(r.n) })
      .onConflictDoNothing();
  }

  // Mortgage leads
  const leads = [
    { n: 1, name: 'Fərid Abbasov', phone: '+994503334455', l: 0, price: 285000, down: 60000, term: 20, bank: 'KAPITAL', status: 'NEW' },
    { n: 2, name: 'Günel Səfərova', phone: '+994554445566', l: 4, price: 176000, down: 35000, term: 15, bank: 'ABB', status: 'SENT_TO_BANK' },
    { n: 3, name: 'Ramin Kərimov', phone: '+994705556677', l: null, price: 120000, down: 25000, term: 25, bank: null, status: 'NEW' },
    { n: 4, name: 'Nərmin Qasımova', phone: '+994776667788', l: 10, price: 199000, down: 50000, term: 20, bank: 'PASHA', status: 'CLOSED' },
  ];
  for (const m of leads) {
    await db
      .insert(schema.mortgageLeads)
      .values({ id: sid(5, m.n), name: m.name, phone: m.phone, listingId: m.l == null ? null : listingIds[m.l], price: m.price, downPayment: m.down, termYears: m.term, bankCode: m.bank, status: m.status, createdAt: daysAgo(m.n * 3) })
      .onConflictDoNothing();
  }

  // CMS pages & banners
  for (const p of PAGES) await db.insert(schema.cmsPages).values(p).onConflictDoNothing();
  for (const b of BANNERS) {
    await db
      .insert(schema.banners)
      .values({ id: sid(6, b.n), placement: b.placement, title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl, sortOrder: b.sortOrder, active: true, startsAt: daysAgo(10), endsAt: daysAhead(60), impressions: between(500, 5000), clicks: between(10, 200) })
      .onConflictDoNothing();
  }

  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.listings).where(and(eq(schema.listings.status, 'ACTIVE')));
  console.log(`✔ admin: ${config.admin.email} / ${config.admin.password}`);
  console.log(`✔ moderator: moderator@evtap.az / Moder12345!`);
  console.log(`✔ demo users: ${DEMO_USERS.length} (password ${DEMO_PASSWORD}, or OTP login by phone), agencies: ${AGENCIES.length}`);
  console.log(`✔ listings: ${created} new (${SPECS.length} demo total, ${c} active in DB)`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
