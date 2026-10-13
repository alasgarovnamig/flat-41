import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Services } from '../app';
import { ApiError, invalidSignature, validationError } from '../lib/errors';
import { HEADER_MERCHANT, HEADER_SIGNATURE, HEADER_TIMESTAMP, sign, signatureMatches } from '../lib/signature';
import type { Merchant } from '../lib/types';
import { parseChargeToken, parseCreateOrder, parseRefund } from '../lib/validation';

interface SignedLocals {
  merchant: Merchant;
  json: unknown;
}

const locals = (res: Response) => res.locals as SignedLocals;

/**
 * Merchant API — every request must carry X-Merchant-Id / X-Timestamp / X-Signature where
 * signature = hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`)), rawBody = '' for GET.
 */
export function merchantApiRouter(s: Services): Router {
  const router = Router();

  // Keep the exact bytes: the signature covers the raw body, so JSON is parsed only after verification.
  router.use(express.raw({ type: () => true, limit: '256kb' }));

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const merchantId = req.get(HEADER_MERCHANT);
    const timestamp = req.get(HEADER_TIMESTAMP);
    const signature = req.get(HEADER_SIGNATURE);
    if (!merchantId || !timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) throw invalidSignature();
    if (Math.abs(Date.now() - Number(timestamp)) > s.config.signatureToleranceMs) throw invalidSignature();
    const merchant = await s.merchants.get(merchantId);
    if (!merchant) throw invalidSignature();
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!signatureMatches(sign(merchant.secret, timestamp, rawBody), signature)) throw invalidSignature();

    let json: unknown = undefined;
    if (rawBody.trim() !== '') {
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw validationError(['body must be valid JSON']);
      }
    }
    res.locals.merchant = merchant;
    res.locals.json = json;
    next();
  });

  router.post('/orders', async (_req, res) => {
    const { merchant, json } = locals(res);
    const input = parseCreateOrder(json);
    const { order } = await s.orders.create(merchant, input);
    res.status(201).json({
      orderId: order.id,
      status: order.status,
      paymentUrl: s.orders.paymentUrl(order.id),
      expiresAt: new Date(order.expiresAt).toISOString(),
    });
  });

  router.post('/orders/charge-token', async (_req, res) => {
    const { merchant, json } = locals(res);
    const order = await s.orders.chargeToken(merchant, parseChargeToken(json));
    res.json(await s.orders.toJson(order));
  });

  router.get('/orders/:orderId', async (req, res) => {
    const order = await s.orders.getForMerchant(locals(res).merchant.id, String(req.params.orderId));
    res.json(await s.orders.toJson(order));
  });

  router.post('/orders/:orderId/refund', async (req, res) => {
    const { merchant, json } = locals(res);
    const order = await s.orders.refund(String(req.params.orderId), parseRefund(json), { merchantId: merchant.id, source: 'API' });
    res.json(await s.orders.toJson(order));
  });

  router.post('/orders/:orderId/cancel', async (req, res) => {
    const order = await s.orders.cancel(locals(res).merchant.id, String(req.params.orderId));
    res.json(await s.orders.toJson(order));
  });

  router.delete('/tokens/:cardToken', async (req, res) => {
    await s.tokens.delete(String(req.params.cardToken), locals(res).merchant.id);
    res.json({ ok: true });
  });

  router.use((_req, _res) => {
    throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint');
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    const status = (err as { status?: number; type?: string }).status;
    if (status === 413) {
      res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' });
      return;
    }
    s.log.error('merchant api error', { err: err instanceof Error ? err.stack : String(err) });
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal error' });
  });

  return router;
}
