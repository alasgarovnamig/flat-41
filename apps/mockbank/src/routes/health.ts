import { Router } from 'express';
import type { Services } from '../app';

export function healthRouter(s: Services): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    try {
      await s.db.query('SELECT 1');
      res.json({ status: 'ok', service: 'mockbank', db: 'ok', time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'error', service: 'mockbank', db: 'down', message: String(err) });
    }
  });
  return router;
}
