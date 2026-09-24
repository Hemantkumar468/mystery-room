/**
 * xAI / Grok adapter — `POST /v1/chat/completions`.
 *
 * xAI's surface is OpenAI-compatible for the parts we use, with one addition
 * that matters here: **Live Search**, passed as `search_parameters`, which is
 * how this adapter gets grounded citations. Structured outputs use the same
 * strict `json_schema` dialect as OpenAI, so `toOpenAiSchema` is reused rather
 * than a third schema translation being invented.
 *
 * Two deliberate bits of self-healing, because model tiers on this API differ
 * in what parameters they accept and switching tier should be an env change:
 *
 *  • A 400 that complains about an unsupported tuning parameter (`temperature`
 *    on the reasoning models) is retried once without it, instead of making
 *    every model change a code change.
 *  • Live Search is a metered add-on. When `XAI_SEARCH_MODE=auto` and the
 *    account cannot use search at all, the research call is retried ungrounded
 *    and flagged as such (`grounded: false`, zero citations) so the report's
 *    confidence and Sources sections tell the truth about it. Set
 *    `XAI_SEARCH_MODE=on` to make an ungrounded run a hard failure instead.
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

const NAME = AI_PROVIDER.GROK;

const cfg = () => config.ai.grok;

export const isConfigured = () => Boolean(cfg().apiKey);

export const describe = () => ({
  label: 'xAI Grok',
  model: cfg().model,
  baseUrl: cfg().baseUrl,
  keyEnv: 'XAI_API_KEY',
  docsUrl: 'https://console.x.ai',
  /** Grounded research is available but metered, and can be switched off. */
  grounding: cfg().searchMode === 'off' ? 'none' : 'xai_live_search',
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
  });
}

/**
 * A 400 that names a specific request field. The field name must appear in the
 * body — matching on generic wording like "not supported" instead would make
 * every handler here swallow every other handler's error.
 */
const rejectsField = (err, fieldPattern) =>
  err instanceof ProviderError &&
  err.status === 400 &&
  new RegExp(fieldPattern, 'i').test(String(err.body || err.message));

/**
 * The account cannot use Live Search — no entitlement, or the field was
 * rejected outright.
 *
 * 410 is included because xAI has **deprecated Live Search**: sending
 * `search_parameters` now returns
 *   410 "Live search is deprecated. Please switch to the Agent Tools API."
 * Treating that as "search unavailable" lets a run degrade to an ungrounded,
 * clearly-labelled report instead of failing outright. It is a stopgap, not a
 * fix — restoring real grounding here means porting this adapter to xAI's
 * Agent Tools API (https://docs.x.ai/docs/guides/tools/overview).
 */
const isSearchUnavailable = (err) =>
  err instanceof ProviderError &&
  (err.status === 400 || err.status === 403 || err.status === 404 || err.status === 410) &&
  /search|entitle|permission|credit|billing|deprecat/i.test(String(err.body || err.message));

/**
 * Send `body`; if the model rejects `temperature`, drop it and send once more.
 * Nothing else about the request changes.
 */
async function chatTolerant(body) {
  try {
    return await chat(body);
  } catch (err) {
    if (!('temperature' in body) || !rejectsField(err, 'temperature')) throw err;
    logger.warn('Grok rejected `temperature`; retrying without it', {
      provider: NAME,
      model: body.model,
    });
    const { temperature, ...rest } = body;
    return chat(rest);
  }
}

const readText = (data) => (data?.choices?.[0]?.message?.content || '').trim();

/**
 * Citations arrive as a bare URL array — either top-level or on the message,
 * depending on the endpoint version. Newer responses can also carry richer
 * `search_results` entries with titles, which are preferred when present
 * because a titled source is far more useful in the report's Sources list.
 */
function readCitations(data) {
  const message = data?.choices?.[0]?.message || {};
  const results = data?.search_results || message.search_results || [];
  if (Array.isArray(results) && results.length) {
    return dedupeCitations(
      results
        .filter((r) => r?.url)
        .map((r) => ({ url: r.url, title: r.title || r.snippet_title })),
    );
  }

  const urls = data?.citations || message.citations || [];
  return dedupeCitations(
    urls
      .map((c) => (typeof c === 'string' ? { url: c } : { url: c?.url, title: c?.title }))
      .filter((c) => c.url),
  );
}

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

/** Live Search bills per source used; xAI reports the count in usage. */
const readSourcesUsed = (data) =>
  data?.usage?.num_sources_used ?? data?.usage?.number_searches ?? 0;

const messages = (system, prompt) => [
  { role: 'system', content: system },
  { role: 'user', content: prompt },
];

/** Grounded research call. Falls back to ungrounded only when `mode=auto`. */
export async function research({ system, prompt, maxOutputTokens = 6000 }) {
  const { model, searchMode, maxSearchResults } = cfg();

  const base = {
    model,
    messages: messages(system, prompt),
    max_tokens: maxOutputTokens,
    temperature: 0.3,
  };

  const withSearch = {
    ...base,
    search_parameters: {
      mode: searchMode === 'off' ? 'off' : searchMode,
      return_citations: true,
      max_search_results: maxSearchResults,
      // Web and news carry the local-geography evidence this module needs; X
      // is included because Indian neighbourhood chatter (traffic, flooding,
      // new openings) surfaces there before it reaches indexed pages.
      sources: [{ type: 'web' }, { type: 'news' }, { type: 'x' }],
    },
  };

  let data;
  let grounded = searchMode !== 'off';

  if (!grounded) {
    data = await chatTolerant(base);
  } else {
    try {
      data = await chatTolerant(withSearch);
    } catch (err) {
      // `on` means grounding is required — let the failure stand so failover
      // can try another provider rather than quietly returning desk opinion.
      if (searchMode === 'on' || !isSearchUnavailable(err)) throw err;
      logger.warn('Grok Live Search unavailable; retrying ungrounded', {
        provider: NAME,
        status: err.status,
        error: err.message,
      });
      data = await chatTolerant(base);
      grounded = false;
    }
  }

  const text = readText(data);
  if (!text) {
    throw new ProviderError('Grok returned an empty research response', {
      provider: NAME,
      retryable: true,
    });
  }

  const citations = readCitations(data);
  return {
    provider: NAME,
    model,
    text,
    citations,
    grounded,
    searchCount: readSourcesUsed(data) || citations.length,
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
    max_tokens: maxOutputTokens,
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema: toOpenAiSchema(schema) },
    },
  };

  let data;
  try {
    data = await chatTolerant(body);
  } catch (err) {
    // Some tiers accept only the coarser `json_object` mode. Falling back to it
    // keeps the run alive: the prompt already states the schema in full, and
    // the synthesis output is validated against it downstream either way.
    if (!rejectsField(err, 'json_schema|response_format')) throw err;
    logger.warn('Grok rejected strict json_schema; retrying with json_object', {
      provider: NAME,
      model,
    });
    data = await chatTolerant({ ...body, response_format: { type: 'json_object' } });
  }

  const text = readText(data);
  const json = extractJson(text);
  if (!json) {
    throw new ProviderError('Grok returned no parsable JSON for the analysis', {
      provider: NAME,
      retryable: true,
      body: text?.slice(0, 400),
    });
  }

  return { provider: NAME, model, json, usage: readUsage(data) };
}

export default { name: NAME, isConfigured, describe, research, synthesize };
