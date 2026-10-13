import type { TFunction } from './i18n';
import { isApiError } from './api';

/** Error codes we have translations for (messages/*.json → errors.<CODE>). */
export const KNOWN_ERROR_CODES = [
  'NETWORK_ERROR', 'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL',
  'OTP_INVALID', 'OTP_EXPIRED', 'OTP_TOO_FREQUENT', 'OTP_TOO_MANY_ATTEMPTS', 'INVALID_CREDENTIALS', 'USER_EXISTS',
  'USER_BLOCKED', 'REFRESH_INVALID', 'REFRESH_REUSED', 'INSUFFICIENT_FUNDS', 'QUOTA_EXCEEDED', 'NOT_AVAILABLE',
  'DATES_UNAVAILABLE', 'LISTING_NOT_ACTIVE', 'NO_CREDITS', 'PLAN_LIMIT', 'ALREADY_REVIEWED', 'NOT_REVIEWABLE',
  'NOT_CANCELLABLE', 'AGENCY_EXISTS', 'TOO_MANY_REQUESTS', 'PAYMENT_FAILED', 'FILE_TOO_LARGE', 'UNSUPPORTED_FILE',
] as const;

/** Human readable, localized message for any thrown error (switches on ApiError.code). */
export function errorMessage(e: unknown, t: TFunction): string {
  if (isApiError(e)) {
    if (e.code && (KNOWN_ERROR_CODES as readonly string[]).includes(e.code)) {
      const base = t(`errors.${e.code}`);
      if (e.code === 'VALIDATION_ERROR' && e.messages.length) return `${base}: ${e.messages.slice(0, 3).join('; ')}`;
      return base;
    }
    if (e.status === 0) return t('errors.NETWORK_ERROR');
    if (e.status === 401) return t('errors.UNAUTHORIZED');
    if (e.status === 403) return t('errors.FORBIDDEN');
    if (e.status === 404) return t('errors.NOT_FOUND');
    if (e.status === 429) return t('errors.TOO_MANY_REQUESTS');
    if (e.status >= 500) return t('errors.INTERNAL');
    return e.message || t('errors.generic');
  }
  return t('errors.generic');
}

interface ZodLikeIssue {
  path: PropertyKey[];
  message: string;
  code?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  format?: string;
  expected?: string;
  input?: unknown;
}

const CUSTOM_MESSAGES: Record<string, string> = {
  'Invalid phone number': 'validation.phone',
  'Required for daily rent': 'validation.required',
  'Floor cannot exceed total floors': 'validation.floorExceeds',
  'Rooms required': 'validation.required',
  'checkOut must be after checkIn': 'validation.checkOutAfter',
  'Expected YYYY-MM-DD': 'validation.date',
};

/** Localized message for one zod issue (shared schemas emit English messages). */
export function issueMessage(i: ZodLikeIssue, t: TFunction): string {
  if (CUSTOM_MESSAGES[i.message]) return t(CUSTOM_MESSAGES[i.message]!);
  switch (i.code) {
    case 'invalid_type':
      return i.input === undefined || i.input === null || i.input === '' ? t('validation.required') : t('validation.invalid');
    case 'too_small':
      if (i.origin === 'string') return Number(i.minimum) <= 1 ? t('validation.required') : t('validation.minLength', { min: Number(i.minimum) });
      if (i.origin === 'array') return t('validation.minItems', { min: Number(i.minimum) });
      return t('validation.min', { min: Number(i.minimum) });
    case 'too_big':
      if (i.origin === 'string') return t('validation.maxLength', { max: Number(i.maximum) });
      if (i.origin === 'array') return t('validation.maxItems', { max: Number(i.maximum) });
      return t('validation.max', { max: Number(i.maximum) });
    case 'invalid_format':
      if (i.format === 'email') return t('validation.email');
      if (i.format === 'url') return t('validation.url');
      return t('validation.invalid');
    default:
      return t('validation.invalid');
  }
}

/** Map zod issues to { fieldPath: localized message } for forms. */
export function zodFieldErrors(issues: readonly ZodLikeIssue[], t: TFunction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.map(String).join('.') || '_';
    if (!out[k]) out[k] = issueMessage(i, t);
  }
  return out;
}
