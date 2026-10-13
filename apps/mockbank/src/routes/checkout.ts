import express, { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Services } from '../app';
import { validateCard } from '../lib/cards';
import { resolveLanguage, translator } from '../lib/i18n';
import { LANGUAGES, type Language, type OrderRow } from '../lib/types';
import { appendQuery } from '../lib/util';
import { withLang, type PageContext } from '../views/checkoutLayout';
import { renderCardForm, renderNotFound, renderResult, renderThreeDs, type CardFormState } from '../views/checkout';
import type { SafeHtml } from '../views/html';

/** Status reported to the merchant's returnUrl (contract: APPROVED | DECLINED | CANCELLED). */
export function returnStatus(order: OrderRow): 'APPROVED' | 'DECLINED' | 'CANCELLED' {
  switch (order.status) {
    case 'APPROVED':
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'APPROVED';
    case 'DECLINED':
      return 'DECLINED';
    default:
      return 'CANCELLED';
  }
}

export function buildReturnUrl(order: OrderRow): string {
  return appendQuery(order.returnUrl!, {
    orderId: order.id,
    merchantOrderId: order.merchantOrderId,
    status: returnStatus(order),
  });
}

function nonceOk(order: OrderRow, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(order.formNonce);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkoutRouter(s: Services): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '16kb' }));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const pageContext = (req: Request, order: OrderRow | null, path: string): PageContext => {
    const q = req.query.lang;
    const langOverride = typeof q === 'string' && (LANGUAGES as readonly string[]).includes(q) ? (q as Language) : null;
    const lang = langOverride ?? resolveLanguage(order?.language);
    return { t: translator(lang), lang, langOverride, isProd: s.config.isProd, path };
  };

  const send = (res: Response, status: number, page: SafeHtml) => res.status(status).type('html').send(page.value);

  const merchantName = async (order: OrderRow) => (await s.merchants.get(order.merchantId))?.name ?? order.merchantId;

  /** Loads a checkout order (expiring it when overdue). Renders 404 and returns null when unknown. */
  const load = async (req: Request, res: Response): Promise<OrderRow | null> => {
    const id = String(req.params.orderId);
    const order = await s.orders.get(id);
    if (!order || order.kind !== 'CHECKOUT' || !order.returnUrl) {
      send(res, 404, renderNotFound(pageContext(req, null, req.baseUrl + req.path)));
      return null;
    }
    return s.orders.expireIfDue(order);
  };

  const go = (req: Request, res: Response, order: OrderRow, suffix = '') => {
    const ctx = pageContext(req, order, '');
    res.redirect(303, withLang(`/checkout/${order.id}${suffix}`, ctx));
  };

  // 1. Card form / final result.
  router.get('/:orderId', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    const ctx = pageContext(req, order, `/checkout/${order.id}`);
    if (order.status === 'PROCESSING') return go(req, res, order, '/3ds');
    if (order.status === 'CREATED') {
      const state: CardFormState = { values: { number: '', expiry: '', holder: '', saveCard: true }, errors: {} };
      return send(res, 200, renderCardForm(ctx, order, await merchantName(order), state));
    }
    const autoRedirect = order.status === 'APPROVED' || order.status === 'DECLINED' || order.status === 'CANCELLED';
    send(res, 200, renderResult(ctx, order, await merchantName(order), { returnHref: `/checkout/${order.id}/return`, autoRedirect }));
  });

  // 2. Card submitted.
  router.post('/:orderId/pay', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status !== 'CREATED') return go(req, res, order);
    const ctx = pageContext(req, order, `/checkout/${order.id}`);
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const values = {
      number: String(body.number ?? '').slice(0, 30),
      expiry: String(body.expiry ?? '').slice(0, 10),
      holder: String(body.holder ?? '').slice(0, 80),
      saveCard: body.saveCard === '1' || body.saveCard === 'on' || body.saveCard === 'true',
    };
    if (!nonceOk(order, body.nonce)) {
      return send(res, 403, renderCardForm(ctx, order, await merchantName(order), { values, errors: {}, alert: ctx.t('staleForm') }));
    }
    const result = validateCard({ number: values.number, expiry: values.expiry, cvv: String(body.cvv ?? ''), holder: values.holder });
    if (!result.ok) {
      return send(res, 422, renderCardForm(ctx, order, await merchantName(order), { values, errors: result.errors, alert: ctx.t('formError') }));
    }
    const updated = await s.orders.submitCard(order.id, result.card, values.saveCard);
    const current = updated ?? (await s.orders.get(order.id))!;
    go(req, res, current, current.status === 'PROCESSING' ? '/3ds' : '');
  });

  // Cancel button on the card form → CANCELLED, webhook, back to the merchant.
  router.post('/:orderId/cancel', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status !== 'CREATED' || !nonceOk(order, req.body?.nonce)) return go(req, res, order);
    const cancelled = await s.orders.cancelByCustomer(order.id);
    if (!cancelled) return go(req, res, order);
    res.redirect(302, buildReturnUrl(cancelled));
  });

  // 3. 3-D Secure (ACS) page.
  router.get('/:orderId/3ds', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status !== 'PROCESSING') return go(req, res, order);
    const ctx = pageContext(req, order, `/checkout/${order.id}/3ds`);
    send(res, 200, renderThreeDs(ctx, order, await merchantName(order), {}));
  });

  router.post('/:orderId/3ds', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status !== 'PROCESSING') return go(req, res, order);
    const ctx = pageContext(req, order, `/checkout/${order.id}/3ds`);
    if (!nonceOk(order, req.body?.nonce)) {
      return send(res, 403, renderThreeDs(ctx, order, await merchantName(order), { error: ctx.t('staleForm') }));
    }
    const result = await s.orders.submitOtp(order.id, String(req.body?.otp ?? ''));
    if (result && result.order.status === 'PROCESSING') {
      return send(res, 422, renderThreeDs(ctx, result.order, await merchantName(order), { error: ctx.t('wrongOtp', { n: result.attemptsLeft }) }));
    }
    go(req, res, result?.order ?? order);
  });

  router.post('/:orderId/3ds/resend', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status !== 'PROCESSING' || !nonceOk(order, req.body?.nonce)) return go(req, res, order);
    const ctx = pageContext(req, order, `/checkout/${order.id}/3ds`);
    send(res, 200, renderThreeDs(ctx, order, await merchantName(order), { info: ctx.t('resent') }));
  });

  router.post('/:orderId/3ds/cancel', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status === 'PROCESSING' && nonceOk(order, req.body?.nonce)) {
      const declined = await s.orders.abort3ds(order.id);
      return go(req, res, declined ?? order);
    }
    go(req, res, order);
  });

  // 4. Back to the merchant: 302 → returnUrl?orderId=…&merchantOrderId=…&status=…
  router.get('/:orderId/return', async (req, res) => {
    const order = await load(req, res);
    if (!order) return;
    if (order.status === 'CREATED' || order.status === 'PROCESSING') return go(req, res, order);
    res.redirect(302, buildReturnUrl(order));
  });

  return router;
}
