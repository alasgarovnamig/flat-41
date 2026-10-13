import { validationError } from './errors';
import { CURRENCIES, LANGUAGES, type Currency, type Customer, type Language } from './types';
import { isValidUrl } from './util';

export interface CreateOrderInput {
  amount: number;
  currency: Currency;
  merchantOrderId: string;
  description: string;
  language: Language;
  returnUrl: string;
  callbackUrl: string;
  saveCard: boolean;
  customer: Customer | null;
}

export interface ChargeTokenInput {
  amount: number;
  currency: Currency;
  merchantOrderId: string;
  description: string;
  cardToken: string;
  callbackUrl: string | null;
}

export interface RefundInput {
  amount: number | null;
  reason: string | null;
}

type Body = Record<string, unknown>;

function asObject(body: unknown): Body {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError(['body must be a JSON object']);
  return body as Body;
}

const MAX_AMOUNT = 100_000_000_00; // 100M major units

function amount(v: unknown, field: string, errors: string[]): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) errors.push(`${field} must be a positive integer (minor units)`);
  else if (v > MAX_AMOUNT) errors.push(`${field} is too large`);
  return v as number;
}

function currency(v: unknown, errors: string[]): Currency {
  if (typeof v !== 'string' || !(CURRENCIES as readonly string[]).includes(v)) errors.push(`currency must be one of ${CURRENCIES.join(', ')}`);
  return v as Currency;
}

function requiredString(v: unknown, field: string, max: number, errors: string[]): string {
  if (typeof v !== 'string' || v.trim() === '') errors.push(`${field} is required`);
  else if (v.length > max) errors.push(`${field} must be at most ${max} characters`);
  return typeof v === 'string' ? v.trim() : '';
}

function optionalString(v: unknown, field: string, max: number, errors: string[]): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    errors.push(`${field} must be a string`);
    return null;
  }
  if (v.length > max) errors.push(`${field} must be at most ${max} characters`);
  return v;
}

export function parseCreateOrder(raw: unknown): CreateOrderInput {
  const b = asObject(raw);
  const errors: string[] = [];
  const out: CreateOrderInput = {
    amount: amount(b.amount, 'amount', errors),
    currency: currency(b.currency, errors),
    merchantOrderId: requiredString(b.merchantOrderId, 'merchantOrderId', 128, errors),
    description: optionalString(b.description, 'description', 500, errors) ?? '',
    language: 'az',
    returnUrl: b.returnUrl as string,
    callbackUrl: b.callbackUrl as string,
    saveCard: false,
    customer: null,
  };
  if (b.language !== undefined && b.language !== null) {
    if (typeof b.language !== 'string' || !(LANGUAGES as readonly string[]).includes(b.language)) errors.push(`language must be one of ${LANGUAGES.join(', ')}`);
    else out.language = b.language as Language;
  }
  if (!isValidUrl(b.returnUrl, { allowAppScheme: true })) errors.push('returnUrl must be a valid absolute URL');
  if (!isValidUrl(b.callbackUrl)) errors.push('callbackUrl must be a valid http(s) URL');
  if (b.saveCard !== undefined && b.saveCard !== null) {
    if (typeof b.saveCard !== 'boolean') errors.push('saveCard must be a boolean');
    else out.saveCard = b.saveCard;
  }
  if (b.customer !== undefined && b.customer !== null) {
    if (typeof b.customer !== 'object' || Array.isArray(b.customer)) errors.push('customer must be an object');
    else {
      const c = b.customer as Body;
      const customer: Customer = {};
      for (const key of ['id', 'phone', 'email'] as const) {
        const v = optionalString(c[key], `customer.${key}`, 255, errors);
        if (v !== null) customer[key] = v;
      }
      out.customer = customer;
    }
  }
  if (errors.length) throw validationError(errors);
  return out;
}

export function parseChargeToken(raw: unknown): ChargeTokenInput {
  const b = asObject(raw);
  const errors: string[] = [];
  const out: ChargeTokenInput = {
    amount: amount(b.amount, 'amount', errors),
    currency: currency(b.currency, errors),
    merchantOrderId: requiredString(b.merchantOrderId, 'merchantOrderId', 128, errors),
    description: optionalString(b.description, 'description', 500, errors) ?? '',
    cardToken: requiredString(b.cardToken, 'cardToken', 128, errors),
    callbackUrl: null,
  };
  if (b.callbackUrl !== undefined && b.callbackUrl !== null) {
    if (!isValidUrl(b.callbackUrl)) errors.push('callbackUrl must be a valid http(s) URL');
    else out.callbackUrl = b.callbackUrl;
  }
  if (errors.length) throw validationError(errors);
  return out;
}

export function parseRefund(raw: unknown): RefundInput {
  const b = raw === undefined || raw === null ? {} : asObject(raw);
  const errors: string[] = [];
  const out: RefundInput = { amount: null, reason: optionalString(b.reason, 'reason', 500, errors) };
  if (b.amount !== undefined && b.amount !== null) out.amount = amount(b.amount, 'amount', errors);
  if (errors.length) throw validationError(errors);
  return out;
}
