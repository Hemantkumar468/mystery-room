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

    // CLIENT_ORIGINS=* is a deliberate escape hatch, and the failure mode of
    // an escape hatch is that nobody remembers it is open. Say so on every
    // single boot, loudly, so it cannot quietly become the permanent setting.
    if (config.cors.allowAll) {
      logger.warn(
        '⚠  CORS is open to ALL origins (CLIENT_ORIGINS=*). Combined with the '
        + 'SameSite=None refresh cookie, any site a signed-in user visits can call '
        + 'this API as them. Replace * with your real frontend origin(s) '
        + '(e.g. CLIENT_ORIGINS=https://your-site.netlify.app) when you can.',
      );
    } else {
      logger.info(`   CORS origins → ${config.cors.origins.join(', ') || '(none)'}`);
    }
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
