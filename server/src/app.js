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
  /* Helmet's defaults assume a server that renders its own pages. This one is
     an API whose media is embedded BY a separate origin — the SPA on :5173 in
     development, and the Netlify site in production.

     `crossOriginResourcePolicy` defaults to "same-origin", which made the
     browser reject every image and file served from /files with
     ERR_BLOCKED_BY_RESPONSE.NotSameOrigin — including the 302 that redirects to
     a presigned S3 link, so the redirect was never even followed. "cross-origin"
     is the correct setting for a media endpoint consumed by another origin.

     This is NOT a loosening of access control: who may fetch a file is decided
     by `authenticate` on the route and by the presigned URL's own expiry. CORP
     only governs whether a browser will let another origin EMBED the bytes, and
     for a deliberately separate frontend that has to be allowed. */
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
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
  app.use(express.json({
    limit: '1mb',
    /**
     * Keep the exact bytes, for the webhook handlers that must verify a
     * signature over them.
     *
     * Meta signs the raw body. Re-serialising the parsed object does not
     * reproduce it — key order, unicode escaping and whitespace all differ —
     * so the signature check would fail on every genuine delivery. This is the
     * only place the untouched buffer is still available.
     */
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(hpp());
  app.use(compression());

  // ── Observability ─────────────────────────────────────
  app.use(
    /* Production-shaped request log, answering the questions an incident
       actually asks: WHO hit WHAT, from where, how long it took, and how big
       the answer was — one line per request, greppable by user or route.

         14:02:11 [http] POST /api/v1/pms/tasks/bulk-status 200 184ms 412b user=md@… ip=1.2.3.4

       Morgan writes on response-finish, so `req.user` (set by the auth
       middleware later in the chain) IS populated by the time these tokens
       run — which is why a custom token can log the user even though morgan
       is mounted first. The old setup ('combined' in prod, 'dev' locally)
       had neither the user nor a stable format between environments. */
    morgan((tokens, req, res) => [
      tokens.method(req, res),
      tokens.url(req, res),
      tokens.status(req, res),
      `${Math.round(Number(tokens['response-time'](req, res)) || 0)}ms`,
      `${tokens.res(req, res, 'content-length') || 0}b`,
      `user=${req.user?.email || req.user?.id || 'anonymous'}`,
      `ip=${tokens['remote-addr'](req, res)}`,
    ].join(' '), {
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
