/**
 * Operator diagnostic for the AI provider keys.
 *
 * Reads .env, then makes one real (tiny, free) call per configured provider to
 * answer the only two questions that matter after switching vendor:
 *   1. Is this key accepted?
 *   2. Is the model named in .env one this key can actually use?
 *
 * Never prints a key. Nothing here imports the app — it deliberately talks to
 * the vendor APIs directly, so it still works when the server will not boot.
 *
 * Run:  node check-ai-key.mjs            (all configured providers)
 *       node check-ai-key.mjs grok       (just one)
 */
import dotenv from 'dotenv';

dotenv.config();

const only = (process.argv[2] || '').trim().toLowerCase();

/**
 * One entry per provider, mirroring providers/*.provider.js. Each knows how to
 * list the models a key can see; adding a vendor here is a few lines.
 */
const PROVIDERS = [
  {
    name: 'grok',
    label: 'xAI Grok',
    keyEnv: 'XAI_API_KEY',
    key: process.env.XAI_API_KEY || process.env.GROK_API_KEY,
    keyNote: 'set XAI_API_KEY (or GROK_API_KEY) — get one at https://console.x.ai',
    base: (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, ''),
    model: process.env.XAI_MODEL || 'grok-4-fast-reasoning',
    modelEnv: 'XAI_MODEL',
    shape: (k) => (k.startsWith('xai-') ? [] : ['Does not start with "xai-" — check you copied an API key, not a team id.']),
    async listModels({ base, key }) {
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
      return { res, ids: (j) => (j.data || j.models || []).map((m) => m.id || m.name) };
    },
    extras: [
      'Live Search (grounded citations) is a metered add-on on xAI. If the key has',
      'no search entitlement, the adapter falls back to an ungrounded run and the',
      'report says so. Set XAI_SEARCH_MODE=on to make that a hard failure instead.',
    ],
  },
  {
    name: 'groq',
    label: 'Groq',
    keyEnv: 'GROQ_API_KEY',
    key: process.env.GROQ_API_KEY,
    keyNote: 'set GROQ_API_KEY — get one at https://console.groq.com/keys',
    base: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    modelEnv: 'GROQ_MODEL',
    // Groq splits the pipeline across two models, so both are checked.
    extraModels: [
      { env: 'GROQ_RESEARCH_MODEL', value: process.env.GROQ_RESEARCH_MODEL || 'groq/compound' },
    ],
    shape: (k) =>
      k.startsWith('gsk_')
        ? []
        : ['Does not start with "gsk_" — an xAI key ("xai-") belongs in XAI_API_KEY, not here; these are different vendors.'],
    async listModels({ base, key }) {
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
      return { res, ids: (j) => (j.data || []).map((m) => m.id) };
    },
    extras: [
      'Free-tier accounts are limited to 8,000 tokens/minute, which one grounded',
      'research call can approach. If runs fail with 429, raise the tier at',
      'https://console.groq.com/settings/billing or configure a second provider',
      'as failover (e.g. AI_PROVIDER=groq,gemini).',
    ],
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    keyEnv: 'GEMINI_API_KEY',
    key: process.env.GEMINI_API_KEY,
    keyNote: 'set GEMINI_API_KEY — get one at https://aistudio.google.com/apikey',
    base: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    modelEnv: 'GEMINI_MODEL',
    // Two key formats are in circulation: the classic 39-char "AIza…" key and
    // the newer "AQ.…" key AI Studio now issues. Both are valid.
    shape: (k) => {
      if (k.startsWith('AQ.')) return [];
      if (!k.startsWith('AIza')) {
        return ['Starts with neither "AIza" nor "AQ." — a Cloud OAuth client or service account will not work; use an AI Studio key.'];
      }
      return k.length === 39
        ? []
        : [`Unusual length (${k.length}, normally 39) — a truncated paste is the usual cause.`];
    },
    extras: [
      'google_search grounding is quota\'d separately from ordinary generation.',
      'On the free tier that quota is often zero: plain prompts and structured',
      'output succeed while grounded calls return 429. GEMINI_SEARCH_MODE=auto',
      'degrades those runs to an ungrounded, clearly-labelled report.',
    ],
    async listModels({ base, key }) {
      const res = await fetch(`${base}/models`, { headers: { 'x-goog-api-key': key } });
      return { res, ids: (j) => (j.models || []).map((m) => String(m.name).replace('models/', '')) };
    },
  },
  {
    name: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    key: process.env.OPENAI_API_KEY,
    keyNote: 'set OPENAI_API_KEY — get one at https://platform.openai.com/api-keys',
    base: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-5',
    modelEnv: 'OPENAI_MODEL',
    shape: (k) => (k.startsWith('sk-') ? [] : ['Does not start with "sk-".']),
    async listModels({ base, key }) {
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
      return { res, ids: (j) => (j.data || []).map((m) => m.id) };
    },
  },
];

/* Shape problems every key shares — whitespace and stray quotes from .env. */
const commonShapeProblems = (k) => {
  const problems = [];
  if (k !== k.trim()) problems.push('Has leading/trailing whitespace.');
  if (/^["']|["']$/.test(k)) problems.push('Wrapped in quotes — remove them from .env.');
  if (/\s/.test(k.trim())) problems.push('Contains a space, tab or newline in the middle.');
  return problems;
};

console.log('\n══ AI configuration ═══════════════════════════════');
console.log('  AI_ENABLED  ', process.env.AI_ENABLED || '(default true)');
console.log('  AI_PROVIDER ', process.env.AI_PROVIDER || '(default auto)');
console.log(
  '\n  AI_PROVIDER takes "auto" or an explicit comma-separated order,\n' +
    '  which is also the failover chain — e.g. AI_PROVIDER=grok,gemini',
);

const targets = PROVIDERS.filter((p) => (only ? p.name === only : true));

if (only && !targets.length) {
  console.log(`\n  Unknown provider "${only}". Valid: ${PROVIDERS.map((p) => p.name).join(', ')}\n`);
  process.exit(1);
}

let anyWorking = false;

for (const p of targets) {
  console.log(`\n══ ${p.label} (${p.name}) ══════════════════════════`);

  if (!p.key) {
    // Not an error when checking every provider — most deployments run one.
    console.log(`  ${p.keyEnv.padEnd(16)} not set — ${p.keyNote}`);
    continue;
  }

  console.log(`  ${p.modelEnv.padEnd(16)} ${p.model}`);
  console.log(`  base URL         ${p.base}`);

  const problems = [...commonShapeProblems(p.key), ...p.shape(p.key.trim())];
  if (problems.length) {
    console.log('\n  Key shape:');
    problems.forEach((x) => console.log('    ISSUE:', x));
  } else {
    console.log(`  key shape        looks right (${p.key.length} chars)`);
  }

  try {
    const { res, ids } = await p.listModels({ base: p.base, key: p.key.trim() });
    const body = await res.text();

    if (!res.ok) {
      let reason = body.slice(0, 140);
      try {
        const e = JSON.parse(body);
        reason = e.error?.message || e.msg || e.message || reason;
      } catch { /* keep the raw snippet */ }
      console.log(`  live check       REJECTED ${res.status} — ${String(reason).split('\n')[0]}`);
      continue;
    }

    const models = ids(JSON.parse(body));
    console.log(`  live check       OK — key accepted, ${models.length} models visible`);
    anyWorking = true;

    // Every model this provider needs — the main one plus, for providers that
    // split the pipeline, the research model.
    const needed = [{ env: p.modelEnv, value: p.model }, ...(p.extraModels || [])];
    let allPresent = true;

    for (const { env, value } of needed) {
      if (models.includes(value)) {
        console.log(`  ${env.padEnd(20)} available? YES  (${value})`);
      } else {
        allPresent = false;
        console.log(`  ${env.padEnd(20)} available? NO — "${value}" is not in this key's list.`);
      }
    }

    if (!allPresent) {
      console.log('  models this key can use:');
      models
        .filter((m) => !/embed|whisper|tts|image|dall|guard|vision-preview/i.test(m))
        .slice(0, 12)
        .forEach((m) => console.log('    -', m));
    }
  } catch (err) {
    console.log(`  live check       NETWORK ERROR — ${err.message}`);
  }

  (p.extras || []).forEach((line) => console.log(`  note: ${line}`));
}

console.log(
  anyWorking
    ? '\n══ Result: at least one provider is usable. ═══════\n'
    : '\n══ Result: no provider is usable yet — fix the issues above. ══\n',
);
process.exit(anyWorking ? 0 : 1);
