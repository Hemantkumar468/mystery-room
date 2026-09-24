/**
 * Groq adapter — `POST /openai/v1/chat/completions`.
 *
 * ⚠️  NOT the same vendor as `grok.provider.js`. The names differ by one letter
 *     and nothing else:
 *       • **grok** = xAI's model family, api.x.ai, keys start `xai-`
 *       • **groq** = a fast-inference host running open models, api.groq.com,
 *         keys start `gsk_`
 *     A key pasted into the wrong one fails with a bare 401, so the two are
 *     kept strictly separate rather than aliased.
 *
 * Groq's surface is OpenAI-compatible, so `toOpenAiSchema` is reused. What is
 * specific to Groq is that **grounding and structured output live on different
 * models**, which is why this is the one adapter with two model settings:
 *
 *  • `GROQ_RESEARCH_MODEL` (default `groq/compound`) — an agentic model with
 *    server-side web search. It returns its searches in `executed_tools`, which
 *    is where this adapter reads citations from.
 *  • `GROQ_MODEL` (default `openai/gpt-oss-120b`) — a plain reasoning model
 *    used for the synthesis call, where strict `json_schema` is what matters
 *    and search would only add cost.
 *
 * Using one model for both was measured and rejected: `gpt-oss-120b` with the
 * `browser_search` tool inlines every fetched page into the prompt, costing
 * ~121k tokens for a research call that `groq/compound` answers in ~6k. On
 * Groq's free tier (8k tokens/minute) the former cannot complete at all.
 *
 * Self-healing, so switching model tier stays an env change:
 *  • A 400 naming `temperature` is retried once without it.
 *  • A 400 naming `json_schema`/`response_format` falls back to `json_object`;
 *    the prompt states the schema in full and the output is validated
 *    downstream either way.
 *  • If the research model has no search entitlement, the call is retried
 *    ungrounded and flagged (`grounded: false`) so the report's confidence and
 *    Sources sections tell the truth. `GROQ_SEARCH_MODE=on` makes that a hard
 *    failure instead.
 */

import { config } from '../../../config/index.js';
import { logger } from '../../../config/logger.js';
import { AI_PROVIDER } from '../ai.constants.js';
import {
  postJson,
  ProviderError,
  ProviderNotConfiguredError,
  toOpenAiSchema,
  extractJson,
  dedupeCitations,
} from './base.js';

const NAME = AI_PROVIDER.GROQ;

const cfg = () => config.ai.groq;

export const isConfigured = () => Boolean(cfg().apiKey);

export const describe = () => ({
  label: 'Groq',
  model: cfg().model,
  researchModel: cfg().researchModel,
  baseUrl: cfg().baseUrl,
  keyEnv: 'GROQ_API_KEY',
  docsUrl: 'https://console.groq.com/keys',
  grounding: cfg().searchMode === 'off' ? 'none' : 'groq_compound_web_search',
});

function requireKey() {
  if (!isConfigured()) throw new ProviderNotConfiguredError(NAME);
  return cfg().apiKey;
}

async function chat(body) {
  const apiKey = requireKey();
  return postJson(`${cfg().baseUrl}/chat/completions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    timeoutMs: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
    provider: NAME,
    // 413 is deliberately NOT retried here. Groq means "this request does not
    // fit the token window right now", and re-sending the identical request
    // cannot fix that — `chatWithinBudget` below shrinks it instead.
  });
}

/** Smallest completion budget worth attempting before giving up on a call. */
const MIN_COMPLETION_TOKENS = 1024;

/**
 * Send `body`, shrinking the completion budget until Groq will accept it.
 *
 * Groq answers 413 `request_too_large` when `max_completion_tokens` exceeds
 * what is left in the token-per-minute window — and the window that matters is
 * the *underlying* model's, not the one whose limits the response headers
 * report. `groq/compound` dispatches to a search model (llama-4-scout, 30k TPM)
 * whose remaining budget is invisible to us, so the only way to discover a
 * size that fits is to ask.
 *
 * Halving on each refusal converges in a couple of attempts and, unlike a
 * fixed lower clamp, still uses the full budget when the window is idle.
 * A truncated-but-delivered report beats a failed run; below
 * MIN_COMPLETION_TOKENS the output would be useless, so it fails instead.
 */
async function chatWithinBudget(body) {
  let budget = body.max_completion_tokens;

  for (;;) {
    try {
      return await chatTolerant({ ...body, max_completion_tokens: budget });
    } catch (err) {
      const tooLarge = err instanceof ProviderError && err.status === 413;
      if (!tooLarge || budget <= MIN_COMPLETION_TOKENS) throw err;

      budget = Math.max(MIN_COMPLETION_TOKENS, Math.floor(budget / 2));
      logger.warn('Groq refused the request size; retrying with a smaller budget', {
        provider: NAME,
        model: body.model,
        maxCompletionTokens: budget,
      });
    }
  }
}

/**
 * A 400 that names a specific request field. The field name must appear in the
 * body — matching on generic wording like "not supported" would make every
 * handler here swallow every other handler's error.
 */
const rejectsField = (err, fieldPattern) =>
  err instanceof ProviderError &&
  err.status === 400 &&
  new RegExp(fieldPattern, 'i').test(String(err.body || err.message));

/** The account/model cannot run server-side search (or the field was rejected). */
const isSearchUnavailable = (err) =>
  err instanceof ProviderError &&
  (err.status === 400 || err.status === 403 || err.status === 404) &&
  /search|tool|entitle|permission|credit|billing|model/i.test(String(err.body || err.message));

/**
 * The request was refused for capacity rather than correctness.
 *
 * Groq surfaces the same underlying condition two ways — 429 with a
 * `rate_limit_exceeded` body, or 413 `request_too_large` — and which one you
 * get is not predictable from the request.
 */
const isRateLimited = (err) =>
  err instanceof ProviderError && (err.status === 429 || err.status === 413);

/**
 * Research without web search.
 *
 * Deliberately switches to `GROQ_MODEL` rather than reusing the research model.
 * `groq/compound` dispatches to a separate search model (llama-4-scout) that
 * carries its own, much smaller token budget — and it does so *even with tools
 * disabled*, so retrying the ungrounded call on the same model reproduces the
 * exact rate limit we are falling back from. The synthesis model has an
 * independent budget and is reachable when compound is not.
 *
 * The result is a desk-reasoned brief with no citations. That is a real
 * downgrade, and it is reported honestly: `grounded: false` and zero citations
 * flow through to the report, where confidence is capped and the Sources
 * section says so.
 */
async function ungroundedResearch(base) {
  const { model } = cfg();
  if (model === base.model) return chatWithinBudget(base);

  logger.warn('Falling back to the synthesis model for ungrounded research', {
    provider: NAME,
    from: base.model,
    to: model,
  });
  return chatWithinBudget({ ...base, model });
}

/** Send `body`; if the model rejects `temperature`, drop it and send once more. */
async function chatTolerant(body) {
  try {
    return await chat(body);
  } catch (err) {
    if (!('temperature' in body) || !rejectsField(err, 'temperature')) throw err;
    logger.warn('Groq rejected `temperature`; retrying without it', {
      provider: NAME,
      model: body.model,
    });
    const { temperature, ...rest } = body;
    return chat(rest);
  }
}

const readText = (data) => (data?.choices?.[0]?.message?.content || '').trim();

/**
 * Citations from `groq/compound`.
 *
 * The agentic models report what they ran in `message.executed_tools`. A search
 * tool's `output` is a plain string of blocks shaped:
 *
 *     Title: <title>
 *     URL: <url>
 *     Content: <page text…>
 *
 * There is no structured citation array to read instead, so the blocks are
 * parsed. Anything that does not match is skipped rather than guessed at — a
 * fabricated source would be worse than a missing one.
 */
function readCitations(data) {
  const executed = data?.choices?.[0]?.message?.executed_tools || [];
  const found = [];

  for (const tool of executed) {
    const output = typeof tool?.output === 'string' ? tool.output : '';
    if (!output) continue;

    const re = /^Title:\s*(.*)\s*$\n^URL:\s*(\S+)\s*$/gm;
    let match = re.exec(output);
    while (match) {
      found.push({ title: match[1].trim(), url: match[2].trim() });
      match = re.exec(output);
    }

    // A tool that searched but whose output shape we did not recognise still
    // has URLs worth keeping, so fall back to a bare URL sweep for that tool.
    if (!found.length) {
      for (const url of output.match(/https?:\/\/[^\s<>"')\]]+/g) || []) {
        found.push({ url });
      }
    }
  }

  return dedupeCitations(found);
}

/** How many searches the agentic model actually ran. */
const readSearchCount = (data) =>
  (data?.choices?.[0]?.message?.executed_tools || []).filter((t) =>
    /search/i.test(String(t?.type || t?.name || '')),
  ).length;

function readUsage(data) {
  const u = data?.usage || {};
  const inputTokens = u.prompt_tokens ?? 0;
  const outputTokens = u.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: u.total_tokens ?? inputTokens + outputTokens,
  };
}

const messages = (system, prompt) => [
  { role: 'system', content: system },
  { role: 'user', content: prompt },
];

/**
 * Groq's reasoning models take `max_completion_tokens`, not `max_tokens`, and
 * spend part of that budget on hidden reasoning before emitting a visible
 * character. Starve it and the call returns empty content, or a 400
 * `json_validate_failed` with an empty `failed_generation`.
 *
 * But the budget cannot simply be raised: Groq **rejects** (413) any request
 * whose `max_completion_tokens` exceeds what is left in the token-per-minute
 * window, rather than truncating. The analysis services ask for ceilings sized
 * for providers without that constraint (16k on synthesis, vs a free tier of
 * 8k TPM), so the request is clamped here to what this account can actually be
 * admitted with.
 *
 * The clamp is a floor on capability, not a tuning knob: too low and a large
 * report truncates mid-JSON. `GROQ_MAX_COMPLETION_TOKENS` should be raised
 * alongside the Groq tier, or set to 0 to send the service's figure unchanged.
 */
function clampCompletionTokens(requested) {
  const ceiling = cfg().maxCompletionTokens;
  if (!ceiling) return requested;
  if (requested > ceiling) {
    logger.debug('Groq completion budget clamped to fit the account tier', {
      provider: NAME,
      requested,
      ceiling,
    });
  }
  return Math.min(requested, ceiling);
}

/** Grounded research call. Falls back to ungrounded only when `mode=auto`. */
export async function research({ system, prompt, maxOutputTokens = 6000 }) {
  const { researchModel, searchMode, maxSearchResults } = cfg();

  const base = {
    model: researchModel,
    messages: messages(system, prompt),
    max_completion_tokens: clampCompletionTokens(maxOutputTokens),
    temperature: 0.3,
  };

  /**
   * `enabled_tools` is not merely a filter — it is what keeps the request
   * inside the token window. Left to its default toolset, `groq/compound`
   * assembles a request large enough to be refused outright (413) on the
   * smaller tiers. Restricting it to web search is both what this call needs
   * and what makes it fit.
   *
   * `search_settings.max_results` is deliberately not sent: it was measured to
   * push the request back over the limit, and Groq gives no way to cap result
   * count without it. `GROQ_MAX_SEARCH_RESULTS` therefore only bounds how many
   * citations we keep, not how many the model fetches.
   */
  const withSearch = {
    ...base,
    compound_custom: { tools: { enabled_tools: ['web_search'] } },
  };

  let data;
  let grounded = searchMode !== 'off';

  if (!grounded) {
    data = await ungroundedResearch(base);
  } else {
    try {
      data = await chatWithinBudget(withSearch);
    } catch (err) {
      // `on` means grounding is required — let the failure stand so failover
      // can try another provider rather than quietly returning desk opinion.
      if (searchMode === 'on') throw err;
      if (!isSearchUnavailable(err) && !isRateLimited(err)) throw err;
      logger.warn('Groq web search unavailable; retrying ungrounded', {
        provider: NAME,
        status: err.status,
        error: err.message,
      });
      data = await ungroundedResearch(base);
      grounded = false;
    }
  }

  const text = readText(data);
  if (!text) {
    throw new ProviderError('Groq returned an empty research response', {
      provider: NAME,
      retryable: true,
    });
  }

  // Capped here rather than at the API, which offers no usable knob — see the
  // note on `withSearch` above.
  const citations = readCitations(data).slice(0, maxSearchResults);
  return {
    provider: NAME,
    // What actually answered, which is not always the model we asked for —
    // an ungrounded fallback runs on GROQ_MODEL. The report stores this, so it
    // must not claim a model that never ran.
    model: data?.model || researchModel,
    text,
    citations,
    // A run that asked for search but came back with nothing fetched is not
    // grounded, whatever mode requested — the report must not claim evidence
    // it does not have.
    grounded: grounded && citations.length > 0,
    searchCount: readSearchCount(data) || citations.length,
    usage: readUsage(data),
  };
}

/** Structured synthesis call — strict JSON schema, no search. */
export async function synthesize({
  system,
  prompt,
  schema,
  schemaName = 'analysis',
  maxOutputTokens = 8000,
}) {
  const { model } = cfg();

  const body = {
    model,
    messages: messages(system, prompt),
    max_completion_tokens: clampCompletionTokens(maxOutputTokens),
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema: toOpenAiSchema(schema) },
    },
  };

  let data;
  try {
    data = await chatWithinBudget(body);
  } catch (err) {
    // Some models here accept only the coarser `json_object` mode, and a
    // reasoning model that overruns its budget reports the same 400 shape.
    // Falling back keeps the run alive: the prompt already states the schema in
    // full, and the output is validated against it downstream either way.
    if (!rejectsField(err, 'json_schema|response_format|json_validate_failed')) throw err;
    logger.warn('Groq rejected strict json_schema; retrying with json_object', {
      provider: NAME,
      model,
    });
    data = await chatWithinBudget({ ...body, response_format: { type: 'json_object' } });
  }

  const text = readText(data);
  const json = extractJson(text);
  if (!json) {
    throw new ProviderError('Groq returned no parsable JSON for the analysis', {
      provider: NAME,
      retryable: true,
      body: text?.slice(0, 400),
    });
  }

  return { provider: NAME, model, json, usage: readUsage(data) };
}

export default { name: NAME, isConfigured, describe, research, synthesize };
