/**
 * Deterministic fixture data for the dev-only mock mode (VITE_MOCK=1).
 * Shapes follow @evtap/shared DTOs exactly; values are realistic for the AZ market.
 */
import {
  BUNDLES, CITIES, DEFAULT_SETTINGS, DISTRICTS, METRO_STATIONS, PLANS, SERVICE_CATALOG, calcBooking,
  type AdminListing, type AdminUser, type Agency, type AuditLog, type Banner, type Booking, type CmsPage, type ListingImage, type ListingReport,
  type MortgageLead, type Payment, type PaymentPurpose, type PlatformSettings, type Subscription, type WalletTransaction, type Amenity,
} from '@evtap/shared';

// ─────────────────────────── deterministic RNG ───────────────────────────
let seed = 20261013;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => int(0, 15).toString(16));
const NOW = Date.now();
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const daysAgo = (d: number) => ago(d * DAY + int(0, DAY - 1));
const isoDay = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);

// ─────────────────────────── images (inline SVG, works offline) ───────────────────────────
const PALETTES = [
  ['#cfe8e1', '#0e7c66'],
  ['#f3e3c8', '#b5793a'],
  ['#dde6f5', '#3d5f99'],
  ['#efe0ea', '#8b4a74'],
  ['#e4ecd9', '#5b7a35'],
  ['#f1ddd5', '#a8543b'],
];
const svgUri = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
export function photo(kind: number, variant: number) {
  const [bg, fg] = PALETTES[(kind + variant) % PALETTES.length];
  let body = '';
  if (variant % 3 === 0) {
    // building facade
    body = `<rect x='220' y='120' width='360' height='420' fill='${fg}' opacity='.85'/>` +
      Array.from({ length: 24 }, (_, i) => `<rect x='${245 + (i % 4) * 85}' y='${145 + Math.floor(i / 4) * 64}' width='55' height='40' rx='3' fill='${bg}' opacity='${0.55 + ((i * 7) % 5) / 10}'/>`).join('');
  } else if (variant % 3 === 1) {
    // interior: floor, wall, window, sofa
    body = `<rect y='400' width='800' height='200' fill='${fg}' opacity='.35'/><rect x='470' y='110' width='220' height='200' rx='6' fill='#fff' opacity='.8'/><line x1='580' y1='110' x2='580' y2='310' stroke='${fg}' stroke-width='6'/><rect x='90' y='320' width='300' height='110' rx='18' fill='${fg}'/><rect x='110' y='280' width='260' height='70' rx='16' fill='${fg}' opacity='.8'/>`;
  } else {
    // house with roof and garden
    body = `<rect y='450' width='800' height='150' fill='${fg}' opacity='.3'/><polygon points='230,260 400,140 570,260' fill='${fg}'/><rect x='260' y='260' width='280' height='200' fill='${fg}' opacity='.75'/><rect x='370' y='350' width='60' height='110' fill='${bg}'/><rect x='290' y='300' width='55' height='45' fill='${bg}'/><rect x='455' y='300' width='55' height='45' fill='${bg}'/><circle cx='150' cy='420' r='55' fill='${fg}' opacity='.5'/><circle cx='660' cy='410' r='65' fill='${fg}' opacity='.45'/>`;
  }
  return svgUri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'><rect width='800' height='600' fill='${bg}'/>${body}</svg>`);
}
const bannerImage = (title: string, color: string) =>
  svgUri(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 400'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='${color}'/><stop offset='1' stop-color='#0a5c4c'/></linearGradient></defs><rect width='1200' height='400' fill='url(#g)'/><text x='60' y='215' font-family='Inter,Arial' font-size='64' font-weight='700' fill='#fff'>${title}</text><text x='60' y='280' font-family='Inter,Arial' font-size='30' fill='#ffffffcc'>evtap.az</text></svg>`,
  );

// ─────────────────────────── people ───────────────────────────
const FIRST = ['Elvin', 'Aysel', 'Rəşad', 'Günel', 'Kamran', 'Leyla', 'Orxan', 'Nərmin', 'Tural', 'Səbinə', 'Fərid', 'Aynur', 'Murad', 'Lalə', 'Emin', 'Nigar', 'Ramil', 'Könül', 'Vüsal', 'Zeynəb'];
const LAST_M = ['Məmmədov', 'Əliyev', 'Hüseynov', 'Quliyev', 'Həsənov', 'İsmayılov', 'Kərimov', 'Rəhimov', 'Abbasov', 'Nəsirov'];
const fem = new Set(['Aysel', 'Günel', 'Leyla', 'Nərmin', 'Səbinə', 'Aynur', 'Lalə', 'Nigar', 'Könül', 'Zeynəb']);
const personName = () => {
  const f = pick(FIRST);
  const l = pick(LAST_M);
  return `${f} ${fem.has(f) ? l.replace(/ov$/, 'ova').replace(/ev$/, 'eva') : l}`;
};
const phone = () => `+99450${int(1000000, 9999999)}`;
const translit = (s: string) => s.toLowerCase().replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/[^a-z]+/g, '.');

export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const MODERATOR_ID = '00000000-0000-4000-8000-000000000002';
export const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000003';

const AGENCY_NAMES = ['Baku Realty', 'Ev Partner', 'Xəzər Əmlak', 'Premium Estate', 'Nərimanov Əmlak Mərkəzi', 'Port Baku Residence', 'Gəncə Ev', 'Dalğa Construction'];

export const agencies: Agency[] = AGENCY_NAMES.map((name, i) => ({
  id: uuid(),
  name,
  slug: translit(name).replace(/\./g, '-'),
  logoUrl: null,
  type: i === 5 || i === 7 ? 'DEVELOPER' : 'AGENCY',
  verified: i % 3 !== 2,
  description: null,
  phone: phone(),
  email: `info@${translit(name).replace(/\./g, '')}.az`,
  website: null,
  address: null,
  cityId: i === 6 ? 'ganja' : 'baku',
  ownerId: '',
  activeListings: 0,
  createdAt: daysAgo(int(60, 600)),
}));

export const users: AdminUser[] = [];
const mkUser = (over: Partial<AdminUser> = {}): AdminUser => {
  const name = personName();
  const business = chance(0.18);
  const u: AdminUser = {
    id: uuid(),
    name,
    phone: phone(),
    email: chance(0.7) ? `${translit(name)}@mail.az` : null,
    avatarUrl: null,
    role: 'USER',
    accountType: business ? 'BUSINESS' : 'INDIVIDUAL',
    status: chance(0.06) ? 'BLOCKED' : 'ACTIVE',
    locale: pick(['az', 'az', 'ru', 'en'] as const),
    isPhoneVerified: true,
    isEmailVerified: chance(0.5),
    agencyId: null,
    createdAt: daysAgo(int(0, 400)),
    walletBalance: chance(0.5) ? int(0, 30000) : 0,
    activeListings: 0,
    totalSpent: 0,
    lastLoginAt: chance(0.9) ? ago(int(0, 20 * DAY)) : null,
    ...over,
  };
  users.push(u);
  return u;
};
mkUser({ id: ADMIN_ID, name: 'Admin EvTap', email: 'admin@evtap.az', role: 'ADMIN', accountType: 'INDIVIDUAL', status: 'ACTIVE', createdAt: daysAgo(500), walletBalance: 0 });
mkUser({ id: MODERATOR_ID, name: 'Nigar Moderator', email: 'moderator@evtap.az', role: 'MODERATOR', accountType: 'INDIVIDUAL', status: 'ACTIVE', createdAt: daysAgo(300), walletBalance: 0 });
mkUser({ id: PLAIN_USER_ID, name: 'Sadə İstifadəçi', email: 'user@evtap.az', role: 'USER', status: 'ACTIVE' });
for (let i = 0; i < 64; i++) mkUser();
users.filter((u) => u.accountType === 'BUSINESS').forEach((u, i) => {
  const ag = agencies[i % agencies.length];
  u.agencyId = ag.id;
  if (!ag.ownerId) ag.ownerId = u.id;
});

// ─────────────────────────── listings ───────────────────────────
const AMEN: Amenity[] = ['BALCONY', 'PARKING', 'ELEVATOR', 'FURNITURE', 'KITCHEN_FURNITURE', 'INTERNET', 'AIR_CONDITIONER', 'CENTRAL_HEATING', 'KOMBI', 'GAS', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE', 'TV', 'POOL', 'SEA_VIEW', 'BBQ'];
const TEMPLATES = [
  { deal: 'SALE', prop: 'APARTMENT', t: (r: number, d: string) => `${r} otaqlı mənzil, ${d}`, price: () => int(65, 420) * 1000, desc: 'Təmirli, işıqlı mənzil. Metroya 5 dəqiqəlik məsafədə yerləşir. Bütün kommunal xətlər var, sənədlər qaydasındadır. Qiymətdə razılaşmaq mümkündür.' },
  { deal: 'SALE', prop: 'HOUSE', t: (r: number, d: string) => `${r} otaqlı həyət evi, ${d}`, price: () => int(120, 650) * 1000, desc: 'Geniş həyəti olan, iki mərtəbəli ev. Meyvə bağı, qaraj və istirahət guşəsi var. Ailə üçün ideal seçimdir.' },
  { deal: 'RENT_LONG', prop: 'APARTMENT', t: (r: number, d: string) => `Kirayə ${r} otaqlı mənzil, ${d}`, price: () => int(4, 25) * 100, desc: 'Uzunmüddətli kirayə. Mebel və məişət texnikası ilə tam təchiz olunub. Ailəyə və ya tələbələrə verilir.' },
  { deal: 'RENT_DAILY', prop: 'HOUSE', t: () => 'Günlük kirayə kottec, Qəbələ', price: () => int(8, 30) * 10, desc: 'Dağ mənzərəli kottec, hovuz və manqal yeri ilə. Həftəsonu istirahəti üçün ideal. Minimum 2 gecə.' },
  { deal: 'RENT_DAILY', prop: 'APARTMENT', t: (_: number, d: string) => `Dənizkənarı günlük mənzil, ${d}`, price: () => int(6, 18) * 10, desc: 'Bulvara yaxın, dəniz mənzərəli mənzil. Wi-Fi, kondisioner, yeni təmir. Gündəlik və həftəlik kirayə.' },
  { deal: 'SALE', prop: 'OFFICE', t: () => 'Ofis sahəsi, biznes mərkəzində', price: () => int(90, 500) * 1000, desc: 'A sinif biznes mərkəzində ofis. Mühafizə, parkinq, 24/7 giriş. İnvestisiya üçün əlverişlidir.' },
  { deal: 'SALE', prop: 'LAND', t: () => 'Torpaq sahəsi, Mərdəkan', price: () => int(25, 200) * 1000, desc: 'Fərdi yaşayış evi tikintisi üçün torpaq sahəsi. Çıxarış var, kommunikasiyalar yaxındadır.' },
] as const;
const STATUS_PLAN: [AdminListing['status'], number][] = [
  ['PENDING', 16], ['ACTIVE', 48], ['REJECTED', 6], ['BLOCKED', 3], ['EXPIRED', 5], ['DRAFT', 2], ['SOLD', 4], ['ARCHIVED', 2],
];
export type MockListing = AdminListing & {
  description: string; images: ListingImage[]; amenities: Amenity[]; bathrooms: number | null; yearBuilt: number | null; ceilingHeight: number | null;
  repair: 'NONE' | 'COSMETIC' | 'EURO' | 'DESIGNER' | null; maxGuests: number | null; minNights: number | null; checkInTime: string | null; checkOutTime: string | null;
  houseRules: string | null; contactName: string; favoritesCount: number; expiresAt: string | null; agencyId: string | null;
};
export const listings: MockListing[] = [];
const owners = users.filter((u) => u.role === 'USER' && u.status === 'ACTIVE');
let n = 0;
for (const [status, count] of STATUS_PLAN) {
  for (let i = 0; i < count; i++) {
    const tpl = pick(TEMPLATES);
    const daily = tpl.deal === 'RENT_DAILY';
    const city = daily ? pick(['gabala', 'baku', 'guba', 'nabran'] as const) : chance(0.8) ? 'baku' : pick(['sumgait', 'ganja', 'khirdalan'] as const);
    const district = DISTRICTS.filter((d) => d.cityId === city);
    const dist = district.length ? pick(district) : null;
    const metros = METRO_STATIONS.filter((m) => m.cityId === city);
    const rooms = int(1, 5);
    const owner = pick(owners);
    const created = status === 'PENDING' ? ago(int(10, 60 * 30) * 60_000) : daysAgo(int(1, 80));
    const kind = n++;
    const imgCount = int(3, 8);
    const images = Array.from({ length: imgCount }, (_, k) => ({ id: uuid(), url: photo(kind, k), thumbUrl: photo(kind, k), order: k }));
    const area = tpl.prop === 'LAND' ? 600 : int(38, 260);
    const l: MockListing = {
      id: uuid(),
      title: tpl.t(rooms, dist ? dist.name.az.replace(/ r\.$/, '') : (CITIES.find((c) => c.id === city)?.name.az ?? '')),
      dealType: tpl.deal,
      propertyType: tpl.prop,
      buildingType: tpl.prop === 'APARTMENT' ? pick(['NEW', 'SECONDARY'] as const) : null,
      price: tpl.price(),
      currency: chance(0.1) && tpl.deal === 'SALE' ? 'USD' : 'AZN',
      pricePeriod: tpl.deal === 'RENT_LONG' ? 'MONTH' : daily ? 'DAY' : 'TOTAL',
      country: 'AZ',
      cityId: city,
      districtId: dist?.id ?? null,
      metroId: metros.length && chance(0.6) ? pick(metros).id : null,
      address: chance(0.7) ? `${pick(['Ə. Rəcəbli', 'Nizami', 'Azadlıq pr.', 'Atatürk pr.', 'H. Əliyev', 'Bakıxanov'])} küç. ${int(1, 180)}` : null,
      area,
      landArea: tpl.prop === 'HOUSE' || tpl.prop === 'LAND' ? int(3, 20) : null,
      rooms: tpl.prop === 'LAND' || tpl.prop === 'OFFICE' ? null : rooms,
      floor: tpl.prop === 'APARTMENT' ? int(1, 16) : null,
      totalFloors: tpl.prop === 'APARTMENT' ? int(16, 24) : null,
      coverUrl: images[0].url,
      imagesCount: imgCount,
      lat: 40.38 + rnd() * 0.06,
      lng: 49.8 + rnd() * 0.1,
      isVip: status === 'ACTIVE' && chance(0.18),
      isPremium: status === 'ACTIVE' && chance(0.08),
      isHighlighted: status === 'ACTIVE' && chance(0.12),
      isUrgent: status === 'ACTIVE' && chance(0.1),
      isVerified: chance(0.15),
      hasDocument: chance(0.7),
      mortgageAvailable: tpl.deal === 'SALE' && chance(0.4),
      isBusiness: owner.accountType === 'BUSINESS',
      rating: daily && status === 'ACTIVE' ? Math.round((3.8 + rnd() * 1.2) * 10) / 10 : null,
      status,
      bumpedAt: created,
      publishedAt: status === 'ACTIVE' || status === 'SOLD' || status === 'EXPIRED' ? created : null,
      createdAt: created,
      ownerId: owner.id,
      ownerName: owner.name,
      ownerPhone: owner.phone,
      views: status === 'PENDING' ? 0 : int(10, 4200),
      rejectionReason: status === 'REJECTED' ? pick(['Şəkillər uyğun deyil', 'Qiymət real deyil', 'Təkrar elan']) : status === 'BLOCKED' ? 'Saxtakarlıq (fırıldaqçılıq)' : null,
      reportsCount: 0,
      updatedAt: created,
      description: tpl.desc,
      images,
      amenities: AMEN.filter(() => chance(0.3)),
      bathrooms: tpl.prop === 'LAND' ? null : int(1, 3),
      yearBuilt: chance(0.6) ? int(1965, 2024) : null,
      ceilingHeight: chance(0.5) ? 2.7 + int(0, 6) / 10 : null,
      repair: tpl.prop === 'LAND' ? null : pick(['NONE', 'COSMETIC', 'EURO', 'DESIGNER'] as const),
      maxGuests: daily ? int(2, 10) : null,
      minNights: daily ? int(1, 3) : null,
      checkInTime: daily ? '14:00' : null,
      checkOutTime: daily ? '12:00' : null,
      houseRules: daily ? 'Siqaret çəkmək qadağandır. Saat 23:00-dan sonra səs-küy etməyin.' : null,
      contactName: owner.name.split(' ')[0],
      favoritesCount: int(0, 90),
      expiresAt: status === 'ACTIVE' ? new Date(NOW + int(1, 30) * DAY).toISOString() : null,
      agencyId: owner.agencyId,
    };
    listings.push(l);
  }
}
for (const u of users) u.activeListings = listings.filter((l) => l.ownerId === u.id && l.status === 'ACTIVE').length;
for (const a of agencies) a.activeListings = listings.filter((l) => l.agencyId === a.id && l.status === 'ACTIVE').length;

// ─────────────────────────── reports ───────────────────────────
const REPORT_COMMENTS = ['Bu elan artıq satılıb, zəng etdim.', 'Şəkillər başqa saytdan götürülüb.', 'Sahibi deyil, vasitəçidir — komissiya istədi.', 'Qiymət çox aşağıdır, saxta elandır.', null, 'Eyni elan 3 dəfə yerləşdirilib.', 'Ön ödəniş tələb etdi.'];
export const reports: ListingReport[] = Array.from({ length: 22 }, () => {
  const l = pick(listings.filter((x) => x.status === 'ACTIVE' || x.status === 'PENDING'));
  const status = chance(0.55) ? 'OPEN' : pick(['RESOLVED', 'DISMISSED'] as const);
  const reporter = chance(0.7) ? pick(users) : null;
  const created = daysAgo(int(0, 25));
  l.reportsCount++;
  return {
    id: uuid(),
    listingId: l.id,
    listingTitle: l.title,
    reporter: reporter && { id: reporter.id, name: reporter.name },
    reason: pick(['FAKE', 'WRONG_PRICE', 'WRONG_PHOTOS', 'ALREADY_SOLD', 'AGENT_AS_OWNER', 'DUPLICATE', 'FRAUD', 'OTHER'] as const),
    comment: pick(REPORT_COMMENTS),
    status,
    createdAt: created,
    resolvedAt: status === 'OPEN' ? null : new Date(Date.parse(created) + int(1, 48) * 3_600_000).toISOString(),
  };
});

// ─────────────────────────── payments ───────────────────────────
const PURPOSE_WEIGHTS: [PaymentPurpose, number][] = [['PROMOTION', 40], ['WALLET_TOPUP', 18], ['LISTING_FEE', 14], ['BOOKING', 14], ['SUBSCRIPTION', 9], ['VERIFICATION', 5]];
const weighted = () => {
  let r = rnd() * 100;
  for (const [p, w] of PURPOSE_WEIGHTS) if ((r -= w) < 0) return p;
  return 'PROMOTION';
};
export type MockPayment = Payment & { userName: string; providerData: Record<string, unknown> | null };
export const payments: MockPayment[] = [];
for (let i = 0; i < 420; i++) {
  const purpose = weighted();
  const user = pick(users.slice(3));
  const created = daysAgo(Math.floor(Math.pow(rnd(), 1.3) * 95));
  const method = purpose === 'WALLET_TOPUP' || purpose === 'BOOKING' || chance(0.6) ? 'CARD' : 'WALLET';
  let items: Payment['items'] = [];
  let description = '';
  if (purpose === 'PROMOTION') {
    const s = pick(SERVICE_CATALOG.filter((x) => x.promotionType));
    items = [{ code: s.code, name: s.name.az, amount: s.price }];
    description = `${s.name.az}`;
  } else if (purpose === 'WALLET_TOPUP') {
    const a = pick([1000, 2000, 5000, 10000, 20000, 30000]);
    items = [{ code: 'TOPUP', name: 'Balans artırılması', amount: a }];
    description = 'Balans artırılması';
  } else if (purpose === 'LISTING_FEE') {
    items = [{ code: 'LISTING_FEE', name: 'Elan haqqı', amount: DEFAULT_SETTINGS.listingFee }];
    description = 'Elan yerləşdirmə haqqı';
  } else if (purpose === 'BOOKING') {
    const c = calcBooking(int(6, 25) * 10, int(1, 5));
    items = [
      { code: 'SUBTOTAL', name: 'Gecələmə', amount: c.subtotal },
      { code: 'GUEST_FEE', name: 'Xidmət haqqı', amount: c.guestFee },
    ];
    description = 'Günlük kirayə rezervasiyası';
  } else if (purpose === 'SUBSCRIPTION') {
    const p = pick(PLANS);
    items = [{ code: p.code, name: `${p.name.az} plan (aylıq)`, amount: p.priceMonthly }];
    description = `Biznes abunəlik — ${p.name.az}`;
  } else {
    items = [{ code: 'VERIFICATION', name: 'Yoxlanılmış elan', amount: 1500 }];
    description = 'Elanın yoxlanılması';
  }
  const amount = items.reduce((a, it) => a + it.amount, 0);
  const r = rnd();
  const status: Payment['status'] = r < 0.82 ? 'SUCCEEDED' : r < 0.9 ? 'FAILED' : r < 0.93 ? 'PENDING' : r < 0.96 ? 'REFUNDED' : r < 0.98 ? 'PARTIALLY_REFUNDED' : 'CANCELLED';
  const card = method === 'CARD' ? `${pick(['4169', '5239', '4098'])} **** **** ${int(1000, 9999)}` : null;
  payments.push({
    id: uuid(),
    userId: user.id,
    userName: user.name,
    purpose,
    method,
    amount,
    currency: 'AZN',
    status,
    description,
    listingId: purpose === 'PROMOTION' || purpose === 'LISTING_FEE' || purpose === 'VERIFICATION' ? pick(listings).id : null,
    bookingId: null,
    items,
    provider: method === 'CARD' ? 'mockbank' : null,
    providerOrderId: method === 'CARD' ? `MB-${int(100000, 999999)}` : null,
    cardMask: card,
    refundedAmount: status === 'REFUNDED' ? amount : status === 'PARTIALLY_REFUNDED' ? Math.round(amount / 2) : 0,
    failureReason: status === 'FAILED' ? pick(['Insufficient funds', '3-D Secure failed', 'Card expired', 'Declined by issuer']) : null,
    createdAt: created,
    paidAt: status === 'SUCCEEDED' || status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED' ? new Date(Date.parse(created) + 40_000).toISOString() : null,
    providerData: method === 'CARD' ? { orderId: `MB-${int(100000, 999999)}`, rrn: String(int(100000000, 999999999)), approvalCode: String(int(100000, 999999)), threeDs: 'Y', bank: 'MockBank' } : null,
  });
}
payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
for (const u of users) u.totalSpent = payments.filter((p) => p.userId === u.id && p.status === 'SUCCEEDED' && p.purpose !== 'WALLET_TOPUP').reduce((a, p) => a + p.amount, 0);

export const walletTx = (userId: string): WalletTransaction[] => {
  let bal = 0;
  return payments
    .filter((p) => p.userId === userId && p.status === 'SUCCEEDED' && (p.purpose === 'WALLET_TOPUP' || p.method === 'WALLET'))
    .slice()
    .reverse()
    .map((p) => {
      const amount = p.purpose === 'WALLET_TOPUP' ? p.amount : -p.amount;
      bal = Math.max(0, bal + amount);
      return { id: uuid(), type: p.purpose === 'WALLET_TOPUP' ? 'TOPUP' : 'SPEND', amount, balanceAfter: bal, description: p.description, paymentId: p.id, createdAt: p.createdAt } as WalletTransaction;
    })
    .reverse();
};

// ─────────────────────────── bookings ───────────────────────────
const dailyListings = listings.filter((l) => l.dealType === 'RENT_DAILY');
export const bookings: Booking[] = Array.from({ length: 34 }, (): Booking => {
  const l = pick(dailyListings);
  const host = users.find((u) => u.id === l.ownerId)!;
  const guest = pick(users.slice(3));
  const start = int(-40, 40);
  const nights = int(1, 6);
  const c = calcBooking(l.price, nights);
  const past = start + nights < 0;
  const status: Booking['status'] = past ? (chance(0.85) ? 'COMPLETED' : 'CANCELLED') : chance(0.75) ? 'CONFIRMED' : pick(['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'] as const);
  const cancelled = status === 'CANCELLED' || status === 'REFUNDED';
  return {
    id: uuid(),
    listing: { id: l.id, title: l.title, coverUrl: l.coverUrl, cityId: l.cityId, address: l.address },
    guest: { id: guest.id, name: guest.name, phone: guest.phone, avatarUrl: null },
    host: { id: host.id, name: host.name, phone: host.phone, avatarUrl: null },
    checkIn: isoDay(start),
    checkOut: isoDay(start + nights),
    nights,
    guests: int(1, Math.max(1, l.maxGuests ?? 2)),
    nightlyPrice: l.price,
    currency: 'AZN',
    ...c,
    status,
    payoutStatus: status === 'COMPLETED' ? 'PAID' : status === 'CONFIRMED' ? (start < -1 ? 'PENDING' : 'NOT_DUE') : cancelled ? 'CANCELLED' : 'NOT_DUE',
    refundedAmount: status === 'REFUNDED' ? c.total : status === 'CANCELLED' ? Math.round(c.subtotal / 2) : 0,
    paymentId: status === 'PENDING_PAYMENT' ? null : pick(payments.filter((p) => p.purpose === 'BOOKING')).id,
    cancelledBy: cancelled ? pick(['GUEST', 'HOST'] as const) : null,
    cancelReason: cancelled ? pick(['Planlar dəyişdi', 'Ev sahibi cavab vermir', null]) : null,
    canReview: false,
    createdAt: daysAgo(Math.max(0, -start + int(1, 20))),
  };
}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ─────────────────────────── subscriptions ───────────────────────────
export type MockSubscription = Subscription & { user: { id: string; name: string; email: string | null; phone: string | null } | null; agency: Agency | null };
export const subscriptions: MockSubscription[] = users
  .filter((u) => u.accountType === 'BUSINESS')
  .slice(0, 14)
  .map((u) => {
    const plan = pick(PLANS);
    const period = chance(0.25) ? 'YEAR' : 'MONTH';
    const start = daysAgo(int(1, period === 'YEAR' ? 300 : 28));
    const end = new Date(Date.parse(start) + (period === 'YEAR' ? 365 : 30) * DAY).toISOString();
    const status = pick(['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'CANCELLED', 'PAST_DUE', 'EXPIRED'] as const);
    const ag = agencies.find((a) => a.id === u.agencyId) ?? null;
    return {
      id: uuid(),
      planCode: plan.code,
      period,
      status,
      autoRenew: status === 'ACTIVE' || status === 'PAST_DUE',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      usage: {
        activeListings: plan.listingQuota < 0 ? int(40, 300) : int(Math.floor(plan.listingQuota * 0.2), plan.listingQuota),
        listingQuota: plan.listingQuota,
        bumpsLeft: int(0, plan.monthlyBumps),
        vipCreditsLeft: int(0, plan.monthlyVipCredits),
        premiumCreditsLeft: int(0, plan.monthlyPremiumCredits),
      },
      cardMask: `4169 **** **** ${int(1000, 9999)}`,
      user: { id: u.id, name: u.name, email: u.email, phone: u.phone },
      agency: ag,
    };
  });

// ─────────────────────────── content ───────────────────────────
export const banners: Banner[] = [
  { title: 'Kapital Bank ipoteka 7%', placement: 'HOME_TOP', color: '#2a78d6' },
  { title: 'Port Baku Residence — yeni layihə', placement: 'HOME_TOP', color: '#7c3aed' },
  { title: 'Qəbələdə yay endirimləri', placement: 'SEARCH_TOP', color: '#eb6834' },
  { title: 'Daşınma xidməti -20%', placement: 'LISTING_SIDEBAR', color: '#1baf7a' },
  { title: 'EvTap Biznes — ilk ay pulsuz', placement: 'SEARCH_SIDEBAR', color: '#0e7c66' },
  { title: 'Mobil tətbiqi yüklə', placement: 'MOBILE_HOME', color: '#e5484d' },
].map((b, i) => {
  const impressions = int(4000, 90000);
  return {
    id: uuid(),
    placement: b.placement as Banner['placement'],
    title: b.title,
    imageUrl: bannerImage(b.title, b.color),
    linkUrl: `https://evtap.az/promo/${i + 1}`,
    active: i !== 3,
    startsAt: i % 2 ? daysAgo(20) : null,
    endsAt: i % 2 ? new Date(NOW + 25 * DAY).toISOString() : null,
    impressions,
    clicks: Math.round(impressions * (0.004 + rnd() * 0.02)),
    sortOrder: i,
  };
});

export const pages: CmsPage[] = [
  {
    slug: 'about',
    title: { az: 'Haqqımızda', ru: 'О нас', en: 'About us' },
    body: {
      az: '# EvTap haqqında\n\nEvTap — Azərbaycanda daşınmaz əmlak alqı-satqısı, kirayəsi və **günlük kirayə rezervasiyası** üçün platformadır.\n\n- Yoxlanılmış elanlar\n- Onlayn rezervasiya və təhlükəsiz ödəniş\n- Agentliklər üçün biznes alətləri',
      ru: '# О EvTap\n\nEvTap — платформа для покупки, продажи и аренды недвижимости в Азербайджане.',
      en: '# About EvTap\n\nEvTap is a marketplace for buying, selling and renting real estate in Azerbaijan, with **online booking** for daily rentals.\n\n- Verified listings\n- Secure online payments\n- Business tools for agencies',
    },
    updatedAt: daysAgo(12),
  },
  { slug: 'terms', title: { az: 'İstifadə şərtləri', ru: 'Условия использования', en: 'Terms of use' }, body: { az: '## 1. Ümumi müddəalar\n\nPlatformadan istifadə etməklə siz bu şərtləri qəbul edirsiniz.', ru: '## 1. Общие положения\n\nИспользуя платформу, вы принимаете эти условия.', en: '## 1. General\n\nBy using the platform you accept these terms.' }, updatedAt: daysAgo(40) },
  { slug: 'privacy', title: { az: 'Məxfilik siyasəti', ru: 'Политика конфиденциальности', en: 'Privacy policy' }, body: { az: 'Şəxsi məlumatlarınız qorunur.', ru: '', en: 'Your personal data is protected.' }, updatedAt: daysAgo(90) },
  { slug: 'help', title: { az: 'Kömək', ru: 'Помощь', en: '' }, body: { az: '## Elanı necə yerləşdirim?\n\n1. Daxil olun\n2. "Elan yerləşdir" düyməsini basın\n3. Məlumatları doldurun', ru: '', en: '' }, updatedAt: daysAgo(5) },
];

export const leads: MortgageLead[] = Array.from({ length: 18 }, () => {
  const price = int(80, 400) * 1000;
  return {
    id: uuid(),
    name: personName(),
    phone: phone(),
    listingId: chance(0.7) ? pick(listings.filter((l) => l.dealType === 'SALE')).id : null,
    price,
    downPayment: Math.round(price * (0.15 + rnd() * 0.25)),
    termYears: pick([10, 15, 20, 25]),
    bankCode: chance(0.6) ? pick(['KAPITAL', 'PASHA', 'ABB', 'BANK_RESPUBLIKA']) : null,
    status: pick(['NEW', 'NEW', 'SENT_TO_BANK', 'CLOSED'] as const),
    createdAt: daysAgo(int(0, 30)),
  };
}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const ACTIONS: [string, string][] = [
  ['listing.approve', 'listing'], ['listing.reject', 'listing'], ['listing.block', 'listing'], ['listing.update', 'listing'], ['listing.promote', 'listing'],
  ['user.update', 'user'], ['wallet.adjust', 'wallet'], ['payment.refund', 'payment'], ['settings.update', 'settings'], ['service.update', 'service'],
  ['banner.create', 'banner'], ['page.update', 'page'], ['report.resolve', 'report'], ['booking.cancel', 'booking'],
];
export const auditLogs: AuditLog[] = Array.from({ length: 90 }, () => {
  const [action, entity] = pick(ACTIONS);
  const actor = chance(0.9) ? pick(users.slice(0, 2)) : null;
  const entityId = entity === 'listing' ? pick(listings).id : entity === 'user' || entity === 'wallet' ? pick(users).id : entity === 'payment' ? pick(payments).id : entity === 'settings' ? null : uuid();
  const data: Record<string, unknown> =
    action === 'listing.reject' ? { reason: 'Şəkillər uyğun deyil' } : action === 'wallet.adjust' ? { amount: 500, reason: 'Kompensasiya' } : action === 'settings.update' ? { listingFee: { from: 300, to: 400 } } : action === 'payment.refund' ? { amount: 700 } : {};
  return { id: uuid(), actor: actor && { id: actor.id, name: actor.name }, action, entity, entityId, data, ip: actor ? `10.0.${int(0, 9)}.${int(2, 250)}` : null, createdAt: daysAgo(int(0, 40)) };
}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const catalog = {
  services: SERVICE_CATALOG.map((s) => ({ ...s, name: { ...s.name }, description: { ...s.description } })),
  bundles: BUNDLES,
  plans: PLANS.map((p) => ({ ...p })),
};
export const settings: PlatformSettings = { ...DEFAULT_SETTINGS, topupBonuses: DEFAULT_SETTINGS.topupBonuses.map((b) => ({ ...b })) };

// ─────────────────────────── time series ───────────────────────────
const dayList = (days: number) => Array.from({ length: days }, (_, i) => isoDay(i - days + 1));
export function revenueSeries(days: number) {
  return dayList(days).map((date) => {
    const point: Record<string, number | string> = { date };
    let total = 0;
    for (const [purpose] of PURPOSE_WEIGHTS) {
      const v = payments.filter((p) => p.purpose === purpose && p.status === 'SUCCEEDED' && p.createdAt.startsWith(date)).reduce((a, p) => a + p.amount, 0);
      point[purpose] = v;
      total += v;
    }
    point.value = total;
    return point as { date: string; value: number };
  });
}
export function listingSeries(days: number) {
  let s = 7;
  return dayList(days).map((date, i) => {
    s = (s * 9301 + 49297) % 233280;
    const wk = new Date(date).getDay() % 6 === 0 ? 0.6 : 1;
    const created = Math.round((14 + (s / 233280) * 12 + i * 0.05) * wk);
    return { date, value: created, created, published: Math.round(created * 0.82), rejected: Math.round(created * (0.06 + ((s >> 3) % 7) / 100)) };
  });
}
export function userSeries(days: number) {
  let s = 3;
  return dayList(days).map((date, i) => {
    s = (s * 9301 + 49297) % 233280;
    return { date, value: Math.round(22 + (s / 233280) * 18 + i * 0.08) };
  });
}
