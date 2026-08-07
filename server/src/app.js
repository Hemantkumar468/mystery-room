import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import morgan from 'morgan';

import { config } from './config/index.js';
import { httpLogStream, logger } from './config/logger.js';
import { apiLimiter } from './core/middleware/rateLimiter.js';
import { notFound } from './core/middleware/notFound.js';
import { errorHandler } from './core/middleware/errorHandler.js';
import { apiRouter } from './routes/index.js';

/**
 * Build and configure the Express application (no listening here — that's index.js).
 */
export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── Security & parsing ────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin/non-browser (no origin) and whitelisted origins.
        if (!origin || config.cors.origins.includes(origin)) return cb(null, true);

        /* CLIENT_ORIGINS=* — reflect whatever origin asked.
           `cb(null, true)` echoes the caller's Origin rather than emitting a
           literal `*`, which is the only form a browser accepts alongside
           `credentials: true`. See config/index.js#cors.allowAll for what this
           costs; index.js warns about it on every boot. */
        if (config.cors.allowAll) return cb(null, true);

        /* A blocked origin is almost always a deployment typo, not an attack —
           a trailing slash, http vs https, or a CLIENT_ORIGINS that was never
           updated after the frontend moved. The browser deliberately hides the
           reason (it only reports "no Access-Control-Allow-Origin header"), so
           the server log is the ONLY place the cause can surface. Print both
           sides of the comparison so the fix is a copy-paste. */
        logger.warn(
          `CORS blocked origin "${origin}" — it is not in CLIENT_ORIGINS `
          + `[${config.cors.origins.join(', ') || '(empty)'}]. `
          + 'Values are matched exactly: scheme + host, no trailing slash, no path.',
        );
        /* Refuse the CORS headers but do NOT error the request. Passing an
           Error here surfaces as a 500, which reads as "the API is broken" and
           sends people debugging the server instead of the whitelist. `false`
           answers normally with no Access-Control-Allow-Origin — the browser
           still blocks it (that is the point), the log above says why, and a
           non-browser client is unaffected. */
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(hpp());
  app.use(compression());

  // ── Observability ─────────────────────────────────────
  app.use(
    morgan(config.isProd ? 'combined' : 'dev', {
      stream: httpLogStream,
      skip: (req) => req.originalUrl === '/health',
    }),
  );

  // ── Liveness probe (unversioned, unthrottled) ─────────
  app.get('/health', (_req, res) =>
    res.json({ success: true, status: 'ok', uptime: process.uptime(), env: config.env }),
  );

  // ── Service root ──────────────────────────────────────
  // This is an API-only service — the SPA is deployed separately — so `/` has
  // nothing to serve. It still answers rather than 404s, because `/` is what
  // Render's platform probe and anyone who pastes the service URL into a
  // browser will hit, and a 404 there reads as "the deploy is broken" when it
  // is simply the wrong path. Points at where the real routes live.
  app.get('/', (_req, res) =>
    res.json({
      success: true,
      name: 'Mystery Rooms ERP API',
      status: 'ok',
      api: config.apiPrefix,
      health: '/health',
      hint: `This is the API only. Endpoints live under ${config.apiPrefix} — e.g. POST ${config.apiPrefix}/auth/login.`,
    }),
  );

  // ── API ───────────────────────────────────────────────
  app.use(config.apiPrefix, apiLimiter, apiRouter);

  // ── Fallbacks ─────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
