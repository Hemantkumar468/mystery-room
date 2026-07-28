/**
 * Provider registry and failover.
 *
 * The rest of the module never imports a provider directly — it asks for a
 * capability (`research`, `synthesize`) and gets whichever provider is
 * configured, with the second one as a live fallback. Adding a third provider
 * is one file plus one line in PROVIDERS.
 */

import { config } from '../../../config/index.js';
import { logger } from '../../../config/logger.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { AI_PROVIDER } from '../ai.constants.js';
import openai from './openai.provider.js';
import gemini from './gemini.provider.js';
import { ProviderError, ProviderNotConfiguredError } from './base.js';

/**
 * Preference order for `AI_PROVIDER=auto`. Gemini leads because its
 * google_search grounding is first-party Google Search — consistently
 * stronger on hyper-local Indian geography, which is most of what this
 * module asks about.
 */
const PROVIDERS = [gemini, openai];

const byName = new Map(PROVIDERS.map((p) => [p.name, p]));

/** Every configured provider, in the order they should be attempted. */
export function availableProviders() {
  const preference = config.ai.provider;
  if (preference !== 'auto') {
    const chosen = byName.get(preference);
    return chosen?.isConfigured() ? [chosen] : [];
  }
  return PROVIDERS.filter((p) => p.isConfigured());
}

export const isAiAvailable = () => config.ai.enabled && availableProviders().length > 0;

/** Operator-facing status for the health endpoint and the UI's disabled state. */
export function aiStatus() {
  const available = availableProviders();
  return {
    enabled: config.ai.enabled,
    available: isAiAvailable(),
    preference: config.ai.provider,
    primary: available[0]?.name || null,
    fallback: available[1]?.name || null,
    providers: PROVIDERS.map((p) => ({
      name: p.name,
      configured: p.isConfigured(),
      model:
        p.name === AI_PROVIDER.OPENAI ? config.ai.openai.model : config.ai.gemini.model,
    })),
    reason: !config.ai.enabled
      ? 'AI is disabled (set AI_ENABLED=true).'
      : available.length
        ? null
        : 'No provider API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY.',
  };
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
 * failure, fall through to the next one.
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
