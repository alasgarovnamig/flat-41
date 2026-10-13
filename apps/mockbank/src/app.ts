import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import type { Config } from './config';
import { createPool, migrate, type Db } from './db';
import { createLogger, type Logger } from './lib/logger';
import { adminRouter } from './routes/admin';
import { checkoutRouter } from './routes/checkout';
import { healthRouter } from './routes/health';
import { merchantApiRouter } from './routes/merchantApi';
import { MerchantService } from './services/merchants';
import { OrderService } from './services/orders';
import { Scheduler } from './services/scheduler';
import { TokenService } from './services/tokens';
import { WebhookService } from './services/webhooks';

export interface Services {
  config: Config;
  db: Db;
  log: Logger;
  merchants: MerchantService;
  tokens: TokenService;
  webhooks: WebhookService;
  orders: OrderService;
  scheduler: Scheduler;
}

export function createServices(config: Config, db: Db = createPool(config.databaseUrl)): Services {
  const log = createLogger(config.logLevel);
  const merchants = new MerchantService(db);
  const tokens = new TokenService(db);
  const webhooks = new WebhookService(db, config, merchants, log);
  const orders = new OrderService(db, config, tokens, webhooks, log);
  const scheduler = new Scheduler(orders, webhooks, config.schedulerIntervalMs, log);
  return { config, db, log, merchants, tokens, webhooks, orders, scheduler };
}

export function createApp(s: Services): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/', (_req, res) => {
    res.json({ service: 'mockbank', checkout: '/checkout/:orderId', admin: '/admin', health: '/health', api: '/api/v1' });
  });
  app.use(healthRouter(s));
  app.use('/api/v1', merchantApiRouter(s));
  app.use('/checkout', checkoutRouter(s));
  app.use('/admin', adminRouter(s));

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    s.log.error('unhandled error', { err: err instanceof Error ? err.stack : String(err) });
    if (!res.headersSent) res.status(500).type('text/plain').send('Internal error');
  });
  return app;
}

export interface RunningServer {
  services: Services;
  server: Server;
  url: string;
  close(): Promise<void>;
}

/** Migrates, seeds merchants, starts HTTP + the background scheduler. */
export async function startServer(config: Config, opts: { db?: Db; startScheduler?: boolean } = {}): Promise<RunningServer> {
  const services = createServices(config, opts.db);
  await migrate(services.db);
  await services.merchants.seed(config.merchants);
  const app = createApp(services);
  const server = await new Promise<Server>((resolve, reject) => {
    const srv = app.listen(config.port, (err?: Error) => (err ? reject(err) : resolve(srv)));
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://localhost:${port}`;
  if (opts.startScheduler !== false) services.scheduler.start();
  services.log.info(`Mock bank listening on ${url} (public ${config.publicUrl}, env ${config.env})`);

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      await services.scheduler.stop();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      await services.webhooks.drain();
      await services.db.end();
    })());
  return { services, server, url, close };
}
