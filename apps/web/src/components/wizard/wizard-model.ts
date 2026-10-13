import type { Amenity, CreateListingInput, Currency, DealType, ListingDetail, PropertyType, RepairType } from '@evtap/shared';
import type { Photo } from './PhotoUploader';

export interface WizardForm {
  dealType: DealType;
  propertyType: PropertyType;
  buildingType: 'NEW' | 'SECONDARY' | null;
  cityId: string;
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
  price: string;
  currency: Currency;
  title: string;
  description: string;
  contactName: string;
  contactPhone: string;
  photos: Photo[];
}

export const STEPS = ['type', 'location', 'details', 'photos', 'price', 'review'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_FIELDS: Record<Exclude<Step, 'review'>, string[]> = {
  type: ['dealType', 'propertyType', 'buildingType'],
  location: ['cityId', 'districtId', 'metroId', 'address', 'lat', 'lng'],
  details: ['area', 'landArea', 'rooms', 'bathrooms', 'floor', 'totalFloors', 'yearBuilt', 'ceilingHeight', 'repair', 'hasDocument', 'mortgageAvailable', 'amenities', 'maxGuests', 'minNights', 'checkInTime', 'checkOutTime', 'houseRules'],
  photos: ['imageIds'],
  price: ['price', 'currency', 'title', 'description', 'contactName', 'contactPhone'],
};

export const emptyForm = (): WizardForm => ({
  dealType: 'SALE',
  propertyType: 'APARTMENT',
  buildingType: null,
  cityId: 'baku',
  districtId: null,
  metroId: null,
  address: '',
  lat: null,
  lng: null,
  area: '',
  landArea: '',
  rooms: '',
  bathrooms: '',
  floor: '',
  totalFloors: '',
  yearBuilt: '',
  ceilingHeight: '',
  repair: null,
  hasDocument: false,
  mortgageAvailable: false,
  amenities: [],
  maxGuests: '',
  minNights: '',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  houseRules: '',
  price: '',
  currency: 'AZN',
  title: '',
  description: '',
  contactName: '',
  contactPhone: '',
  photos: [],
});

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const int = (s: string) => (s.trim() === '' ? null : Math.round(Number(s)));
const str = (s: string) => (s.trim() === '' ? null : s.trim());

/** Wizard state → API body (validated with the shared createListingSchema). */
export function toInput(f: WizardForm): CreateListingInput {
  const daily = f.dealType === 'RENT_DAILY';
  const hasRooms = ['APARTMENT', 'HOUSE', 'ROOM', 'OFFICE'].includes(f.propertyType);
  const hasFloor = ['APARTMENT', 'OFFICE', 'COMMERCIAL', 'ROOM'].includes(f.propertyType);
  return {
    dealType: f.dealType,
    propertyType: f.propertyType,
    buildingType: f.propertyType === 'APARTMENT' ? f.buildingType : null,
    title: f.title,
    description: f.description,
    price: int(f.price) ?? (undefined as unknown as number),
    currency: f.currency,
    cityId: f.cityId,
    districtId: f.districtId,
    metroId: f.metroId,
    address: str(f.address),
    lat: f.lat,
    lng: f.lng,
    area: num(f.area) ?? (undefined as unknown as number),
    landArea: ['HOUSE', 'LAND', 'COMMERCIAL'].includes(f.propertyType) ? num(f.landArea) : null,
    rooms: hasRooms ? int(f.rooms) : null,
    bathrooms: hasRooms ? int(f.bathrooms) : null,
    floor: hasFloor ? int(f.floor) : null,
    totalFloors: hasFloor || f.propertyType === 'HOUSE' ? int(f.totalFloors) : null,
    yearBuilt: int(f.yearBuilt),
    ceilingHeight: num(f.ceilingHeight),
    repair: f.propertyType === 'LAND' ? null : f.repair,
    hasDocument: f.hasDocument,
    mortgageAvailable: f.dealType === 'SALE' ? f.mortgageAvailable : false,
    amenities: f.amenities,
    maxGuests: daily ? int(f.maxGuests) : null,
    minNights: daily ? int(f.minNights) : null,
    checkInTime: daily ? str(f.checkInTime) : null,
    checkOutTime: daily ? str(f.checkOutTime) : null,
    houseRules: daily ? str(f.houseRules) : null,
    contactName: f.contactName,
    contactPhone: f.contactPhone,
    imageIds: f.photos.filter((p) => p.id).map((p) => p.id!),
  };
}

const s = (v: number | null | undefined) => (v == null ? '' : String(v));

/** Existing listing → wizard state (edit mode). */
export function fromListing(l: ListingDetail, phone: string): WizardForm {
  return {
    dealType: l.dealType,
    propertyType: l.propertyType,
    buildingType: l.buildingType,
    cityId: l.cityId,
    districtId: l.districtId,
    metroId: l.metroId,
    address: l.address ?? '',
    lat: l.lat,
    lng: l.lng,
    area: s(l.area),
    landArea: s(l.landArea),
    rooms: s(l.rooms),
    bathrooms: s(l.bathrooms),
    floor: s(l.floor),
    totalFloors: s(l.totalFloors),
    yearBuilt: s(l.yearBuilt),
    ceilingHeight: s(l.ceilingHeight),
    repair: l.repair,
    hasDocument: l.hasDocument,
    mortgageAvailable: l.mortgageAvailable,
    amenities: l.amenities,
    maxGuests: s(l.maxGuests),
    minNights: s(l.minNights),
    checkInTime: l.checkInTime ?? '',
    checkOutTime: l.checkOutTime ?? '',
    houseRules: l.houseRules ?? '',
    price: s(l.price),
    currency: l.currency,
    title: l.title,
    description: l.description,
    contactName: l.contactName,
    contactPhone: phone,
    photos: [...l.images].sort((a, b) => a.order - b.order).map((i) => ({ key: i.id, id: i.id, url: i.url, thumbUrl: i.thumbUrl })),
  };
}
