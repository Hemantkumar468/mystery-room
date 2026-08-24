import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { startJobs, stopJobs } from './core/jobs/agenda.js';

async function bootstrap() {
  await connectDatabase();

  /* Count the companies on this deployment and decide how strict tenant
     scoping has to be. With one company an unscoped query cannot leak
     anything, so scripts and jobs are left alone; from the second company
     onward an unscoped query throws instead of quietly returning everybody's
     data. Arming it here means the change happens at boot, loudly, rather
     than at some later request nobody is watching. */
  const { armStrictness } = await import('./core/tenancy/tenancy.js');
  await armStrictness();

  // After the database, because Agenda stores its queue there — starting it
  // first produces a confusing first-tick error instead of a clear boot failure.
  await startJobs();

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
      // Before the database, since the queue lives in it. Running jobs are
      // allowed to finish their lock rather than being killed mid-flight — a
      // half-done Graph API fetch that never releases its lock is a job that
      // sits unclaimed until the lock expires.
      await stopJobs();
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
