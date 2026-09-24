import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Validated, typed application configuration.
 * Read once at boot — the rest of the app imports `config`, never `process.env`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default('/api/v1'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(10, 'JWT_ACCESS_SECRET must be set'),
  JWT_REFRESH_SECRET: z.string().min(10, 'JWT_REFRESH_SECRET must be set'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_DIR: z.string().default('logs'),

  // ── Operations modules (Delegation / Checklist) — all optional ──
  OPS_TIMEZONE: z.string().default('Asia/Kolkata'),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  UPLOAD_DIR: z.string().default('uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(15),
  APP_URL: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Mystery Rooms ERP <no-reply@mysteryrooms.in>'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud — a misconfigured server must never boot half-broken.
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',

  port: env.PORT,
  apiPrefix: env.API_PREFIX,

  db: {
    uri: env.MONGO_URI,
  },

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },

  cors: {
    origins: env.CLIENT_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },

  log: {
    level: env.LOG_LEVEL,
    dir: env.LOG_DIR,
  },

  ops: {
    timezone: env.OPS_TIMEZONE,
    jobsEnabled: env.JOBS_ENABLED && env.NODE_ENV !== 'test',
    appUrl: env.APP_URL.replace(/\/$/, ''),
  },

  uploads: {
    dir: env.UPLOAD_DIR,
    maxBytes: Math.round(env.UPLOAD_MAX_MB * 1024 * 1024),
  },

  mail: {
    enabled: Boolean(env.SMTP_HOST),
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  },
};

export default config;
