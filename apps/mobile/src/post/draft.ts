import {
  createListingSchema, type Amenity, type CreateListingInput, type Currency, type DealType, type ListingDetail, type PropertyType, type RepairType,
} from '@evtap/shared';
import { toLocalDigits } from '../lib/phone';

export type Photo = { key: string; localUri?: string; uploadId?: string; url?: string; progress: number; error?: boolean };

/** Wizard state. Numeric inputs stay strings until submit. */
export type Draft = {
  dealType: DealType | null;
  propertyType: PropertyType | null;
  buildingType: 'NEW' | 'SECONDARY' | null;
  cityId: string | null;
  districtId: string | null;
  metroId: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  area: string;
  landArea: string;
  rooms: string;
  bathrooms: string;
  floor: string;
  totalFloors: string;
  yearBuilt: string;
  ceilingHeight: string;
  repair: RepairType | null;
  hasDocument: boolean;
  mortgageAvailable: boolean;
  amenities: Amenity[];
  maxGuests: string;
  minNights: string;
  checkInTime: string;
  checkOutTime: string;
  houseRules: string;
  photos: Photo[];
  price: string;
  currency: Currency;
  title: string;
  description: string;
  contactName: string;
  contactPhone: string; // national digits after +994
};

export const emptyDraft = (contactName = '', phone: string | null = null): Draft => ({
  dealType: null, propertyType: null, buildingType: null, cityId: 'baku', districtId: null, metroId: null, address: '', lat: null, lng: null,
  area: '', landArea: '', rooms: '', bathrooms: '', floor: '', totalFloors: '', yearBuilt: '', ceilingHeight: '', repair: null,
  hasDocument: false, mortgageAvailable: false, amenities: [], maxGuests: '', minNights: '', checkInTime: '14:00', checkOutTime: '12:00', houseRules: '',
  photos: [], price: '', currency: 'AZN', title: '', description: '', contactName, contactPhone: toLocalDigits(phone),
});

const s = (n: number | null | undefined) => (n == null ? '' : String(n));

/** Edit mode: ListingDetail → Draft. ListingImage ids are assumed to be the upload ids (contract gap, see README). */
export const draftFromListing = (l: ListingDetail, fallbackPhone: string | null): Draft => ({
  dealType: l.dealType, propertyType: l.propertyType, buildingType: l.buildingType, cityId: l.cityId, districtId: l.districtId, metroId: l.metroId,
  address: l.address ?? '', lat: l.lat, lng: l.lng, area: s(l.area), landArea: s(l.landArea), rooms: s(l.rooms), bathrooms: s(l.bathrooms),
  floor: s(l.floor), totalFloors: s(l.totalFloors), yearBuilt: s(l.yearBuilt), ceilingHeight: s(l.ceilingHeight), repair: l.repair,
  hasDocument: l.hasDocument, mortgageAvailable: l.mortgageAvailable, amenities: l.amenities, maxGuests: s(l.maxGuests), minNights: s(l.minNights),
  checkInTime: l.checkInTime ?? '14:00', checkOutTime: l.checkOutTime ?? '12:00', houseRules: l.houseRules ?? '',
  photos: [...l.images].sort((a, b) => a.order - b.order).map((i) => ({ key: i.id, uploadId: i.id, url: i.thumbUrl || i.url, progress: 1 })),
  price: s(l.price), currency: l.currency, title: l.title, description: l.description, contactName: l.contactName,
  // ListingDetail only exposes a masked phone → prefill from the user's own number (contract gap).
  contactPhone: toLocalDigits(fallbackPhone),
});

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const int = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)));

export function toInput(d: Draft): Record<string, unknown> {
  const daily = d.dealType === 'RENT_DAILY';
  return {
    dealType: d.dealType ?? undefined,
    propertyType: d.propertyType ?? undefined,
    buildingType: d.propertyType === 'APARTMENT' ? d.buildingType : null,
    title: d.title,
    description: d.description,
    price: int(d.price) ?? undefined,
    currency: d.currency,
    cityId: d.cityId ?? undefined,
    districtId: d.districtId,
    metroId: d.metroId,
    address: d.address.trim() || null,
    lat: d.lat,
    lng: d.lng,
    area: num(d.area) ?? undefined,
    landArea: num(d.landArea),
    rooms: int(d.rooms),
    bathrooms: int(d.bathrooms),
    floor: int(d.floor),
    totalFloors: int(d.totalFloors),
    yearBuilt: int(d.yearBuilt),
    ceilingHeight: num(d.ceilingHeight),
    repair: d.repair,
    hasDocument: d.hasDocument,
    mortgageAvailable: d.mortgageAvailable,
    amenities: d.amenities,
    maxGuests: daily ? int(d.maxGuests) : null,
    minNights: daily ? int(d.minNights) : null,
    checkInTime: daily && d.checkInTime ? d.checkInTime : null,
    checkOutTime: daily && d.checkOutTime ? d.checkOutTime : null,
    houseRules: daily ? d.houseRules.trim() || null : null,
    contactName: d.contactName,
    contactPhone: d.contactPhone ? `+994${d.contactPhone}` : '',
    imageIds: d.photos.filter((p) => p.uploadId).map((p) => p.uploadId),
  };
}

export const STEP_FIELDS: string[][] = [
  ['dealType', 'propertyType', 'buildingType'],
  ['cityId', 'districtId', 'metroId', 'address', 'lat', 'lng'],
  ['area', 'landArea', 'rooms', 'bathrooms', 'floor', 'totalFloors', 'yearBuilt', 'ceilingHeight', 'repair', 'amenities', 'maxGuests', 'minNights', 'checkInTime', 'checkOutTime', 'houseRules'],
  ['imageIds'],
  ['price', 'currency', 'title', 'description', 'contactName', 'contactPhone'],
  [],
];

/** Validate with the shared createListingSchema; returns field → message and the parsed input. */
export function validate(d: Draft): { errors: Record<string, string>; data?: CreateListingInput } {
  const input = toInput(d);
  const r = createListingSchema.safeParse(input);
  if (r.success) return { errors: {}, data: r.data as CreateListingInput };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? '');
    if (k && !errors[k]) errors[k] = issue.message;
  }
  // Mirror the schema's cross-field refinements: zod skips them while other fields are still invalid,
  // but the wizard validates step by step and needs them early.
  const v = input as { dealType?: string; propertyType?: string; rooms?: number | null; maxGuests?: number | null; floor?: number | null; totalFloors?: number | null };
  if (v.dealType === 'RENT_DAILY' && !v.maxGuests) errors.maxGuests ??= 'Required for daily rent';
  if (v.floor != null && v.totalFloors != null && v.floor > v.totalFloors) errors.floor ??= 'Floor cannot exceed total floors';
  if (['APARTMENT', 'HOUSE', 'ROOM'].includes(v.propertyType ?? '') && v.rooms == null) errors.rooms ??= 'Rooms required';
  return { errors };
}

export const firstStepWithError = (errors: Record<string, string>) => {
  const idx = STEP_FIELDS.findIndex((fields) => fields.some((f) => errors[f]));
  return idx === -1 ? null : idx;
};
