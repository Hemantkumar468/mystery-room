/**
 * Provider registry, selection and failover.
 *
 * The rest of the module never imports a provider directly — it asks for a
 * capability (`research`, `synthesize`) and gets whichever provider the
 * environment selected, with the remaining ones as a live fallback chain.
 *
 * ── Adding a vendor ─────────────────────────────────────────
 *   1. Write `providers/<vendor>.provider.js` exporting the adapter contract:
 *      `{ name, isConfigured(), describe(), research(args), synthesize(args) }`
 *   2. Add its name to `AI_PROVIDER` in ai.constants.js
 *   3. Add its config block to `config.ai` (key, baseUrl, model)
 *   4. Add it to ADAPTERS below
 *   Nothing else changes: not the analysis pipeline, not the Mongo model, not
 *   the API, not the UI. `describe()` exists precisely so this file never has
 *   to branch on a vendor name to report status.
 *
 * ── Switching vendor at runtime ─────────────────────────────
 *   AI_PROVIDER=grok            → Grok only
 *   AI_PROVIDER=grok,gemini     → Grok first, Gemini as failover
 *   AI_PROVIDER=auto            → every configured key, in DEFAULT_ORDER
 */

import { config } from '../../../config/index.js';
import { logger } from '../../../config/logger.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import grok from './grok.provider.js';
import groq from './groq.provider.js';
import gemini from './gemini.provider.js';
import openai from './openai.provider.js';
import { ProviderError, ProviderNotConfiguredError } from './base.js';

/** Every adapter that exists, registration order irrelevant. */
const ADAPTERS = [grok, groq, gemini, openai];

/**
 * Preference order for `AI_PROVIDER=auto`.
 *
 * Gemini leads on quality: its `google_search` grounding is first-party Google
 * Search, consistently the strongest on hyper-local Indian geography, which is
 * most of what this module asks about. Grok is second — its Live Search covers
 * the same ground well and its `-fast` tiers are by far the cheapest way to run
 * this pipeline, so a deployment holding only an xAI key works with no config
 * at all. Pin the order with AI_PROVIDER when the default is not what you want.
 *
 * `grok` (xAI) and `groq` (inference host) are different vendors that differ by
 * one letter — both are listed, and neither falls back to the other implicitly.
 */
const DEFAULT_ORDER = [gemini.name, grok.name, groq.name, openai.name];

const byName = new Map(ADAPTERS.map((p) => [p.name, p]));

/**
 * Resolve `AI_PROVIDER` against the adapters that actually exist, at import
 * time (which is boot time — routes/index.js mounts this module). A typo in
 * .env must not degrade silently into "AI is off"; this codebase fails loudly
 * on bad configuration everywhere else and does so here too.
 */
const PREFERRED_ORDER = (() => {
  const requested = config.ai.providerOrder;
  if (!requested.length) return DEFAULT_ORDER;

  const unknown = requested.filter((name) => !byName.has(name));
  if (unknown.length) {
    throw new Error(
      `Invalid AI_PROVIDER: unknown provider${unknown.length > 1 ? 's' : ''} ` +
        `"${unknown.join('", "')}". Valid values are "auto" or a comma-separated ` +
        `list of: ${[...byName.keys()].join(', ')}.`,
    );
  }
  // De-duplicated, and strictly what was asked for: naming one provider means
  // no silent failover to a vendor the operator did not choose.
  return [...new Set(requested)];
})();

/** Every configured provider, in the order they should be attempted. */
export function availableProviders() {
  return PREFERRED_ORDER.map((name) => byName.get(name)).filter((p) => p?.isConfigured());
}

export const isAiAvailable = () => config.ai.enabled && availableProviders().length > 0;

/** Operator-facing status for the health endpoint and the UI's disabled state. */
export function aiStatus() {
  const available = availableProviders();
  // Ordered for display: selected chain first, then anything else registered.
  const listed = [
    ...PREFERRED_ORDER,
    ...ADAPTERS.map((p) => p.name).filter((n) => !PREFERRED_ORDER.includes(n)),
  ];

  return {
    enabled: config.ai.enabled,
    available: isAiAvailable(),
    preference: config.ai.provider,
    /** The resolved chain, so operators can see what `auto` actually picked. */
    order: PREFERRED_ORDER,
    primary: available[0]?.name || null,
    fallback: available[1]?.name || null,
    providers: listed.map((name) => {
      const p = byName.get(name);
      const meta = p.describe?.() || {};
      return {
        name: p.name,
        label: meta.label || p.name,
        configured: p.isConfigured(),
        model: meta.model || null,
        // Providers that use a separate model for the grounded research call
        // (Groq, OpenAI) report both — otherwise the status endpoint shows one
        // model while half the spend is going somewhere else.
        researchModel: meta.researchModel || null,
        keyEnv: meta.keyEnv || null,
        docsUrl: meta.docsUrl || null,
        grounding: meta.grounding || null,
        selected: PREFERRED_ORDER.includes(name),
      };
    }),
    reason: reasonUnavailable(available),
  };
}

/** Why AI is off, phrased so the UI can show it to a non-technical user. */
function reasonUnavailable(available) {
  if (!config.ai.enabled) return 'AI is disabled (set AI_ENABLED=true).';
  if (available.length) return null;

  // Name only the providers the operator actually selected — telling someone
  // who set AI_PROVIDER=grok to go and configure OpenAI is noise.
  const wanted = PREFERRED_ORDER.map((n) => byName.get(n));
  const keys = wanted.map((p) => p.describe?.().keyEnv || `${p.name.toUpperCase()}_API_KEY`);
  return `No AI provider API key configured. Set ${keys.join(' or ')} in the server environment.`;
}

/** Thrown as a 503 so the client can render "not configured" rather than an error. */
export function assertAiAvailable() {
  if (isAiAvailable()) return;
  const status = aiStatus();
  throw new ApiError(503, status.reason || 'AI service unavailable', {
    code: 'AI_NOT_CONFIGURED',
    details: status,
  });
}

/**
 * Run `capability` on the first configured provider; on a genuine provider
 * failure, fall through to the next one in the chain.
 *
 * Only provider-level faults trigger failover. A bug in our own prompt or
 * post-processing would fail identically on every provider, so re-running it
 * would just double the spend — those propagate immediately.
 */
export async function withProvider(capability, args, { preferred } = {}) {
  let candidates = availableProviders();
  if (!candidates.length) assertAiAvailable();

  // Keep both calls of one analysis on the same provider where possible, so a
  // report's research and synthesis can't silently come from two models.
  if (preferred) {
    const first = candidates.find((p) => p.name === preferred);
    if (first) candidates = [first, ...candidates.filter((p) => p !== first)];
  }

  const failures = [];
  for (const provider of candidates) {
    try {
      return await provider[capability](args);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err; // our bug, not theirs
      if (err instanceof ProviderNotConfiguredError) continue;

      failures.push(`${provider.name}: ${err.message}`);
      logger.warn(`AI provider "${provider.name}" failed on ${capability}`, {
        error: err.message,
        status: err.status,
      });
    }
  }

  throw new ApiError(502, `AI analysis failed. ${failures.join(' | ')}`, {
    code: 'AI_PROVIDER_FAILED',
  });
}

export { ProviderError, ProviderNotConfiguredError };
