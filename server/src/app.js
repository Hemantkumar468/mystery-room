import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import morgan from 'morgan';

import { config } from './config/index.js';
import { httpLogStream } from './config/logger.js';
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
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
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

  // ── API ───────────────────────────────────────────────
  app.use(config.apiPrefix, apiLimiter, apiRouter);

  // ── Fallbacks ─────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
