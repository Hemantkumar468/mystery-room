/**
 * Gemini adapter — `POST /v1beta/models/{model}:generateContent`.
 *
 * Gemini is the default when both providers are configured: its `google_search`
 * grounding is first-party Google Search, which is materially better at the
 * hyper-local Indian questions this module asks ("which colleges are within
 * 5 km of this address", "is this stretch of road prone to waterlogging")
 * than a general web-search tool.
 *
 * Note the API constraint that shapes the whole pipeline: grounding and
 * `responseSchema` cannot be combined in one call. The research → synthesis
 * split satisfies that naturally rather than working around it.
 */

import { config } from '../../../config/index.js';
import { AI_PROVIDER } from '../ai.constants.js';
import {
  postJson,
  ProviderError,
  ProviderNotConfiguredError,
  toGeminiSchema,
  extractJson,
  dedupeCitations,
} from './base.js';

const NAME = AI_PROVIDER.GEMINI;

export const isConfigured = () => Boolean(config.ai.gemini.apiKey);

function requireKey() {
  if (!isConfigured()) throw new ProviderNotConfiguredError(NAME);
  return config.ai.gemini.apiKey;
}

async function generate(body) {
  const apiKey = requireKey();
  const model = config.ai.gemini.model;
  return postJson(`${config.ai.gemini.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
    // Header auth, not `?key=` — keeps the key out of proxy and access logs.
    headers: { 'x-goog-api-key': apiKey },
    body,
    timeoutMs: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
    provider: NAME,
  });
}

function readText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) {
    // A blocked prompt or an exhausted token budget both land here; surface
    // which one, because the operator fix is completely different.
    const reason =
      candidate?.finishReason ||
      data?.promptFeedback?.blockReason ||
      'no content returned';
    throw new ProviderError(`Gemini returned no text (${reason})`, {
      provider: NAME,
      // MAX_TOKENS is a config problem, not a transient one.
      retryable: reason !== 'MAX_TOKENS' && reason !== 'SAFETY',
    });
  }
  return text;
}

/** Grounded sources live in groundingMetadata.groundingChunks[].web. */
function readCitations(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return dedupeCitations(
    chunks
      .filter((c) => c?.web?.uri)
      .map((c) => ({ url: c.web.uri, title: c.web.title })),
  );
}

/** The queries Google actually ran — a useful audit trail of what was checked. */
const readSearchQueries = (data) =>
  data?.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];

function readUsage(data) {
  const u = data?.usageMetadata || {};
  const inputTokens = u.promptTokenCount ?? 0;
  const outputTokens = u.candidatesTokenCount ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: u.totalTokenCount ?? inputTokens + outputTokens,
  };
}

export async function research({ system, prompt, maxOutputTokens = 6000 }) {
  const data = await generate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3, maxOutputTokens },
  });

  const queries = readSearchQueries(data);
  return {
    provider: NAME,
    model: config.ai.gemini.model,
    text: readText(data),
    citations: readCitations(data),
    searchCount: queries.length,
    searchQueries: queries,
    usage: readUsage(data),
  };
}

export async function synthesize({ system, prompt, schema, maxOutputTokens = 8000 }) {
  const data = await generate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
    },
  });

  const text = readText(data);
  const json = extractJson(text);
  if (!json) {
    throw new ProviderError('Gemini returned no parsable JSON for the analysis', {
      provider: NAME,
      retryable: true,
      body: text?.slice(0, 400),
    });
  }

  return { provider: NAME, model: config.ai.gemini.model, json, usage: readUsage(data) };
}

export default { name: NAME, isConfigured, research, synthesize };
