import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Validated, typed application configuration.
 * Read once at boot — the rest of the app imports `config`, never `process.env`.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default("/api/v1"),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),

  JWT_ACCESS_SECRET: z.string().min(10, "JWT_ACCESS_SECRET must be set"),
  JWT_REFRESH_SECRET: z.string().min(10, "JWT_REFRESH_SECRET must be set"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  CLIENT_ORIGINS: z.string().default("http://localhost:5173"),

  // ── Cloudinary (file/image uploads) ──────────────────────
  // Optional so the server still boots without them; uploads fail loudly
  // (via config/cloudinary.js) until all three are provided.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // ── AI module (location intelligence) ────────────────────
  // Optional everywhere: with no key configured the module still mounts and
  // its endpoints answer 503 with a clear message, rather than the server
  // refusing to boot. `AI_PROVIDER=auto` picks whichever key is present,
  // preferring Gemini for its first-party Google Search grounding.
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  AI_PROVIDER: z.enum(["auto", "openai", "gemini"]).default("auto"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-5"),
  // `web_search` is the current tool name; older accounts still expose it as
  // `web_search_preview`. The provider retries with the other name on a 400,
  // so this only matters if you want to pin one explicitly.
  OPENAI_WEB_SEARCH_TOOL: z
    .enum(["web_search", "web_search_preview"])
    .default("web_search"),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z
    .string()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),

  // A grounded research call plus a synthesis call routinely runs 30–90s.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  // How long a completed analysis stays authoritative before a re-run is
  // suggested. Catchments move slowly; a week is a sane default.
  AI_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  // A `running` analysis older than this is presumed dead (e.g. the server
  // restarted mid-run) and swept to `failed` on the next read.
  AI_RUN_STALE_MINUTES: z.coerce.number().int().positive().default(15),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // AI calls cost money per request, so they get their own tighter budget on
  // top of the general limiter.
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3600000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  LOG_DIR: z.string().default("logs"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud — a misconfigured server must never boot half-broken.
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  isDev: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",

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
    origins: env.CLIENT_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  },

  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    aiWindowMs: env.AI_RATE_LIMIT_WINDOW_MS,
    aiMax: env.AI_RATE_LIMIT_MAX,
  },

  ai: {
    enabled: env.AI_ENABLED,
    provider: env.AI_PROVIDER,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    cacheTtlHours: env.AI_CACHE_TTL_HOURS,
    runStaleMinutes: env.AI_RUN_STALE_MINUTES,
    openai: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL.replace(/\/+$/, ""),
      model: env.OPENAI_MODEL,
      webSearchTool: env.OPENAI_WEB_SEARCH_TOOL,
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      baseUrl: env.GEMINI_BASE_URL.replace(/\/+$/, ""),
      model: env.GEMINI_MODEL,
    },
  },

  log: {
    level: env.LOG_LEVEL,
    dir: env.LOG_DIR,
  },
};

export default config;
