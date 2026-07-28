/**
 * Operator diagnostic for the AI provider key.
 *
 * Inspects the key's shape, then makes a real (tiny) call to Google to find out
 * whether the key is accepted, and via which auth style. Never prints the key.
 *
 * Run:  node check-ai-key.mjs        (safe to delete once the module is working)
 */
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.GEMINI_API_KEY || '';
const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const model = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

console.log('\n── Config ─────────────────────────────────');
console.log('  AI_ENABLED     ', process.env.AI_ENABLED || '(default true)');
console.log('  AI_PROVIDER    ', process.env.AI_PROVIDER || '(default auto)');
console.log('  GEMINI_MODEL   ', model);
console.log('  GEMINI_BASE_URL', base);

if (!key) {
  console.log('\n  GEMINI_API_KEY  MISSING or empty — paste it into server/.env, save, re-run.\n');
  process.exit(1);
}

/* ── Shape checks: catch a malformed key before blaming Google ── */
console.log('\n── Key shape ──────────────────────────────');
const problems = [];
console.log('  length         ', key.length, '(an AI Studio key is normally 39)');
console.log('  starts with    ', JSON.stringify(key.slice(0, 4)), '(should be "AIza")');

if (!key.startsWith('AIza')) problems.push('Does not start with "AIza" — this may not be an AI Studio API key.');
if (key !== key.trim()) problems.push('Has leading/trailing whitespace.');
if (/^["']|["']$/.test(key)) problems.push('Wrapped in quotes — remove them from .env.');
if (/\s/.test(key)) problems.push('Contains a space, tab or newline in the middle.');
if (/[^\w-]/.test(key)) problems.push('Contains characters outside [A-Za-z0-9_-].');
if (key.length !== 39) problems.push(`Unusual length (${key.length}) — a truncated paste is the usual cause.`);

if (problems.length) problems.forEach((p) => console.log('  ISSUE:', p));
else console.log('  shape          looks like a valid AI Studio key');

/* ── Live checks: which auth style does Google accept? ── */
async function probe(label, url, headers) {
  try {
    const res = await fetch(url, { headers });
    const body = await res.text();
    if (res.ok) {
      const models = JSON.parse(body).models || [];
      console.log(`  ${label.padEnd(22)} OK (${models.length} models visible)`);
      return models.map((m) => m.name.replace('models/', ''));
    }
    let reason = '';
    try {
      const e = JSON.parse(body).error;
      reason = `${e.status || e.code}: ${String(e.message).split('.')[0]}`;
    } catch {
      reason = body.slice(0, 90);
    }
    console.log(`  ${label.padEnd(22)} FAIL ${res.status} — ${reason}`);
    return null;
  } catch (err) {
    console.log(`  ${label.padEnd(22)} NETWORK ERROR — ${err.message}`);
    return null;
  }
}

console.log('\n── Live check against Google ──────────────');
const viaHeader = await probe('x-goog-api-key header', `${base}/models`, { 'x-goog-api-key': key });
const viaQuery = await probe('?key= query param', `${base}/models?key=${encodeURIComponent(key)}`, {});

const models = viaHeader || viaQuery;

if (models) {
  const has = models.includes(model);
  console.log(`\n  configured model "${model}" available? ${has ? 'YES' : 'NO'}`);
  if (!has) {
    console.log('  models this key can actually use:');
    models
      .filter((m) => m.startsWith('gemini-') && !m.includes('embedding'))
      .slice(0, 10)
      .forEach((m) => console.log('    -', m));
  }
  console.log(
    viaHeader
      ? '\n  RESULT: key is valid. If analysis still fails, it is quota or the model name.\n'
      : '\n  RESULT: key works, but ONLY via ?key= — tell me and I will switch the adapter.\n',
  );
} else {
  console.log('\n  RESULT: Google rejected this key both ways. Most likely one of:');
  console.log('    1. It is not an AI Studio key. A Google Cloud OAuth client ID or a');
  console.log('       service account produces exactly this "Expected OAuth 2 access');
  console.log('       token" error. Get a real one at https://aistudio.google.com/apikey');
  console.log('    2. The key has HTTP-referrer / IP restrictions that block a server call.');
  console.log('    3. The Generative Language API is not enabled on its Cloud project.');
  console.log('    4. The key was deleted or regenerated after you copied it.\n');
}
