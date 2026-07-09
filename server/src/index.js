import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

async function bootstrap() {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`🚀 Mystery Rooms ERP API listening on :${config.port} (${config.env})`);
    logger.info(`   API base → http://localhost:${config.port}${config.apiPrefix}`);
  });

  // ── Graceful shutdown ─────────────────────────────────
  const shutdown = async (signal) => {
    logger.warn(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectDatabase();
      logger.info('HTTP server closed. Bye 👋');
      process.exit(0);
    });
    // Force-exit if cleanup hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — exiting', err);
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error('Fatal error during bootstrap', err);
  process.exit(1);
});
