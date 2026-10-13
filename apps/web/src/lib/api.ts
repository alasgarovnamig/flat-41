/**
 * Typed API client for the EvTap REST API (contract: packages/shared/src/api.ts).
 * Works in the browser (bearer token from localStorage, single-flight refresh on 401)
 * and on the Next.js server (anonymous SSR fetches with a timeout).
 */
import {
  API_PREFIX,
  type Agency, type AgencyInput, type AgencyMember, type AppNotification, type AuthResponse, type Availability,
  type Banner, type BannerPlacement, type Booking, type BookingQuote, type BookingQuoteInput, type BookingStatus,
  type Catalog, type CheckoutInput, type CheckoutResponse, type CmsPage, type Conversation, type CreateBookingInput,
  type CreateListingInput, type ListingCard, type ListingDetail, type ListingSearchQuery, type ListingStats,
  type ListingStatus, type LoginInput, type MapPoint, type Me, type Message, type MortgageBank, type MortgageLeadInput,
  type MyListing, type OtpRequestInput, type OtpVerifyInput, type Paginated, type Payment, type PublicUser,
  type RegisterInput, type ReportReason, type Review, type SavedSearch, type SavedSearchInput, type Subscription,
  type TimeseriesPoint, type UpdateListingInput, type UpdateMeInput, type Upload, type User, type Wallet,
  type WalletTransaction, type DealType, type AgencyType, type Locale, type PaymentMethod,
} from '@evtap/shared';
import { API_URL, SERVER_API_URL } from './config';
import { tokenStore } from './tokens';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly messages: string[];
  constructor(status: number, code: string | undefined, message: string | string[]) {
    const list = Array.isArray(message) ? message : [message];
    super(list.join('; ') || `HTTP ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.messages = list;
  }
}

export const isApiError = (e: unknown): e is ApiRequestError => e instanceof ApiRequestError;

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export function toSearchParams(q: Query | undefined): URLSearchParams {
  const sp = new URLSearchParams();
  if (!q) return sp;
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
    } else sp.set(k, String(v));
  }
  return sp;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  /** attach the bearer token when available (default true) */
  auth?: boolean;
  signal?: AbortSignal;
}

const isServer = () => typeof window === 'undefined';
const base = () => (isServer() ? SERVER_API_URL : API_URL) + API_PREFIX;

// ───────── token refresh (single-flight) ─────────
let refreshing: Promise<boolean> | null = null;
const authListeners = new Set<() => void>();
/** Called when the session is irrecoverably lost (refresh failed). */
export const onSessionExpired = (fn: () => void) => {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
};

export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = tokenStore.refresh;
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${base()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 400 || res.status === 403) {
          tokenStore.clear();
          authListeners.forEach((l) => l());
        }
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      tokenStore.set(data);
      return true;
    } catch {
      return false; // network error: keep tokens, caller will surface the error
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function parseError(res: Response): Promise<ApiRequestError> {
  try {
    const body = (await res.json()) as { code?: string; message?: string | string[]; error?: string };
    return new ApiRequestError(res.status, body.code, body.message ?? body.error ?? res.statusText);
  } catch {
    return new ApiRequestError(res.status, undefined, res.statusText || `HTTP ${res.status}`);
  }
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const qs = toSearchParams(opts.query).toString();
  const url = `${base()}${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = opts.auth === false || isServer() ? null : tokenStore.access;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      signal: opts.signal ?? (isServer() ? AbortSignal.timeout(8000) : undefined),
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' && !isServer()) throw e;
    throw new ApiRequestError(0, 'NETWORK_ERROR', (e as Error)?.message || 'Network error');
  }
  if (res.status === 401 && token && !retried && !path.startsWith('/auth/')) {
    const ok = await refreshSession();
    if (ok) return request<T>(method, path, opts, true);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Multipart upload with progress (XHR) — POST /uploads. */
export function uploadFile(file: File, onProgress?: (pct: number) => void, retried = false): Promise<Upload> {
  return new Promise<Upload>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base()}/uploads`);
    const token = tokenStore.access;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiRequestError(0, 'NETWORK_ERROR', 'Network error'));
    xhr.onload = async () => {
      if (xhr.status === 401 && token && !retried) {
        if (await refreshSession()) return uploadFile(file, onProgress, true).then(resolve, reject);
      }
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Upload);
      else {
        const b = (data ?? {}) as { code?: string; message?: string | string[] };
        reject(new ApiRequestError(xhr.status, b.code, b.message ?? `HTTP ${xhr.status}`));
      }
    };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

const get = <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'query'>) => request<T>('GET', path, { ...opts, query });
const post = <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body: body ?? {} });
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body });
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, { body });
const del = <T>(path: string) => request<T>('DELETE', path);
const enc = encodeURIComponent;

export type Ok = { ok: true };
export type PageQuery = { page?: number; pageSize?: number };
export type FeaturedQuery = { kind: 'vip' | 'premium'; dealType?: DealType; cityId?: string; limit?: number };
export type ListingAction = 'MARK_SOLD' | 'ARCHIVE' | 'RENEW' | 'RESTORE';
export type CreditKind = 'BUMP' | 'VIP_7' | 'PREMIUM_7';
export interface AgencyStats { views: number; phoneViews: number; messages: number; listings: number; daily: TimeseriesPoint[] }
export interface CmsPageLink { slug: string; title: string }
export interface LocationsResponse { countries: unknown[]; cities: unknown[]; districts: unknown[]; metroStations: unknown[] }

export const api = {
  auth: {
    requestOtp: (b: OtpRequestInput) => post<{ sent: true; retryAfter: number; devCode?: string }>('/auth/otp/request', b, { auth: false }),
    verifyOtp: (b: OtpVerifyInput) => post<AuthResponse>('/auth/otp/verify', b, { auth: false }),
    register: (b: RegisterInput) => post<AuthResponse>('/auth/register', b, { auth: false }),
    login: (b: LoginInput) => post<AuthResponse>('/auth/login', b, { auth: false }),
    logout: (refreshToken: string) => post<Ok>('/auth/logout', { refreshToken }),
    me: () => get<Me>('/auth/me'),
  },
  users: {
    updateMe: (b: UpdateMeInput) => patch<User>('/users/me', b),
    changePassword: (b: { currentPassword?: string; newPassword: string }) => post<Ok>('/users/me/password', b),
    deleteMe: () => del<Ok>('/users/me'),
    get: (id: string) => get<PublicUser>(`/users/${enc(id)}`),
  },
  ref: {
    locations: () => get<LocationsResponse>('/locations'),
    catalog: () => get<Catalog>('/catalog'),
    mortgageBanks: () => get<MortgageBank[]>('/mortgage/banks'),
    mortgageLead: (b: MortgageLeadInput) => post<{ id: string }>('/mortgage/leads', b),
    banners: (placement: BannerPlacement) => get<Banner[]>('/banners', { placement }),
    bannerClick: (id: string) => post<Ok>(`/banners/${enc(id)}/click`),
    page: (slug: string) => get<CmsPage>(`/pages/${enc(slug)}`),
    /** CMS page index for the footer / page nav — titles localised by ?locale */
    pages: (locale: Locale) => get<CmsPageLink[]>('/pages', { locale }),
  },
  upload: uploadFile,
  listings: {
    search: (q: ListingSearchQuery) => get<Paginated<ListingCard>>('/listings', q as Query),
    featured: (q: FeaturedQuery) => get<ListingCard[]>('/listings/featured', q),
    map: (q: ListingSearchQuery & { bbox: string }) => get<MapPoint[]>('/listings/map', q as Query),
    get: (id: string) => get<ListingDetail>(`/listings/${enc(id)}`),
    phone: (id: string) => post<{ phone: string }>(`/listings/${enc(id)}/phone`),
    similar: (id: string) => get<ListingCard[]>(`/listings/${enc(id)}/similar`),
    reviews: (id: string, q?: PageQuery) => get<Paginated<Review>>(`/listings/${enc(id)}/reviews`, q),
    availability: (id: string, q: { from: string; to: string }) => get<Availability>(`/listings/${enc(id)}/availability`, q),
    setAvailability: (id: string, blockedDates: string[]) => put<Availability>(`/listings/${enc(id)}/availability`, { blockedDates }),
    stats: (id: string) => get<ListingStats>(`/listings/${enc(id)}/stats`),
    create: (b: CreateListingInput) => post<MyListing>('/listings', b),
    update: (id: string, b: UpdateListingInput) => patch<MyListing>(`/listings/${enc(id)}`, b),
    action: (id: string, action: ListingAction) => post<MyListing>(`/listings/${enc(id)}/actions`, { action }),
    remove: (id: string) => del<Ok>(`/listings/${enc(id)}`),
    report: (id: string, b: { reason: ReportReason; comment?: string }) => post<Ok>(`/listings/${enc(id)}/report`, b),
    applyCredit: (id: string, credit: CreditKind) => post<MyListing>(`/listings/${enc(id)}/apply-credit`, { credit }),
    mine: (q: { status?: ListingStatus } & PageQuery) => get<Paginated<MyListing>>('/me/listings', q),
  },
  favorites: {
    list: (q?: PageQuery) => get<Paginated<ListingCard>>('/favorites', q),
    ids: () => get<string[]>('/favorites/ids'),
    add: (listingId: string) => post<Ok>(`/favorites/${enc(listingId)}`),
    remove: (listingId: string) => del<Ok>(`/favorites/${enc(listingId)}`),
  },
  savedSearches: {
    list: () => get<SavedSearch[]>('/saved-searches'),
    create: (b: SavedSearchInput) => post<SavedSearch>('/saved-searches', b),
    update: (id: string, b: { name?: string; notify?: boolean }) => patch<SavedSearch>(`/saved-searches/${enc(id)}`, b),
    remove: (id: string) => del<Ok>(`/saved-searches/${enc(id)}`),
  },
  conversations: {
    list: (q?: PageQuery) => get<Paginated<Conversation>>('/conversations', q),
    start: (b: { listingId: string; message: string }) => post<Conversation>('/conversations', b),
    unreadCount: () => get<{ count: number }>('/conversations/unread-count'),
    /** thread header (participant only) */
    get: (id: string) => get<Conversation>(`/conversations/${enc(id)}`),
    messages: (id: string, q?: { before?: string; limit?: number }) => get<Message[]>(`/conversations/${enc(id)}/messages`, q),
    send: (id: string, body: string) => post<Message>(`/conversations/${enc(id)}/messages`, { body }),
    read: (id: string) => post<Ok>(`/conversations/${enc(id)}/read`),
  },
  bookings: {
    quote: (b: BookingQuoteInput) => post<BookingQuote>('/bookings/quote', b, { auth: false }),
    create: (b: CreateBookingInput) => post<{ booking: Booking; checkout: CheckoutResponse }>('/bookings', b),
    list: (q: { role: 'guest' | 'host'; status?: BookingStatus } & PageQuery) => get<Paginated<Booking>>('/bookings', q),
    get: (id: string) => get<Booking>(`/bookings/${enc(id)}`),
    /** resume payment of a PENDING_PAYMENT booking (hold not expired) */
    pay: (id: string, b: { method: PaymentMethod; returnUrl?: string }) => post<CheckoutResponse>(`/bookings/${enc(id)}/pay`, b),
    cancel: (id: string, reason?: string) => post<Booking>(`/bookings/${enc(id)}/cancel`, { reason }),
    review: (id: string, b: { rating: number; comment: string }) => post<Review>(`/bookings/${enc(id)}/review`, b),
    replyReview: (reviewId: string, reply: string) => post<Review>(`/reviews/${enc(reviewId)}/reply`, { reply }),
  },
  payments: {
    checkout: (b: CheckoutInput) => post<CheckoutResponse>('/checkout', b),
    list: (q?: PageQuery) => get<Paginated<Payment>>('/payments', q),
    get: (id: string) => get<Payment>(`/payments/${enc(id)}`),
  },
  wallet: {
    get: () => get<Wallet>('/wallet'),
    transactions: (q?: PageQuery) => get<Paginated<WalletTransaction>>('/wallet/transactions', q),
  },
  subscriptions: {
    me: () => get<Subscription | null>('/subscriptions/me'),
    cancel: () => post<Subscription>('/subscriptions/me/cancel'),
    resume: () => post<Subscription>('/subscriptions/me/resume'),
  },
  agencies: {
    list: (q: { type?: AgencyType; cityId?: string; q?: string } & PageQuery) => get<Paginated<Agency>>('/agencies', q),
    get: (slug: string) => get<Agency>(`/agencies/${enc(slug)}`),
    create: (b: AgencyInput) => post<Agency>('/agencies', b),
    me: () => get<Agency>('/agencies/me'),
    updateMe: (b: Partial<AgencyInput>) => patch<Agency>('/agencies/me', b),
    members: () => get<AgencyMember[]>('/agencies/me/members'),
    addMember: (login: string) => post<AgencyMember>('/agencies/me/members', { login }),
    removeMember: (userId: string) => del<Ok>(`/agencies/me/members/${enc(userId)}`),
    stats: (days = 30) => get<AgencyStats>('/agencies/me/stats', { days }),
  },
  notifications: {
    list: (q?: PageQuery) => get<Paginated<AppNotification>>('/notifications', q),
    read: (id: string) => post<Ok>(`/notifications/${enc(id)}/read`),
    readAll: () => post<Ok>('/notifications/read-all'),
  },
};

export type { Locale };
