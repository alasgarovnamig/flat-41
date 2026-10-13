/**
 * Typed fetch client for the EvTap API. One function per endpoint used by the admin,
 * returning the DTOs from @evtap/shared (contract: packages/shared/src/api.ts).
 *
 * Auth: Bearer access token; on 401 a single-flight POST /auth/refresh is made and the request retried once.
 * If the refresh fails the session is cleared and `onSessionExpired` listeners fire.
 */
import type {
  AdminOverview, AdminListing, AdminUser, Agency, AgencySummary, ApiError, AuditLog, AuthResponse, Banner, BannerInput, Booking, Catalog,
  City, CmsPage, CmsPageInput, Country, District, ListingDetail, ListingReport, LoginInput, Me, MetroStation, MortgageLead,
  MortgageLeadStatus, Paginated, Payment, PlanDef, PlatformSettings, ReportStatus, ServiceDef, SettingsUpdateInput, Subscription,
  TimeseriesPoint, UpdateListingInput, Upload, UserRole, UserStatus, Wallet, WalletTransaction,
  adminBookingQuerySchema, adminListingQuerySchema, adminPaymentQuerySchema, adminUserQuerySchema, planUpdateSchema, serviceUpdateSchema,
} from '@evtap/shared';
import type { z } from 'zod';
import { API_BASE } from '../env';

// ─────────────────────────── Types not spelled out in shared ───────────────────────────
export type AdminListingQuery = z.input<typeof adminListingQuerySchema>;
export type AdminUserQuery = z.input<typeof adminUserQuerySchema>;
export type AdminPaymentQuery = z.input<typeof adminPaymentQuerySchema>;
export type AdminBookingQuery = z.input<typeof adminBookingQuerySchema>;
export type ServiceUpdate = z.input<typeof serviceUpdateSchema>;
export type PlanUpdate = z.input<typeof planUpdateSchema>;
export type PageQuery = { page?: number; pageSize?: number };

export type AdminListingDetail = ListingDetail & { reports: ListingReport[]; ownerPhone: string | null };
export type AdminUserDetail = AdminUser & { listings: AdminListing[]; payments: Payment[]; walletTransactions: WalletTransaction[] };
export type AdminPaymentRow = Payment & { userName: string | null };
/** `user` / `providerData` shapes are not specified by the contract — treated loosely. */
export type AdminPaymentUser = { id: string; name: string; email?: string | null; phone?: string | null };
export type AdminPaymentDetail = Payment & { user: AdminPaymentUser | null; providerData: Record<string, unknown> | null };
export type AdminSubscriptionRow = Subscription & {
  user: { id: string; name: string; email?: string | null; phone?: string | null } | null;
  agency: AgencySummary | null;
};
export type AdminListingUpdate = UpdateListingInput & { isVerified?: boolean };
export type BroadcastAudience = 'ALL' | 'BUSINESS' | 'INDIVIDUAL';
export type LocationsResponse = { countries: Country[]; cities: City[]; districts: District[]; metroStations: MetroStation[] };

// ─────────────────────────── Errors ───────────────────────────
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly messages: string[];
  constructor(status: number, body: Partial<ApiError> | null, fallback: string) {
    const msgs = body?.message == null ? [fallback] : Array.isArray(body.message) ? body.message : [body.message];
    super(msgs.join('; '));
    this.status = status;
    this.code = body?.code;
    this.messages = msgs;
  }
  /** Nest answers unknown routes with 404 "Cannot GET /…": the endpoint isn't implemented yet. */
  get isNotImplemented() {
    return this.status === 404 && /^Cannot (GET|POST|PATCH|PUT|DELETE)/.test(this.message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─────────────────────────── Token storage ───────────────────────────
const TOKENS_KEY = 'evtap.admin.tokens';
type StoredTokens = { accessToken: string; refreshToken: string };

export const tokens = {
  get(): StoredTokens | null {
    try {
      const raw = localStorage.getItem(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  },
  set(t: StoredTokens) {
    try {
      localStorage.setItem(TOKENS_KEY, JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken }));
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKENS_KEY);
    } catch {
      /* ignore */
    }
  },
};

const expiredListeners = new Set<() => void>();
export const onSessionExpired = (fn: () => void) => {
  expiredListeners.add(fn);
  return () => void expiredListeners.delete(fn);
};

// ─────────────────────────── Core request ───────────────────────────
type Query = Record<string, string | number | boolean | null | undefined>;
type ReqOpts = { query?: object; body?: unknown; form?: FormData; auth?: boolean; retry?: boolean; signal?: AbortSignal };

const qs = (query?: object) => {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one POST /auth/refresh. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const t = tokens.get();
    if (!t?.refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: t.refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as AuthResponse;
      tokens.set(data);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function expireSession() {
  tokens.clear();
  expiredListeners.forEach((fn) => fn());
}

export async function request<T>(method: string, path: string, opts: ReqOpts = {}): Promise<T> {
  const { auth = true, retry = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const t = auth ? tokens.get() : null;
  if (t) headers.Authorization = `Bearer ${t.accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiRequestError(0, null, 'Network error — is the API running?');
  }

  if (res.status === 401 && auth && retry && t) {
    if (await refreshSession()) return request<T>(method, path, { ...opts, retry: false });
    expireSession();
  }

  if (!res.ok) {
    let body: Partial<ApiError> | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error */
    }
    throw new ApiRequestError(res.status, body, `${res.status} ${res.statusText || 'Request failed'}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string, query?: object) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} });
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body });
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, { body });
const del = <T>(path: string) => request<T>('DELETE', path);
const enc = encodeURIComponent;

// ─────────────────────────── Auth ───────────────────────────
export const login = (input: LoginInput) => request<AuthResponse>('POST', '/auth/login', { body: input, auth: false });
export const logout = (refreshToken: string) => request<{ ok: true }>('POST', '/auth/logout', { body: { refreshToken }, retry: false });
export const getMe = () => get<Me>('/auth/me');

// ─────────────────────────── Reference data ───────────────────────────
export const getLocations = () => get<LocationsResponse>('/locations');
export const getCatalog = () => get<Catalog>('/catalog');
export const uploadFile = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<Upload>('POST', '/uploads', { form });
};

// ─────────────────────────── Admin: stats ───────────────────────────
export const getOverview = () => get<AdminOverview>('/admin/stats/overview');
export const getRevenueStats = (days: number) => get<TimeseriesPoint[]>('/admin/stats/revenue', { days });
export const getListingStats = (days: number) => get<TimeseriesPoint[]>('/admin/stats/listings', { days });
export const getUserStats = (days: number) => get<TimeseriesPoint[]>('/admin/stats/users', { days });

// ─────────────────────────── Admin: listings ───────────────────────────
export const listAdminListings = (q: AdminListingQuery) => get<Paginated<AdminListing>>('/admin/listings', q);
export const getAdminListing = (id: string) => get<AdminListingDetail>(`/admin/listings/${enc(id)}`);
export const approveListing = (id: string) => post<AdminListing>(`/admin/listings/${enc(id)}/approve`);
export const rejectListing = (id: string, reason: string) => post<AdminListing>(`/admin/listings/${enc(id)}/reject`, { reason });
export const blockListing = (id: string, reason: string) => post<AdminListing>(`/admin/listings/${enc(id)}/block`, { reason });
export const updateAdminListing = (id: string, body: AdminListingUpdate) => patch<AdminListing>(`/admin/listings/${enc(id)}`, body);
export const promoteListing = (id: string, serviceCode: string) => post<AdminListing>(`/admin/listings/${enc(id)}/promote`, { serviceCode });

// ─────────────────────────── Admin: users ───────────────────────────
export const listAdminUsers = (q: AdminUserQuery) => get<Paginated<AdminUser>>('/admin/users', q);
export const getAdminUser = (id: string) => get<AdminUserDetail>(`/admin/users/${enc(id)}`);
export const updateAdminUser = (id: string, body: { role?: UserRole; status?: UserStatus; name?: string }) =>
  patch<AdminUser>(`/admin/users/${enc(id)}`, body);
export const adjustWallet = (id: string, body: { amount: number; reason: string }) => post<Wallet>(`/admin/users/${enc(id)}/wallet-adjust`, body);

// ─────────────────────────── Admin: agencies ───────────────────────────
export const listAdminAgencies = (q: { q?: string; verified?: boolean; page?: number; pageSize?: number }) => get<Paginated<Agency>>('/admin/agencies', q);
export const updateAdminAgency = (id: string, verified: boolean) => patch<Agency>(`/admin/agencies/${enc(id)}`, { verified });

// ─────────────────────────── Admin: payments ───────────────────────────
export const listAdminPayments = (q: AdminPaymentQuery) => get<Paginated<AdminPaymentRow>>('/admin/payments', q);
export const getAdminPayment = (id: string) => get<AdminPaymentDetail>(`/admin/payments/${enc(id)}`);
export const refundPayment = (id: string, body: { amount?: number; reason?: string }) => post<Payment>(`/admin/payments/${enc(id)}/refund`, body);

// ─────────────────────────── Admin: bookings & subscriptions ───────────────────────────
export const listAdminBookings = (q: AdminBookingQuery) => get<Paginated<Booking>>('/admin/bookings', q);
export const cancelAdminBooking = (id: string, reason: string) => post<Booking>(`/admin/bookings/${enc(id)}/cancel`, { reason });
export const listAdminSubscriptions = (q: { status?: string } & PageQuery) => get<Paginated<AdminSubscriptionRow>>('/admin/subscriptions', q);

// ─────────────────────────── Admin: reports ───────────────────────────
export const listReports = (q: { status?: ReportStatus } & PageQuery) => get<Paginated<ListingReport>>('/admin/reports', q);
export const updateReport = (id: string, status: 'RESOLVED' | 'DISMISSED') => patch<ListingReport>(`/admin/reports/${enc(id)}`, { status });

// ─────────────────────────── Admin: catalog & settings ───────────────────────────
export const getAdminCatalog = () => get<Catalog>('/admin/catalog');
export const updateService = (code: string, body: ServiceUpdate) => patch<ServiceDef>(`/admin/catalog/services/${enc(code)}`, body);
export const updatePlan = (code: string, body: PlanUpdate) => patch<PlanDef>(`/admin/catalog/plans/${enc(code)}`, body);
export const getSettings = () => get<PlatformSettings>('/admin/settings');
export const updateSettings = (body: SettingsUpdateInput) => patch<PlatformSettings>('/admin/settings', body);

// ─────────────────────────── Admin: content ───────────────────────────
export const listBanners = () => get<Banner[]>('/admin/banners');
export const createBanner = (body: BannerInput) => post<Banner>('/admin/banners', body);
export const updateBanner = (id: string, body: Partial<BannerInput>) => patch<Banner>(`/admin/banners/${enc(id)}`, body);
export const deleteBanner = (id: string) => del<{ ok: true }>(`/admin/banners/${enc(id)}`);
export const listPages = () => get<CmsPage[]>('/admin/pages');
export const savePage = (slug: string, body: CmsPageInput) => put<CmsPage>(`/admin/pages/${enc(slug)}`, body);
export const deletePage = (slug: string) => del<{ ok: true }>(`/admin/pages/${enc(slug)}`);

// ─────────────────────────── Admin: mortgage, broadcast, audit ───────────────────────────
export const listMortgageLeads = (q: { status?: MortgageLeadStatus } & PageQuery) => get<Paginated<MortgageLead>>('/admin/mortgage-leads', q);
export const updateMortgageLead = (id: string, status: MortgageLeadStatus) => patch<MortgageLead>(`/admin/mortgage-leads/${enc(id)}`, { status });
export const broadcast = (body: { title: string; body: string; audience: BroadcastAudience }) => post<{ sent: number }>('/admin/notifications/broadcast', body);
export const listAuditLogs = (q: { entity?: string; actorId?: string } & PageQuery) => get<Paginated<AuditLog>>('/admin/audit-logs', q);
