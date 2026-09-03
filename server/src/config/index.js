import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Validated, typed application configuration.
 * Read once at boot — the rest of the app imports `config`, never `process.env`.
 */
/**
 * An optional variable that treats an empty string as absent.
 *
 * A key left blank in a copied .env ("SMTP_PORT=") reaches us as "", which is
 * present as far as zod is concerned — so a coercion would turn it into 0 and
 * fail validation, taking the whole boot with it. Blank means unset.
 *
 * @param schema      what to apply when a value IS present
 * @param fallback    used when it is not
 */
const blank = (schema, fallback = undefined) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    schema.optional().default(fallback),
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default("/api/v1"),
  // This server's own externally-reachable base URL — used only to build
  // links back to itself (currently: the /files proxy that hands out fresh
  // presigned S3 links). Mirrors the client's VITE_API_BASE_URL; update both
  // together when the deployment's address changes (e.g. a tunnel/LAN IP for
  // mobile testing, or a real domain in production).
  PUBLIC_API_URL: z.string().optional(),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),

  JWT_ACCESS_SECRET: z.string().min(10, "JWT_ACCESS_SECRET must be set"),
  JWT_REFRESH_SECRET: z.string().min(10, "JWT_REFRESH_SECRET must be set"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  CLIENT_ORIGINS: z.string().default("http://localhost:5173 "),

  // ── Cloudinary (legacy — superseded by S3 below, kept only so the schema
  // doesn't reject a .env that still has these set) ────────
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // ── AWS S3 (file/image uploads) ───────────────────────────
  // Optional so the server still boots without them; uploads fail loudly
  // (via config/s3.js) until all four are provided. The bucket is shared
  // with other projects — every object this app writes is keyed under the
  // `mysteryrooms/` prefix so it never collides with unrelated content.
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

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
  //
  // Two model settings, same split as Groq above: the grounded research call
  // and the strict-JSON synthesis call have different cost/latency profiles, so
  // pinning one model for both means overpaying on one of them.
  //
  // The defaults are measured, not guessed. On this pipeline's real prompts:
  // the `-mini` tier researches in ~30s with good citation coverage, while the
  // top tier repeatedly blew the 120s request timeout with the web_search tool
  // attached and returned a gateway 520 — it is not a viable research model
  // here regardless of its quality. Synthesis has no tools and is the call
  // whose judgement produces the score, so it defaults one tier up.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_RESEARCH_MODEL: z.string().default("gpt-5.4-mini"),
  // `web_search` is the current tool name; older accounts still expose it as
  // `web_search_preview`. The provider retries with the other name on a 400,
  // so this only matters if you want to pin one explicitly.
  OPENAI_WEB_SEARCH_TOOL: z
    .enum(["web_search", "web_search_preview"])
    .default("web_search"),
  // Same semantics as XAI_SEARCH_MODE/GROQ_SEARCH_MODE. Defaults to `on` here
  // because an observed failure mode on this provider is a run that quietly
  // does almost no searching and returns an uncited brief — which then scores a
  // multi-crore lease decision off the model's priors. `on` fails that run
  // instead of publishing it; `auto` restores the permissive behaviour.
  OPENAI_SEARCH_MODE: z.enum(["auto", "on", "off"]).default("on"),
  // Reasoning budget for the synthesis call on gpt-5-family models. This is the
  // dominant lever on synthesis latency: the same brief and schema swing by
  // minutes between efforts, because the spend is internal thinking tokens
  // before a single field of the report is emitted. The rubric work here is
  // judgement over an evidence brief that is already assembled, not open-ended
  // problem solving, so a middle setting holds score quality while keeping the
  // call inside the request timeout. Ignored by non-reasoning models.
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high"])
    .default("low"),

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
  // How many properties a bulk sweep analyses at once. Each one is two provider
  // calls, so this multiplies straight into concurrent provider load — 3 keeps
  // a 10-property sweep near three minutes without tripping vendor rate limits.
  // Raise it only alongside your provider's requests-per-minute allowance.
  AI_BULK_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),


  // ── CRM lead capture ────────────────────────────────────
  /**
   * Per-form shared secrets for the public intake endpoint, as
   * `formName:secret,formName2:secret2`.
   *
   * One key per form rather than one for the endpoint: these live in public
   * HTML, so assume every one of them leaks eventually, and revoking a leaked
   * key must not take down the other five forms. Unset means the public
   * endpoint refuses everything, which is the correct default for a server
   * that has not been told about any forms yet.
   */
  CRM_FORM_KEYS: blank(z.string()),

  // Meta Lead Ads (Facebook + Instagram). All four are needed together — the
  // webhook cannot be verified without the token, and the lead data cannot be
  // fetched without the page token, so a half-configured integration is worse
  // than none.
  /** Echoed back during Meta's webhook handshake. Any string you choose. */
  META_VERIFY_TOKEN: blank(z.string()),
  /** Signs every webhook body; used to prove the POST really came from Meta. */
  META_APP_SECRET: blank(z.string()),
  /** Long-lived PAGE token with `leads_retrieval`. A short-lived one expires in
   *  about an hour, and the lead flow then dies silently. */
  META_PAGE_TOKEN: blank(z.string()),
  META_GRAPH_VERSION: blank(z.string(), 'v21.0'),

  // Telephony (Exotel by decision; the adapter keeps Twilio a one-file swap).
  TELEPHONY_PROVIDER: blank(z.enum(['exotel', 'twilio']), 'exotel'),
  TELEPHONY_SID: blank(z.string()),
  TELEPHONY_TOKEN: blank(z.string()),
  /** The number the CUSTOMER sees. The masking is the point of using a cloud
   *  provider rather than a `tel:` link. */
  TELEPHONY_CALLER_ID: blank(z.string()),
  /** Exotel does not sign webhooks, so the URL carries this instead. Long and
   *  random, and never logged — anyone who learns it can post to the hook. */
  TELEPHONY_WEBHOOK_SECRET: blank(z.string()),
  /** Exotel's API host is account-specific, e.g. api.exotel.com or
   *  <sid>:<token>@api.in.exotel.com — given at provisioning. */
  TELEPHONY_SUBDOMAIN: blank(z.string(), 'api.exotel.com'),

  // ── Outbound email (activity reminders) ─────────────────
  // All optional. With SMTP_HOST unset the mailer reports itself as
  // unconfigured and every send is skipped with a log line — the app must run
  // on a laptop with no mail server, and a reminder that cannot be emailed is
  // still delivered in-app.
  // `blank` throughout: a key copied from .env.example and left empty arrives as
  // "" rather than absent, and "" must mean "not set" — otherwise an untouched
  // SMTP_PORT= would coerce to 0 and refuse to boot the server.
  SMTP_HOST: blank(z.string()),
  SMTP_PORT: blank(z.coerce.number().int().positive(), 587),
  // Implicit TLS (465) vs STARTTLS (587). Derived from the port when unset,
  // because getting these two out of step is the classic silent-failure.
  // NOT z.coerce.boolean(), which reads the string "false" as true.
  SMTP_SECURE: blank(z.enum(['true', 'false']).transform((v) => v === 'true')),
  SMTP_USER: blank(z.string()),
  SMTP_PASS: blank(z.string()),
  // What recipients see in the From line.
  MAIL_FROM: blank(z.string()),
  /** From line on comms email (purchase orders). config.smtp.from falls
   *  back to SMTP_USER when this is unset. */
  SMTP_FROM: blank(z.string()),

  // ── WhatsApp (SmartWhap) ────────────────────────────────
  // Outbound WhatsApp for ERP notifications. Unset means off: the service
  // reports itself unconfigured and every send is skipped with a log line,
  // exactly like the mailer — a laptop with no credentials must still boot.
  //
  // The token identifies the sending number on SmartWhap, so there is no
  // phone-number id here (that is a Meta Cloud API concept, and this account
  // is not on Meta directly — see docs/WHATSAPP_SETTINGS_SPEC.md).
  WHATSAPP_ACCESS_TOKEN: blank(z.string()),
  WHATSAPP_BASE_URL: blank(z.string(), 'https://app.smartwhap.com/api/v2'),
  // Country code prepended to a bare 10-digit number.
  WHATSAPP_COUNTRY_CODE: blank(z.string(), '91'),
  // Kill switch that beats every per-event setting. NOT z.coerce.boolean(),
  // which reads the string "false" as true.
  WHATSAPP_ENABLED: blank(z.enum(['true', 'false']).transform((v) => v === 'true'), true),
  // Test mode: every message goes here instead of the real recipient. The one
  // safe way to exercise this system without messaging real employees.
  WHATSAPP_TEST_NUMBER: blank(z.string()),

  // ── Inbound email: the BCC dropbox ──────────────────────
  // A mailbox reps BCC on customer email, polled over IMAP so every thread
  // lands on the right record without anyone copying and pasting.
  //
  // Needs no provider approval — any existing mailbox and an app password will
  // do — which is why it ships before the channels that are waiting on
  // paperwork. It also answers a question no amount of design can: whether the
  // team will actually remember to BCC.
  //
  // Unset means off. The job still registers (so its absence is visible in the
  // job list rather than a mystery) and each run exits immediately.
  IMAP_HOST: blank(z.string()),
  IMAP_PORT: blank(z.coerce.number().int().positive(), 993),
  // Same reasoning as SMTP_SECURE: never z.coerce.boolean(), which reads the
  // string "false" as true. 993 is implicit TLS, 143 negotiates.
  IMAP_SECURE: blank(z.enum(['true', 'false']).transform((v) => v === 'true')),
  IMAP_USER: blank(z.string()),
  IMAP_PASS: blank(z.string()),
  IMAP_MAILBOX: blank(z.string(), 'INBOX'),
  /** The dropbox's own address, stripped from recipient lists so the mailbox
   *  never counts as the customer on the thread. Defaults to IMAP_USER. */
  EMAIL_DROPBOX_ADDRESS: blank(z.string()),
  /** How often to look. Minutes, not seconds: this is a convenience channel,
   *  and a mailbox polled every few seconds gets an account throttled. */
  EMAIL_DROPBOX_POLL_MINUTES: blank(z.coerce.number().int().positive(), 5),

  /**
   * Open and click tracking on outbound CRM email.
   *
   * A tracking pixel reports something the recipient never agreed to tell us,
   * so it is a switch rather than a given: some customers, and some
   * jurisdictions, take a dim view of it. Nothing is sent to a third party —
   * the pixel and the redirect are served by this API — and the token is
   * random rather than derived from the address, so the URL itself does not
   * leak who was mailed. Enabled by default because knowing whether a quote
   * was ever opened is the point of the feature; set false to turn it off
   * everywhere at once, including links already in flight.
   *
   * NOT z.coerce.boolean(), which reads the string "false" as true.
   */
  // No default here: `blank(schema, fallback)` applies the fallback to the
  // enum's INPUT, so a boolean would be rejected as not being 'true'|'false'.
  // The default lives in the config block below, same as SMTP_SECURE.
  EMAIL_TRACKING_ENABLED: blank(z.enum(['true', 'false']).transform((v) => v === 'true')),
  // Where links in an email point. The API base is not browsable by a human.
  APP_URL: blank(z.string()),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  /**
   * 1200 per 15 minutes ≈ 80/min per IP.
   *
   * It was 300 (20/min), which is below what ONE open tab of this app costs.
   * Property Identification while an AI sweep runs polls the sweep counters
   * every 3s and the score table every 5s (~32/min), the notification bell adds
   * 4/min, and a single navigation fires ten-plus queries at once. So the app
   * exhausted its own budget in a couple of minutes of ordinary use and then
   * 429'd everything — tasks board, notifications, AI — until the window rolled
   * over. A limit the product cannot stay under is not protecting anything; it
   * is an outage on a timer.
   *
   * Still a real ceiling: 80/min sustained is far above one person working and
   * well below anything worth calling abuse.
   */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1200),
  /**
   * Apply the general limiter in development too. Off by default — Vite's HMR
   * remounts and React StrictMode's deliberate double-fetch make every local
   * session look like a burst, and there is nothing on localhost to protect.
   * Set to 'true' to reproduce production throttling locally.
   *
   * NOT z.coerce.boolean(), which reads the string "false" as true. The
   * fallback is the STRING 'false' because `blank()` feeds it through the enum
   * before the transform runs — a boolean would be rejected as not 'true'|'false'.
   */
  RATE_LIMIT_IN_DEV: blank(z.enum(['true', 'false']).transform((v) => v === 'true'), 'false'),
  // AI calls cost money per request, so they get their own tighter budget on
  // top of the general limiter.
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3600000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  // ── Refresh-cookie attributes ────────────────────────────
  // Both are optional and, left unset, are derived from NODE_ENV below —
  // because the correct value depends on something the app cannot see: whether
  // the browser treats the API and the SPA as the same site.
  //
  //   Same domain (api.example.com + app.example.com, or one reverse proxy)
  //     → SameSite=Lax is right and slightly safer.
  //   Different domains (Netlify frontend + Render backend — this deployment)
  //     → the refresh POST is cross-site, and a Lax cookie is simply NOT SENT.
  //       Login appears to work, then the session dies at the first refresh.
  //       That case needs SameSite=None, which browsers only honour on a
  //       Secure cookie, which in turn requires HTTPS on both ends.
  //
  // Set these explicitly to override the derived default (e.g. COOKIE_SAMESITE=lax
  // once the API is served from the same domain as the SPA).
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).optional(),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  LOG_DIR: z.string().default("logs"),
  // A request slower than this is logged as a warning rather than an ordinary
  // line — the first thing anyone wants out of a production log is "what is slow".
  LOG_SLOW_MS: z.coerce.number().int().min(1).default(1000),
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

// Parsed once here rather than inline below, because `config.cors.allowAll`
// has to look at the same normalised list `config.cors.origins` exposes.
const corsOrigins = env.CLIENT_ORIGINS.split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  isDev: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",

  port: env.PORT,
  apiPrefix: env.API_PREFIX,
  publicApiUrl: (env.PUBLIC_API_URL || `http://localhost:${env.PORT}${env.API_PREFIX}`).replace(/\/+$/, ""),

  db: {
    uri: env.MONGO_URI,
  },

  crm: {
    /** Raw `form:secret,...` string — parsed once by intake.guards.js. */
    formKeys: env.CRM_FORM_KEYS,
    meta: {
      verifyToken: env.META_VERIFY_TOKEN,
      appSecret: env.META_APP_SECRET,
      pageToken: env.META_PAGE_TOKEN,
      graphVersion: env.META_GRAPH_VERSION,
      /** All three or nothing: a webhook that verifies but cannot fetch the
       *  lead data produces empty leads, which is worse than no integration. */
      configured: Boolean(env.META_VERIFY_TOKEN && env.META_APP_SECRET && env.META_PAGE_TOKEN),
    },
    telephony: {
      provider: env.TELEPHONY_PROVIDER,
      sid: env.TELEPHONY_SID,
      token: env.TELEPHONY_TOKEN,
      callerId: env.TELEPHONY_CALLER_ID,
      webhookSecret: env.TELEPHONY_WEBHOOK_SECRET,
      subdomain: env.TELEPHONY_SUBDOMAIN,
    },
  },

  whatsapp: {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    baseUrl: env.WHATSAPP_BASE_URL.replace(/\/+$/, ''),
    countryCode: env.WHATSAPP_COUNTRY_CODE,
    /** Nothing is sent without a token — see core/services/whatsapp.service.js. */
    configured: Boolean(env.WHATSAPP_ACCESS_TOKEN),
    /** Master switch. The database setting can only narrow this, never widen it. */
    enabled: env.WHATSAPP_ENABLED,
    /** When set, every send is redirected here — see the service's test mode. */
    testNumber: env.WHATSAPP_TEST_NUMBER,
  },

  mail: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; everything else negotiates with STARTTLS. Derived
    // from the port when unset, because these two being out of step is the
    // classic silent mail failure.
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || env.SMTP_FROM || 'Mystery Rooms ERP <no-reply@mysteryrooms.in>',
    /** Nothing is sent without a host — see core/services/mail.service.js. */
    configured: Boolean(env.SMTP_HOST),
    /** Open/click tracking on outbound CRM mail. On unless switched off. */
    trackingEnabled: env.EMAIL_TRACKING_ENABLED ?? true,
  },

  /** The BCC dropbox — inbound email, filed onto the record it belongs to. */
  emailDropbox: {
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE ?? env.IMAP_PORT !== 143,
    user: env.IMAP_USER,
    pass: env.IMAP_PASS,
    mailbox: env.IMAP_MAILBOX,
    /** Lower-cased once here so every comparison downstream is a plain ===. */
    address: (env.EMAIL_DROPBOX_ADDRESS || env.IMAP_USER || '').trim().toLowerCase(),
    pollMinutes: env.EMAIL_DROPBOX_POLL_MINUTES,
    /** Host AND credentials: a host alone would connect as nobody and fail on
     *  every poll, which is noise rather than a working feature. */
    configured: Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS),
  },

  /** Where an email link should send someone: the app, not the API. */
  appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },

  cors: {
    /**
     * A browser's `Origin` header is scheme + host + optional port, never a
     * trailing slash and never a path — so the whitelist is normalised to that
     * shape here rather than demanding operators type it perfectly.
     *
     * Pasting the site URL straight from the address bar
     * ("https://erpmystery.netlify.app/") is the single most common way this
     * is misconfigured, and the failure is invisible from the browser: it only
     * reports a missing Access-Control-Allow-Origin header, with no hint that
     * one character is the cause. Stripping trailing slashes costs nothing and
     * removes the whole class of mistake.
     *
     * Anything beyond a trailing slash (a path) is still left alone and simply
     * won't match — silently repairing a genuinely wrong value would be worse
     * than refusing it.
     */
    origins: corsOrigins,

    /**
     * `CLIENT_ORIGINS=*` — accept requests from ANY origin.
     *
     * This does NOT send `Access-Control-Allow-Origin: *`. That header is
     * illegal on a credentialed request, and every request this API serves is
     * credentialed (the httpOnly refresh cookie rides on /auth/refresh), so a
     * literal wildcard would be rejected by the browser and allow nothing at
     * all. Instead app.js reflects the caller's own Origin back, which is the
     * only spec-legal way to express "anyone" with credentials enabled.
     *
     * The security cost is real and worth stating plainly: combined with the
     * SameSite=None refresh cookie, any site a signed-in user visits can call
     * this API as them and read the response — including exchanging their
     * cookie for a live access token at /auth/refresh. It exists as an escape
     * hatch for getting a deployment working under time pressure; the fix is
     * to name the real origins, and index.js warns on every boot until you do.
     */
    allowAll: corsOrigins.includes("*"),
  },

  /**
   * Attributes for the httpOnly refresh cookie (auth.controller.js).
   *
   * Production defaults to `SameSite=None; Secure` because the deployed
   * topology is cross-site — the SPA is on Netlify and the API on Render, two
   * different registrable domains. `Lax` there means the browser silently
   * withholds the cookie on POST /auth/refresh, so a signed-in user is thrown
   * back to the login screen the moment their 15-minute access token expires
   * or they reload the tab. Development stays on `Lax` over plain HTTP, where
   * `None` would be rejected for not being Secure.
   *
   * Override with COOKIE_SAMESITE / COOKIE_SECURE if the API ever moves behind
   * the same domain as the SPA.
   */
  cookie: {
    sameSite: env.COOKIE_SAMESITE ?? (env.NODE_ENV === "production" ? "none" : "lax"),
    secure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
  },

  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  },

  s3: {
    bucket: env.S3_BUCKET,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    // Every object this app ever writes lives under this prefix — the
    // bucket is shared with other projects and nothing outside this
    // prefix is ever read, written or deleted by this codebase.
    rootPrefix: 'mysteryrooms',
  },

  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER,
    configured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    /** Throttle local development too — see RATE_LIMIT_IN_DEV. */
    inDev: env.RATE_LIMIT_IN_DEV,
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
    bulkConcurrency: env.AI_BULK_CONCURRENCY,
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
      researchModel: env.OPENAI_RESEARCH_MODEL,
      webSearchTool: env.OPENAI_WEB_SEARCH_TOOL,
      searchMode: env.OPENAI_SEARCH_MODE,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
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
    slowMs: env.LOG_SLOW_MS,
  },
};

export default config;
