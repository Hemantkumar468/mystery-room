/**
 * Shared provider plumbing: typed errors, a timeout+retry fetch, and the two
 * JSON-Schema dialects the providers disagree on.
 *
 * Deliberately built on Node 20's global `fetch` rather than a vendor SDK —
 * the two REST surfaces we use are small and stable, and this keeps the
 * server's dependency list (and its supply-chain surface) unchanged.
 */

import { logger } from '../../../config/logger.js';

/** A provider call that failed. `retryable` drives both retry and failover. */
export class ProviderError extends Error {
  constructor(message, { provider, status, retryable = false, cause, body } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
    this.cause = cause;
    this.body = body;
  }
}

/** No key configured for this provider — distinct from a call that failed. */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(provider) {
    super(`AI provider "${provider}" is not configured`, { provider, retryable: false });
    this.name = 'ProviderNotConfiguredError';
  }
}

/** 408/429/5xx and transport faults are worth retrying; 4xx generally are not. */
const isRetryableStatus = (status) =>
  status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST JSON with a hard timeout, bounded exponential backoff and jitter.
 * Honours `Retry-After` when the provider sends one.
 */
export async function postJson(url, { headers = {}, body, timeoutMs, maxRetries = 2, provider }) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        const retryable = isRetryableStatus(res.status);
        const err = new ProviderError(
          `${provider} responded ${res.status}: ${truncate(text, 400)}`,
          { provider, status: res.status, retryable, body: text },
        );
        if (!retryable || attempt === maxRetries) throw err;
        lastError = err;
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs(attempt));
        continue;
      }

      try {
        return JSON.parse(text);
      } catch (parseErr) {
        throw new ProviderError(`${provider} returned a non-JSON body`, {
          provider,
          retryable: false,
          cause: parseErr,
          body: truncate(text, 400),
        });
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        if (!err.retryable || attempt === maxRetries) throw err;
        lastError = err;
      } else {
        // Transport-level: abort (timeout), DNS, socket reset — all retryable.
        const aborted = err?.name === 'AbortError';
        const wrapped = new ProviderError(
          aborted
            ? `${provider} request timed out after ${timeoutMs}ms`
            : `${provider} request failed: ${err.message}`,
          { provider, retryable: true, cause: err },
        );
        if (attempt === maxRetries) throw wrapped;
        lastError = wrapped;
      }
      logger.warn(`AI provider retry ${attempt + 1}/${maxRetries}`, {
        provider,
        error: lastError.message,
      });
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new ProviderError(`${provider} request failed`, { provider });
}

/** 500ms, 1s, 2s… capped at 8s, ±25% jitter so parallel runs don't resonate. */
function backoffMs(attempt) {
  const base = Math.min(500 * 2 ** attempt, 8000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export const truncate = (s, n) =>
  typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s;

/**
 * Pull the first fenced or bare JSON object out of a text response.
 *
 * Both providers can return valid JSON wrapped in prose or a ```json fence
 * despite being asked for raw JSON. Rather than fail the whole run on that,
 * recover the object — brace-matching (not a greedy regex) so nested objects
 * and braces inside strings survive.
 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to recovery */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to brace matching */
  }

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * OpenAI strict structured outputs require `additionalProperties: false` on
 * every object and *every* property listed in `required`. Our canonical
 * schemas are already written that way (no optional fields — "unknown" is
 * expressed as an empty string/array), so this only has to fill in the
 * mechanical parts and strip dialect keys OpenAI rejects.
 */
export function toOpenAiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toOpenAiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'propertyOrdering') continue; // Gemini-only
    out[key] = toOpenAiSchema(value);
  }

  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

/**
 * Gemini's `responseSchema` accepts an OpenAPI 3 subset: it rejects
 * `additionalProperties` and `$schema`, and honours `propertyOrdering` to fix
 * key order (which measurably improves structured-output quality).
 */
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema' || key === 'strict') continue;
    out[key] = toGeminiSchema(value);
  }

  if (out.type === 'object' && out.properties && !out.propertyOrdering) {
    out.propertyOrdering = Object.keys(out.properties);
  }
  return out;
}

/** De-duplicate citations by URL, preserving first-seen order and titles. */
export function dedupeCitations(citations = []) {
  const seen = new Map();
  for (const c of citations) {
    const url = (c?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.set(url, { url, title: (c.title || '').trim() || url });
  }
  return [...seen.values()];
}
