/**
 * OpenAI adapter — Responses API (`POST /v1/responses`).
 *
 * Exposes the two capabilities the analysis pipeline needs:
 *   research()  → grounded prose + citations, using the hosted web_search tool
 *   synthesize() → strict JSON matching a schema, no tools
 *
 * They are separate calls on purpose. Structured outputs are most reliable
 * when the model is not also juggling tool calls, and keeping retrieval apart
 * from reasoning means the evidence behind a score can be shown to a human.
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

const NAME = AI_PROVIDER.OPENAI;

/** Read config at call time, not import time — tests and benchmarks retune it. */
const cfg = () => config.ai.openai;

export const isConfigured = () => Boolean(cfg().apiKey);

/** Self-description for the status endpoint — see providers/index.js. */
export const describe = () => ({
  label: 'OpenAI',
  model: cfg().model,
  researchModel: cfg().researchModel,
  baseUrl: cfg().baseUrl,
  keyEnv: 'OPENAI_API_KEY',
  docsUrl: 'https://platform.openai.com/api-keys',
  grounding: cfg().searchMode === 'off' ? 'none' : 'openai_web_search',
});

/**
 * Reasoning-family models reject `temperature`. Rather than maintain a model
 * allowlist that rots, detect the families that are known to refuse it and
 * simply omit the parameter for them — the API default is already low-variance.
 */
const supportsTemperature = (model) => !/^(o\d|gpt-5)/i.test(String(model || ''));

/**
 * The inverse of the above: the reasoning families that accept a `reasoning`
 * block. Sending one to a non-reasoning model is a 400, so this gates it.
 */
const supportsReasoning = (model) => /^(o\d|gpt-5)/i.test(String(model || ''));

function requireKey() {
  if (!isConfigured()) throw new ProviderNotConfiguredError(NAME);
  return cfg().apiKey;
}

async function callResponses(body) {
  const apiKey = requireKey();
  return postJson(`${cfg().baseUrl}/responses`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    timeoutMs: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
    provider: NAME,
  });
}

/** Concatenate every `output_text` part across the response's message items. */
function readText(data) {
  const chunks = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
    }
  }
  // `output_text` is the SDK's convenience field; present on some responses.
  if (!chunks.length && typeof data?.output_text === 'string') chunks.push(data.output_text);
  return chunks.join('\n').trim();
}

/** Web citations arrive as `url_citation` annotations on the output text. */
function readCitations(data) {
  const found = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      for (const ann of part?.annotations || []) {
        if (ann?.type === 'url_citation' && ann.url) {
          found.push({ url: ann.url, title: ann.title });
        }
      }
    }
  }
  return dedupeCitations(found);
}

function readUsage(data) {
  const u = data?.usage || {};
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: u.total_tokens ?? inputTokens + outputTokens,
  };
}

/** How many hosted web searches the model actually ran — an evidence signal. */
const countSearches = (data) =>
  (data?.output || []).filter((i) => String(i?.type || '').startsWith('web_search')).length;

/**
 * Grounded research call.
 *
 * Two things beyond a plain request:
 *
 *  1. Tool-name drift. Retries once with the legacy `web_search_preview` name
 *     if the account only exposes that, so neither name has to be guessed
 *     correctly at deploy time.
 *  2. Grounding enforcement. `tool_choice: 'auto'` lets the model decide
 *     whether to search at all, and in practice it sometimes decides not to —
 *     observed on this pipeline's own prompts: the same model on the same
 *     property returned 16 citations on one run and zero on the next, the
 *     second being a short brief written from the model's priors. Nothing
 *     downstream could tell the two apart, so an uncited brief would go on to
 *     score a multi-year lease. Under `OPENAI_SEARCH_MODE=on` the tool is
 *     mandatory, the result is verified to actually carry citations, and one
 *     retry is spent before the run is failed rather than published.
 */
export async function research({ system, prompt, maxOutputTokens = 6000 }) {
  const { model: synthModel, researchModel, searchMode, webSearchTool } = cfg();
  const model = researchModel || synthModel;
  const grounding = searchMode !== 'off';

  const build = (toolType) => {
    const body = { model, instructions: system, input: prompt, max_output_tokens: maxOutputTokens };
    if (grounding) {
      body.tools = [{ type: toolType }];
      // 'required' guarantees at least one tool call; the model may still stop
      // after one, which is why the citation check below exists as well.
      body.tool_choice = searchMode === 'on' ? 'required' : 'auto';
    }
    return body;
  };

  const callWithToolFallback = async () => {
    try {
      return await callResponses(build(webSearchTool));
    } catch (err) {
      const alternate = webSearchTool === 'web_search' ? 'web_search_preview' : 'web_search';
      const looksLikeToolMismatch =
        err instanceof ProviderError &&
        err.status === 400 &&
        /web_search|tool/i.test(String(err.body || err.message));
      if (!looksLikeToolMismatch) throw err;
      return callResponses(build(alternate));
    }
  };

  let data = await callWithToolFallback();
  let citations = readCitations(data);
  let searchCount = countSearches(data);

  // One retry when a mandatory-grounding run came back with nothing to cite.
  // Retrying is worth it because the failure is non-deterministic; failing
  // after that is the point of the setting.
  if (searchMode === 'on' && !citations.length) {
    logger.warn('OpenAI research returned no citations; retrying with grounding enforced', {
      model,
      searchCount,
    });
    data = await callWithToolFallback();
    citations = readCitations(data);
    searchCount = countSearches(data);
  }

  const text = readText(data);
  if (!text) {
    throw new ProviderError('OpenAI returned an empty research response', {
      provider: NAME,
      retryable: true,
    });
  }

  if (searchMode === 'on' && !citations.length) {
    throw new ProviderError(
      'OpenAI produced an ungrounded research brief (no web citations after retry). '
        + 'Set OPENAI_SEARCH_MODE=auto to allow ungrounded reports.',
      { provider: NAME, retryable: true },
    );
  }

  return {
    provider: NAME,
    model,
    text,
    citations,
    searchCount,
    // `auto` may legitimately produce an ungrounded brief; say so plainly so the
    // report's confidence score and the UI can reflect it.
    grounded: grounding && citations.length > 0,
    usage: readUsage(data),
  };
}

/** Structured synthesis call — strict JSON schema, no tools. */
export async function synthesize({ system, prompt, schema, schemaName = 'analysis', maxOutputTokens = 8000 }) {
  const model = cfg().model;

  const body = {
    model,
    instructions: system,
    input: prompt,
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema: toOpenAiSchema(schema),
      },
    },
  };
  if (supportsTemperature(model)) body.temperature = 0.2;
  // Latency here is dominated by internal reasoning tokens, not by emitting the
  // report — see OPENAI_REASONING_EFFORT in config for why this is tuned down.
  if (supportsReasoning(model) && cfg().reasoningEffort) {
    body.reasoning = { effort: cfg().reasoningEffort };
  }

  const data = await callResponses(body);
  const text = readText(data);
  const json = extractJson(text);

  if (!json) {
    throw new ProviderError('OpenAI returned no parsable JSON for the analysis', {
      provider: NAME,
      retryable: true,
      body: text?.slice(0, 400),
    });
  }

  return { provider: NAME, model, json, usage: readUsage(data) };
}

export default { name: NAME, isConfigured, describe, research, synthesize };
