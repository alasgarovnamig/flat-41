import { startServer } from './app';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const running = await startServer(config);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    running.services.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    running
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error(err);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('[mockbank] failed to start', err);
  process.exit(1);
});
