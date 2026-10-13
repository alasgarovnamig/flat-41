import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const safeEqual = (a: string, b: string) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};
export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
/** YYYY-MM-DD in UTC */
export const ymd = (d: Date = new Date()) => d.toISOString().slice(0, 10);
