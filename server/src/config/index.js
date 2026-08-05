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
  // refusing to boot.
  //
  // Switching vendor is an env change, never a code change. AI_PROVIDER takes
  // either "auto" (use whichever keys are present, in the registry's default
  // preference order) or an explicit comma-separated order, which doubles as
  // the failover chain:
  //
  //   AI_PROVIDER=grok            → Grok only; fail if it is down
  //   AI_PROVIDER=grok,gemini     → Grok first, fall over to Gemini
  //   AI_PROVIDER=gemini,openai   → the other way round
  //
  // Unknown names are rejected at boot by providers/index.js, which owns the
  // list of adapters that actually exist.
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  AI_PROVIDER: z
    .string()
    .default("auto")
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => v.length > 0, "AI_PROVIDER must not be empty"),

  // ── xAI / Grok ──
  // `GROK_API_KEY` is accepted as an alias for `XAI_API_KEY`: the console
  // calls the product Grok and the API xAI, and typing the wrong one is not
  // worth a debugging session.
  XAI_API_KEY: z.string().optional(),
  GROK_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().default("https://api.x.ai/v1"),
  XAI_MODEL: z.string().default("grok-4-fast-reasoning"),
  // Live Search is a metered add-on on xAI. `auto` lets the model decide
  // whether to search and, if the account cannot use search at all, the
  // adapter retries the call ungrounded rather than failing the run. Use `on`
  // to force grounding (a run that cannot search then fails, which is what you
  // want if citations are non-negotiable) or `off` to never pay for search.
  XAI_SEARCH_MODE: z.enum(["auto", "on", "off"]).default("auto"),
  XAI_MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).max(50).default(15),

  // ── Groq ──
  // A different vendor from xAI/Grok above, one letter apart: `groq` is an
  // inference host (api.groq.com, keys start `gsk_`), `grok` is xAI's model
  // family (api.x.ai, keys start `xai-`). Neither aliases the other.
  //
  // Groq is the one provider where grounding and structured output live on
  // different models, so it has two model settings rather than one:
  //   GROQ_RESEARCH_MODEL  agentic, has server-side web search → citations
  //   GROQ_MODEL           plain reasoning model → strict JSON synthesis
  // See providers/groq.provider.js for why they are not the same model.
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_RESEARCH_MODEL: z.string().default("groq/compound"),
  // Same semantics as XAI_SEARCH_MODE: `auto` degrades to an ungrounded run if
  // search is unavailable, `on` makes that a hard failure, `off` never searches.
  GROQ_SEARCH_MODE: z.enum(["auto", "on", "off"]).default("auto"),
  GROQ_MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).max(50).default(10),
  // Hard ceiling on `max_completion_tokens` for this provider.
  //
  // Groq refuses a request outright (413 `request_too_large`) when the asked-for
  // completion budget exceeds what is left in the token-per-minute window — it
  // does not simply truncate. The analysis services ask for a generous budget
  // (16k on synthesis) sized for providers with no such limit, so on Groq that
  // request must be clamped or it can never be admitted. Free tier is 8k TPM,
  // so the default leaves room for the prompt. Raise it with your Groq tier;
  // set 0 to disable clamping entirely.
  GROQ_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(0).default(6000),

  // ── OpenAI ──
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-5"),
  // `web_search` is the current tool name; older accounts still expose it as
  // `web_search_preview`. The provider retries with the other name on a 400,
  // so this only matters if you want to pin one explicitly.
  OPENAI_WEB_SEARCH_TOOL: z
    .enum(["web_search", "web_search_preview"])
    .default("web_search"),

  // ── Google Gemini ──
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z
    .string()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),
  // `google_search` grounding is quota'd separately from ordinary generation,
  // and on the free tier that quota is often zero — the same key answers a
  // plain prompt but 429s as soon as tools are attached. Same semantics as the
  // other providers: `auto` degrades to an ungrounded, clearly-labelled run,
  // `on` makes grounding mandatory, `off` never searches.
  GEMINI_SEARCH_MODE: z.enum(["auto", "on", "off"]).default("auto"),

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
    /** Raw preference, as written in .env — shown verbatim on the status endpoint. */
    provider: env.AI_PROVIDER,
    /**
     * `AI_PROVIDER` parsed into an explicit order. Empty means "auto": let the
     * registry use its own preference order over whatever keys are present.
     */
    providerOrder:
      env.AI_PROVIDER === "auto"
        ? []
        : env.AI_PROVIDER.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    cacheTtlHours: env.AI_CACHE_TTL_HOURS,
    runStaleMinutes: env.AI_RUN_STALE_MINUTES,
    grok: {
      apiKey: env.XAI_API_KEY || env.GROK_API_KEY,
      baseUrl: env.XAI_BASE_URL.replace(/\/+$/, ""),
      model: env.XAI_MODEL,
      searchMode: env.XAI_SEARCH_MODE,
      maxSearchResults: env.XAI_MAX_SEARCH_RESULTS,
    },
    groq: {
      apiKey: env.GROQ_API_KEY,
      baseUrl: env.GROQ_BASE_URL.replace(/\/+$/, ""),
      model: env.GROQ_MODEL,
      researchModel: env.GROQ_RESEARCH_MODEL,
      searchMode: env.GROQ_SEARCH_MODE,
      maxSearchResults: env.GROQ_MAX_SEARCH_RESULTS,
      maxCompletionTokens: env.GROQ_MAX_COMPLETION_TOKENS,
    },
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
      searchMode: env.GEMINI_SEARCH_MODE,
    },
  },

  log: {
    level: env.LOG_LEVEL,
    dir: env.LOG_DIR,
  },
};

export default config;
