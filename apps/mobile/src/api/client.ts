/**
 * Typed API client — one function per endpoint of the contract in `@evtap/shared` (api.ts),
 * each returning the shared DTO. Base: `${API_URL}/api/v1`, Bearer JWT, single-flight refresh on 401.
 */
import type {
  Agency, AgencyInput, ApiError, AppNotification, AuthResponse, Availability, Banner, BannerPlacement, Booking,
  BookingQuote, BookingQuoteInput, Catalog, CheckoutInput, CheckoutResponse, CmsPage, Conversation, CreateBookingInput,
  CreateListingInput, DealType, ListingCard, ListingDetail, ListingSearchQuery, ListingStats, ListingStatus,
  LoginInput, MapPoint, Me, Message, MortgageBank, MortgageLeadInput, MyListing, OtpVerifyInput, Paginated, Payment,
  PublicUser, RegisterInput, ReportReason, Review, SavedSearch, SavedSearchInput, Subscription, UpdateListingInput,
  UpdateMeInput, Upload, User, Wallet, WalletTransaction,
} from '@evtap/shared';
import { API_BASE } from '../config';
import { getCurrentLocale } from '../i18n';
import { getTokens, loadTokens, refreshTokens } from './tokens';

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  messages: string[];
  constructor(status: number, body?: Partial<ApiError>) {
    const messages = body?.message ? (Array.isArray(body.message) ? body.message : [body.message]) : [];
    super(messages[0] ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'NETWORK' : undefined);
    this.messages = messages;
  }
}

type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type Query = Record<string, QueryValue>;

/** Arrays → comma separated (matches the `csv()` preprocessors in listingSearchSchema). */
export const toQueryString = (q?: Query) => {
  if (!q) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v.join(','))}`);
    } else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
};

type Opts = { query?: Query; body?: unknown; auth?: boolean; signal?: AbortSignal };

async function rawFetch(method: string, path: string, opts: Opts, token: string | undefined) {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': getCurrentLocale() };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${API_BASE}${path}${toQueryString(opts.query)}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiRequestError(0, { message: 'Network request failed', code: 'NETWORK' });
  }
}

const parse = async <T,>(res: Response): Promise<T> => {
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiRequestError(res.status, (data ?? {}) as Partial<ApiError>);
  return (data === undefined ? null : data) as T;
};

export async function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  await loadTokens();
  const token = opts.auth === false ? undefined : getTokens()?.accessToken;
  let res = await rawFetch(method, path, opts, token);
  if (res.status === 401 && token) {
    const ok = await refreshTokens();
    if (ok) res = await rawFetch(method, path, opts, getTokens()?.accessToken);
  }
  return parse<T>(res);
}

const get = <T,>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal });
const post = <T,>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} });
const patch = <T,>(path: string, body: unknown) => request<T>('PATCH', path, { body });
const put = <T,>(path: string, body: unknown) => request<T>('PUT', path, { body });
const del = <T,>(path: string) => request<T>('DELETE', path);
const enc = encodeURIComponent;

type Ok = { ok: true };
type PageQ = { page?: number; pageSize?: number };

/**
 * Multipart upload with progress (fetch has no upload progress in RN → XMLHttpRequest).
 * `file` is a local URI (e.g. from expo-image-manipulator).
 */
export async function uploadFile(file: { uri: string; name?: string; type?: string }, onProgress?: (p: number) => void): Promise<Upload> {
  await loadTokens();
  const send = (token?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/uploads`);
      xhr.setRequestHeader('Accept', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.onerror = () => reject(new ApiRequestError(0, { message: 'Network request failed', code: 'NETWORK' }));
      const form = new FormData();
      // React Native FormData accepts { uri, name, type } file descriptors.
      form.append('file', { uri: file.uri, name: file.name ?? 'photo.jpg', type: file.type ?? 'image/jpeg' } as unknown as Blob);
      xhr.send(form);
    });
  let res = await send(getTokens()?.accessToken);
  if (res.status === 401 && (await refreshTokens())) res = await send(getTokens()?.accessToken);
  const data = res.body ? JSON.parse(res.body) : {};
  if (res.status < 200 || res.status >= 300) throw new ApiRequestError(res.status, data);
  onProgress?.(1);
  return data as Upload;
}

export const api = {
  // ── Auth
  requestOtp: (phone: string) => request<{ sent: true; retryAfter: number; devCode?: string }>('POST', '/auth/otp/request', { body: { phone }, auth: false }),
  verifyOtp: (body: OtpVerifyInput) => request<AuthResponse>('POST', '/auth/otp/verify', { body, auth: false }),
  register: (body: RegisterInput) => request<AuthResponse>('POST', '/auth/register', { body, auth: false }),
  login: (body: LoginInput) => request<AuthResponse>('POST', '/auth/login', { body, auth: false }),
  logout: (refreshToken: string) => post<Ok>('/auth/logout', { refreshToken }),
  me: () => get<Me>('/auth/me'),

  // ── Users
  updateMe: (body: UpdateMeInput) => patch<User>('/users/me', body),
  changePassword: (body: { currentPassword?: string; newPassword: string }) => post<Ok>('/users/me/password', body),
  deleteMe: () => del<Ok>('/users/me'),
  registerPushToken: (token: string, platform: 'ios' | 'android' | 'web') => post<Ok>('/users/me/push-tokens', { token, platform }),
  deletePushToken: (token: string) => del<Ok>(`/users/me/push-tokens/${enc(token)}`),
  user: (id: string) => get<PublicUser>(`/users/${id}`),

  // ── Reference data
  catalog: () => get<Catalog>('/catalog'),
  mortgageBanks: () => get<MortgageBank[]>('/mortgage/banks'),
  mortgageLead: (body: MortgageLeadInput) => post<{ id: string }>('/mortgage/leads', body),
  banners: (placement: BannerPlacement) => get<Banner[]>('/banners', { placement }),
  bannerClick: (id: string) => post<Ok>(`/banners/${id}/click`),
  page: (slug: string) => get<CmsPage>(`/pages/${enc(slug)}`),

  // ── Listings
  listings: (q: ListingSearchQuery, signal?: AbortSignal) => get<Paginated<ListingCard>>('/listings', q as Query, signal),
  featured: (q: { kind: 'vip' | 'premium'; dealType?: DealType; cityId?: string; limit?: number }) => get<ListingCard[]>('/listings/featured', q),
  map: (q: ListingSearchQuery & { bbox: string }, signal?: AbortSignal) => get<MapPoint[]>('/listings/map', q as Query, signal),
  listing: (id: string) => get<ListingDetail>(`/listings/${id}`),
  revealPhone: (id: string) => post<{ phone: string }>(`/listings/${id}/phone`),
  similar: (id: string) => get<ListingCard[]>(`/listings/${id}/similar`),
  reviews: (id: string, q: PageQ = {}) => get<Paginated<Review>>(`/listings/${id}/reviews`, q),
  availability: (id: string, from: string, to: string) => get<Availability>(`/listings/${id}/availability`, { from, to }),
  setAvailability: (id: string, blockedDates: string[]) => put<Availability>(`/listings/${id}/availability`, { blockedDates }),
  listingStats: (id: string) => get<ListingStats>(`/listings/${id}/stats`),
  createListing: (body: CreateListingInput) => post<MyListing>('/listings', body),
  updateListing: (id: string, body: UpdateListingInput) => patch<MyListing>(`/listings/${id}`, body),
  listingAction: (id: string, action: 'MARK_SOLD' | 'ARCHIVE' | 'RENEW' | 'RESTORE') => post<MyListing>(`/listings/${id}/actions`, { action }),
  deleteListing: (id: string) => del<Ok>(`/listings/${id}`),
  reportListing: (id: string, body: { reason: ReportReason; comment?: string }) => post<Ok>(`/listings/${id}/report`, body),
  applyCredit: (id: string, credit: 'BUMP' | 'VIP_7' | 'PREMIUM_7') => post<MyListing>(`/listings/${id}/apply-credit`, { credit }),
  myListings: (q: { status?: ListingStatus } & PageQ) => get<Paginated<MyListing>>('/me/listings', q),

  // ── Favorites & saved searches
  favorites: (q: PageQ = {}) => get<Paginated<ListingCard>>('/favorites', q),
  favoriteIds: () => get<string[]>('/favorites/ids'),
  addFavorite: (listingId: string) => post<Ok>(`/favorites/${listingId}`),
  removeFavorite: (listingId: string) => del<Ok>(`/favorites/${listingId}`),
  savedSearches: () => get<SavedSearch[]>('/saved-searches'),
  createSavedSearch: (body: SavedSearchInput) => post<SavedSearch>('/saved-searches', body),
  deleteSavedSearch: (id: string) => del<Ok>(`/saved-searches/${id}`),

  // ── Messaging
  conversations: (q: PageQ = {}) => get<Paginated<Conversation>>('/conversations', q),
  startConversation: (listingId: string, message: string) => post<Conversation>('/conversations', { listingId, message }),
  unreadCount: () => get<{ count: number }>('/conversations/unread-count'),
  messages: (id: string, q: { before?: string; limit?: number } = {}) => get<Message[]>(`/conversations/${id}/messages`, q),
  sendMessage: (id: string, body: string) => post<Message>(`/conversations/${id}/messages`, { body }),
  markRead: (id: string) => post<Ok>(`/conversations/${id}/read`),

  // ── Bookings
  quote: (body: BookingQuoteInput) => request<BookingQuote>('POST', '/bookings/quote', { body }),
  createBooking: (body: CreateBookingInput) => post<{ booking: Booking; checkout: CheckoutResponse }>('/bookings', body),
  bookings: (q: { role: 'guest' | 'host'; status?: string } & PageQ) => get<Paginated<Booking>>('/bookings', q),
  booking: (id: string) => get<Booking>(`/bookings/${id}`),
  cancelBooking: (id: string, reason?: string) => post<Booking>(`/bookings/${id}/cancel`, { reason }),
  reviewBooking: (id: string, body: { rating: number; comment: string }) => post<Review>(`/bookings/${id}/review`, body),
  replyReview: (id: string, reply: string) => post<Review>(`/reviews/${id}/reply`, { reply }),

  // ── Payments, wallet, subscriptions
  checkout: (body: CheckoutInput) => post<CheckoutResponse>('/checkout', body),
  payments: (q: PageQ = {}) => get<Paginated<Payment>>('/payments', q),
  payment: (id: string) => get<Payment>(`/payments/${id}`),
  wallet: () => get<Wallet>('/wallet'),
  walletTransactions: (q: PageQ = {}) => get<Paginated<WalletTransaction>>('/wallet/transactions', q),
  subscription: () => get<Subscription | null>('/subscriptions/me'),
  cancelSubscription: () => post<Subscription>('/subscriptions/me/cancel'),
  resumeSubscription: () => post<Subscription>('/subscriptions/me/resume'),

  // ── Agencies
  agency: (slug: string) => get<Agency>(`/agencies/${enc(slug)}`),
  createAgency: (body: AgencyInput) => post<Agency>('/agencies', body),
  myAgency: () => get<Agency>('/agencies/me'),
  updateMyAgency: (body: Partial<AgencyInput>) => patch<Agency>('/agencies/me', body),

  // ── Notifications
  notifications: (q: PageQ = {}) => get<Paginated<AppNotification>>('/notifications', q),
  readNotification: (id: string) => post<Ok>(`/notifications/${id}/read`),
  readAllNotifications: () => post<Ok>('/notifications/read-all'),
};

export const isApiError = (e: unknown): e is ApiRequestError => e instanceof ApiRequestError;
