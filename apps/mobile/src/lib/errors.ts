import { ApiRequestError } from '../api/client';
import type { TKey } from '../i18n';

const KNOWN_CODES = new Set([
  'OTP_INVALID', 'OTP_EXPIRED', 'OTP_TOO_FREQUENT', 'OTP_TOO_MANY_ATTEMPTS', 'INVALID_CREDENTIALS', 'USER_BLOCKED',
  'USER_EXISTS', 'INSUFFICIENT_FUNDS', 'QUOTA_EXCEEDED', 'VALIDATION_ERROR', 'CONFLICT', 'DATES_UNAVAILABLE',
]);

/** Human readable message for any error, switching on the API `code` first (docs: "switch on code"). */
export function errorMessage(e: unknown, t: (k: TKey) => string): string {
  if (e instanceof ApiRequestError) {
    if (e.code && KNOWN_CODES.has(e.code)) {
      // Prefer the server's message for validation errors because it names the field.
      if (e.code === 'VALIDATION_ERROR' && e.messages.length) return e.messages.join('\n');
      return t(`errors.${e.code}` as TKey);
    }
    if (e.status === 0) return t('errors.network');
    if (e.status === 401) return t('errors.unauthorized');
    if (e.status === 403) return e.messages[0] ?? t('errors.forbidden');
    if (e.status === 404) return t('errors.notFound');
    if (e.status === 429) return t('errors.rateLimited');
    if (e.status === 400 || e.status === 422) return e.messages.length ? e.messages.join('\n') : t('errors.validation');
    if (e.status >= 500) return t('errors.server');
    return e.messages[0] ?? t('common.unknownError');
  }
  return t('common.unknownError');
}

export const isNotFound = (e: unknown) => e instanceof ApiRequestError && e.status === 404;
