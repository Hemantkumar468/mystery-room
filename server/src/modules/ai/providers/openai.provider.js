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

export const isConfigured = () => Boolean(config.ai.openai.apiKey);

/** Self-description for the status endpoint — see providers/index.js. */
export const describe = () => ({
  label: 'OpenAI',
  model: config.ai.openai.model,
  baseUrl: config.ai.openai.baseUrl,
  keyEnv: 'OPENAI_API_KEY',
  docsUrl: 'https://platform.openai.com/api-keys',
  grounding: 'openai_web_search',
});

/**
 * Reasoning-family models reject `temperature`. Rather than maintain a model
 * allowlist that rots, detect the families that are known to refuse it and
 * simply omit the parameter for them — the API default is already low-variance.
 */
const supportsTemperature = (model) => !/^(o\d|gpt-5)/i.test(String(model || ''));

function requireKey() {
  if (!isConfigured()) throw new ProviderNotConfiguredError(NAME);
  return config.ai.openai.apiKey;
}

async function callResponses(body) {
  const apiKey = requireKey();
  return postJson(`${config.ai.openai.baseUrl}/responses`, {
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
 * Grounded research call. Retries once with the legacy tool name if the
 * account only exposes `web_search_preview`, so neither name has to be
 * guessed correctly at deploy time.
 */
export async function research({ system, prompt, maxOutputTokens = 6000 }) {
  const model = config.ai.openai.model;

  const build = (toolType) => ({
    model,
    instructions: system,
    input: prompt,
    tools: [{ type: toolType }],
    tool_choice: 'auto',
    max_output_tokens: maxOutputTokens,
  });

  let data;
  try {
    data = await callResponses(build(config.ai.openai.webSearchTool));
  } catch (err) {
    const alternate =
      config.ai.openai.webSearchTool === 'web_search' ? 'web_search_preview' : 'web_search';
    const looksLikeToolMismatch =
      err instanceof ProviderError &&
      err.status === 400 &&
      /web_search|tool/i.test(String(err.body || err.message));
    if (!looksLikeToolMismatch) throw err;
    data = await callResponses(build(alternate));
  }

  const text = readText(data);
  if (!text) {
    throw new ProviderError('OpenAI returned an empty research response', {
      provider: NAME,
      retryable: true,
    });
  }

  return {
    provider: NAME,
    model,
    text,
    citations: readCitations(data),
    searchCount: countSearches(data),
    usage: readUsage(data),
  };
}

/** Structured synthesis call — strict JSON schema, no tools. */
export async function synthesize({ system, prompt, schema, schemaName = 'analysis', maxOutputTokens = 8000 }) {
  const model = config.ai.openai.model;

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
