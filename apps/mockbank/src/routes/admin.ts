import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Services } from '../app';
import { ApiError } from '../lib/errors';
import { ORDER_STATUSES } from '../lib/types';
import { formatMoney, parseMajorAmount } from '../lib/util';
import { loadOrderJson } from '../services/orderStore';
import { merchantsPage, orderDetailPage, ordersPage, tokensPage, type AdminCtx } from '../views/admin';
import type { SafeHtml } from '../views/html';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Bank back office — HTTP basic auth + a per-credentials CSRF token on every POST. */
export function adminRouter(s: Services): Router {
  const router = Router();
  const { user, password } = s.config.admin;
  const csrf = createHmac('sha256', password).update(`mockbank-admin-csrf:${user}`).digest('hex').slice(0, 32);

  router.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0 && safeEqual(decoded.slice(0, idx), user) && safeEqual(decoded.slice(idx + 1), password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Mock Bank admin", charset="UTF-8"').status(401).type('text/plain').send('Authentication required');
  });

  router.use(express.urlencoded({ extended: false, limit: '16kb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Frame-Options', 'DENY');
    if (req.method === 'POST' && !safeEqual(String(req.body?.csrf ?? ''), csrf)) {
      res.status(403).type('text/plain').send('Invalid CSRF token');
      return;
    }
    next();
  });

  const ctx = (req: Request): AdminCtx => {
    const msg = typeof req.query.msg === 'string' ? req.query.msg.slice(0, 300) : '';
    return { csrf, flash: msg ? { kind: req.query.kind === 'err' ? 'err' : 'ok', text: msg } : null };
  };
  const send = (res: Response, page: SafeHtml, status = 200) => res.status(status).type('html').send(page.value);
  const back = (res: Response, path: string, kind: 'ok' | 'err', msg: string) =>
    res.redirect(303, `${path}?${new URLSearchParams({ kind, msg }).toString()}`);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

  router.get('/', (_req, res) => res.redirect('/admin/orders'));

  router.get('/orders', async (req, res) => {
    const status = str(req.query.status);
    const filter = {
      status: status && (ORDER_STATUSES as readonly string[]).includes(status) ? status : undefined,
      merchantId: str(req.query.merchant),
      q: str(req.query.q),
      page: Number(req.query.page) || 1,
      pageSize: 50,
    };
    const [data, merchants] = await Promise.all([s.orders.list(filter), s.merchants.list()]);
    send(res, ordersPage(ctx(req), data, filter, merchants));
  });

  router.get('/orders/:orderId', async (req, res) => {
    const order = await s.orders.get(String(req.params.orderId));
    if (!order) return send(res, ordersPage({ csrf, flash: { kind: 'err', text: 'Order not found' } }, { items: [], total: 0, page: 1, pageSize: 50 }, {}, await s.merchants.list()), 404);
    const [json, merchant, refunds, timeline, hooks] = await Promise.all([
      loadOrderJson(s.db, order),
      s.merchants.get(order.merchantId),
      s.orders.refunds(order.id),
      s.orders.timeline(order.id),
      s.webhooks.listForOrder(order.id),
    ]);
    send(
      res,
      orderDetailPage(ctx(req), {
        order,
        json,
        merchant,
        refunds,
        timeline,
        webhooks: hooks.webhooks,
        deliveries: hooks.deliveries,
        checkoutUrl: s.orders.paymentUrl(order.id),
      }),
    );
  });

  router.post('/orders/:orderId/resend', async (req, res) => {
    const id = String(req.params.orderId);
    try {
      await s.orders.resendWebhook(id);
      back(res, `/admin/orders/${id}`, 'ok', 'Webhook re-sent — see the delivery log below.');
    } catch (err) {
      back(res, `/admin/orders/${id}`, 'err', err instanceof ApiError ? err.message : String(err));
    }
  });

  router.post('/orders/:orderId/refund', async (req, res) => {
    const id = String(req.params.orderId);
    const rawAmount = str(req.body?.amount);
    const amount = rawAmount ? parseMajorAmount(rawAmount) : null;
    if (rawAmount && (amount === null || amount <= 0)) return back(res, `/admin/orders/${id}`, 'err', `Invalid amount "${rawAmount}"`);
    try {
      const order = await s.orders.refund(id, { amount, reason: str(req.body?.reason) ?? null }, { source: 'ADMIN' });
      back(res, `/admin/orders/${id}`, 'ok', `Refund done — order is now ${order.status} (refunded ${formatMoney(order.refundedAmount, order.currency)}).`);
    } catch (err) {
      back(res, `/admin/orders/${id}`, 'err', err instanceof ApiError ? err.message : String(err));
    }
  });

  router.get('/tokens', async (req, res) => {
    const filter = { merchantId: str(req.query.merchant), q: str(req.query.q) };
    const [tokens, merchants] = await Promise.all([s.tokens.list(filter), s.merchants.list()]);
    send(res, tokensPage(ctx(req), tokens, filter, merchants));
  });

  router.post('/tokens/:token/insufficient', async (req, res) => {
    const on = req.body?.value === '1';
    const ok = await s.tokens.setInsufficientFunds(String(req.params.token), on);
    back(res, '/admin/tokens', ok ? 'ok' : 'err', ok ? `Insufficient funds ${on ? 'enabled' : 'disabled'} for ${req.params.token}` : 'Token not found');
  });

  router.post('/tokens/:token/delete', async (req, res) => {
    const ok = await s.tokens.delete(String(req.params.token));
    back(res, '/admin/tokens', ok ? 'ok' : 'err', ok ? `Deleted ${req.params.token}` : 'Token not found');
  });

  router.get('/merchants', async (req, res) => {
    send(res, merchantsPage(ctx(req), await s.merchants.list()));
  });

  return router;
}
