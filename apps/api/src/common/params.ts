import { Param, ParseUUIDPipe } from '@nestjs/common';
import { notFound } from './errors';

/** `@UuidParam('id') id: string` — a malformed UUID answers 404 NOT_FOUND (instead of a DB cast error). */
export const UuidParam = (name = 'id') => Param(name, new ParseUUIDPipe({ exceptionFactory: () => notFound() }));

/**
 * PATCH helper: zod `.partial()` still applies inner `.default()`s (e.g. amenities → [], currency → 'AZN'),
 * which would silently reset fields the client did not send. Keep only keys present in the raw body.
 */
export const onlyProvided = <T extends object>(parsed: T, raw: unknown): T => {
  const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => keys.includes(k))) as T;
};
