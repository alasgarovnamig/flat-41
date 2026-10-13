import { listingSearchSchema, type ListingSearchParsed, type ListingSearchQuery } from '@evtap/shared';
import { toSearchParams, type Query } from './api';

/** Search state = parsed ListingSearchQuery (arrays for csv fields). */
export type SearchState = Partial<ListingSearchParsed>;

const ARRAY_KEYS = ['propertyType', 'districtId', 'metroId', 'rooms', 'repair', 'amenities'] as const;
const DEFAULTS: Record<string, unknown> = { sort: 'date_desc', page: 1, pageSize: 24 };

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function toRecord(input: RawParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (input instanceof URLSearchParams) input.forEach((v, k) => (out[k] = v));
  else for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = Array.isArray(v) ? v.join(',') : v;
  return out;
}

/** Parse URL params with the shared zod schema; invalid params are dropped instead of failing the whole search. */
export function parseSearchState(input: RawParams): SearchState {
  const raw = toRecord(input);
  for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = listingSearchSchema.safeParse(raw);
    if (r.success) return r.data;
    const bad = new Set(r.error.issues.map((i) => String(i.path[0])));
    if (!bad.size) break;
    bad.forEach((k) => delete raw[k]);
  }
  return { sort: 'date_desc', page: 1, pageSize: 24 };
}

/** Compact query object (no empty values / defaults) for the API and URL. */
export function stateToQuery(s: SearchState, opts: { keepPaging?: boolean } = {}): Query {
  const q: Query = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (!opts.keepPaging && DEFAULTS[k] === v) continue;
    q[k] = v as Query[string];
  }
  return q;
}

export const stateToSearch = (s: SearchState) => toSearchParams(stateToQuery(s)).toString();

/** For API calls: the state as ListingSearchQuery. */
export const stateToApi = (s: SearchState): ListingSearchQuery => stateToQuery(s, { keepPaging: true }) as unknown as ListingSearchQuery;

export const countActiveFilters = (s: SearchState) =>
  Object.entries(s).filter(([k, v]) => !['sort', 'page', 'pageSize', 'dealType', 'q'].includes(k) && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0)).length;

export { ARRAY_KEYS };
