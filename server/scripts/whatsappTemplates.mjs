/**
 * PMS WhatsApp templates — status check, pre-flight lint, and paste-ready output.
 *
 * WHY THIS EXISTS. "Are the templates approved?" was only answerable by opening
 * the SmartWhap dashboard, and the answer drifted from what the spec claimed.
 * This asks the provider directly and compares it against the catalogue in
 * src/modules/pms/whatsapp/whatsapp.templates.js.
 *
 *   npm run whatsapp:templates            status of every PMS template
 *   npm run whatsapp:templates -- --all   also list everything on the account
 *   npm run whatsapp:templates -- --print paste-ready blocks for the dashboard
 *   npm run whatsapp:templates -- --submit try the provider create API
 *
 * ON --submit. SmartWhap's v2 API is READ-ONLY: every path answers 405 with
 * "Supported methods: GET, HEAD", including paths that do not exist, so this is
 * a catch-all and not a scope problem. Templates must be created by a human in
 * the dashboard. --submit exists so that stays a proven fact rather than a
 * claim — it reports the provider's own refusal, then prints the paste blocks.
 *
 * READ-ONLY BY DEFAULT. Nothing here writes to the database or sends a message.
 */
import { execFile } from 'node:child_process';
import dotenv from 'dotenv';
import { PMS_TEMPLATES, countVariables } from '../src/modules/pms/whatsapp/whatsapp.templates.js';

dotenv.config();

/* eslint-disable no-console */
const has = (flag) => process.argv.includes(`--${flag}`);
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

/**
 * Put the body on the clipboard so the dashboard step is paste-only. Typing a
 * body by hand is where a stray character costs an approval round.
 */
function copyToClipboard(text) {
  const [cmd, args] = process.platform === 'win32'
    ? ['clip', []]
    : process.platform === 'darwin'
      ? ['pbcopy', []]
      : ['xclip', ['-selection', 'clipboard']];
  return new Promise((resolve) => {
    const child = execFile(cmd, args, (error) => resolve(!error));
    child.stdin.end(text);
  });
}

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const BASE = (process.env.WHATSAPP_BASE_URL || 'https://app.smartwhap.com/api/v2').replace(/\/+$/, '');

const mask = (t) => (t.length > 10 ? `${t.slice(0, 5)}****${t.slice(-4)}` : '****');

/* ── Pre-flight lint: the rules that cause most Meta rejections ────── */

function lint(t) {
  const problems = [];
  const body = t.body.trim();
  const positions = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));

  if (!/^[a-z0-9_]+$/.test(t.name)) problems.push('name must be lowercase with underscores');
  if (/^\{\{/.test(body)) problems.push('body starts with a placeholder');
  if (/\}\}$/.test(body)) problems.push('body ends with a placeholder');
  if (/\}\}\s*\{\{/.test(body)) problems.push('two placeholders sit next to each other');

  const expected = positions.map((_, i) => i + 1);
  if (positions.join(',') !== expected.join(',')) {
    problems.push(`placeholders must run 1..n in order, found ${positions.join(',') || 'none'}`);
  }
  if (t.samples.length !== positions.length) {
    problems.push(`${positions.length} placeholders but ${t.samples.length} sample values`);
  }
  if (t.bindings && t.bindings.length !== positions.length) {
    problems.push(`${positions.length} placeholders but ${t.bindings.length} field bindings`);
  }
  return problems;
}

/* ── Provider ─────────────────────────────────────────────────────── */

async function listRemote() {
  const res = await fetch(`${BASE}/templates`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET /templates -> ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data?.data || []).map((t) => ({
    name: t.template_name || t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    variableCount: countVariables(t.body_data || ''),
  }));
}

async function trySubmit(t) {
  const payload = {
    name: t.name,
    category: t.category,
    language: t.language,
    body: t.body,
    body_sample_values: t.samples,
    footer: t.footer,
  };
  const res = await fetch(`${BASE}/whatsapp-template`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = (await res.text()).replace(/\s+/g, ' ').trim();
  return { status: res.status, body: text.slice(0, 200) };
}

/* ── Paste-ready output for the dashboard ─────────────────────────── */

function printBlock(t) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`Name       ${t.name}`);
  console.log(`Category   ${t.category}          Language   ${t.language}`);
  console.log(`Footer     ${t.footer}`);
  console.log(`Header     (none)                 Buttons    (none)`);
  console.log(`Body:\n`);
  console.log(t.body);
  console.log(`\nSample values, in order:`);
  t.samples.forEach((s, i) => console.log(`  {{${i + 1}}}  ${s}`));
}

/* ── Main ─────────────────────────────────────────────────────────── */

async function main() {
  // --copy runs offline: it is the dashboard helper, not a status check.
  const wanted = arg('copy');
  if (wanted) {
    const t = PMS_TEMPLATES.find((x) => x.name === wanted);
    if (!t) {
      console.log(`\nNo template named ${wanted}. Known: ${PMS_TEMPLATES.map((x) => x.name).join(', ')}\n`);
      process.exitCode = 1;
      return;
    }
    const copied = await copyToClipboard(t.body);
    printBlock(t);
    console.log(copied ? '\n  Body copied to the clipboard — paste it into the dashboard.\n'
      : '\n  Could not reach the clipboard; copy the body above by hand.\n');
    return;
  }

  console.log(`\nSmartWhap ${BASE}`);
  if (!TOKEN) {
    console.log('WHATSAPP_ACCESS_TOKEN is not set — cannot check status. Fill server/.env.');
    process.exitCode = 1;
    return;
  }
  console.log(`Token     ${mask(TOKEN)}\n`);

  let lintFailures = 0;
  for (const t of PMS_TEMPLATES) {
    const problems = lint(t);
    if (problems.length) {
      lintFailures += 1;
      console.log(`  LINT  ${t.name}`);
      problems.forEach((p) => console.log(`        - ${p}`));
    }
  }
  if (lintFailures) console.log('');

  const remote = await listRemote();
  const byName = new Map(remote.map((r) => [r.name, r]));

  console.log(`PMS templates (${PMS_TEMPLATES.length} expected, ${remote.length} on the account)\n`);
  const missing = [];
  for (const t of PMS_TEMPLATES) {
    const hit = byName.get(t.name);
    if (!hit) {
      missing.push(t);
      console.log(`  NOT CREATED  ${t.name.padEnd(22)} ${t.event}`);
    } else {
      const mismatch = hit.variableCount !== countVariables(t.body)
        ? ` (provider has ${hit.variableCount} variables, catalogue has ${countVariables(t.body)})`
        : '';
      console.log(`  ${String(hit.status).padEnd(12)} ${t.name.padEnd(22)} ${hit.category}/${hit.language}${mismatch}`);
    }
  }

  if (has('all')) {
    console.log(`\nEverything on the account:\n`);
    for (const r of remote.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${String(r.status).padEnd(12)} ${r.name.padEnd(28)} ${r.category}/${r.language}`);
    }
  }

  if (has('submit') && missing.length) {
    console.log(`\nTrying the provider create API for ${missing.length} missing template(s):\n`);
    let unsupported = false;
    for (const t of missing) {
      const { status, body } = await trySubmit(t);
      console.log(`  POST /whatsapp-template ${t.name} -> ${status}  ${body}`);
      if ([404, 405, 501].includes(status)) unsupported = true;
    }
    if (unsupported) {
      console.log(
        '\n  The provider API does not accept template creation — this is a read-only\n' +
        '  API. Create them in the SmartWhap dashboard using the blocks below.',
      );
    }
  }

  if (missing.length && (has('print') || has('submit'))) {
    console.log(`\nPaste these into SmartWhap > Templates > Create:`);
    missing.forEach(printBlock);
    console.log(`\n${'─'.repeat(64)}`);
  } else if (missing.length) {
    console.log(`\n  ${missing.length} template(s) not created. Run with --print for paste-ready blocks.`);
  }

  console.log(
    missing.length
      ? '\nUntil these are APPROVED, every PMS WhatsApp notification will fail at send time.\n'
      : '\nAll PMS templates exist on the account.\n',
  );
  process.exitCode = missing.length || lintFailures ? 1 : 0;
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}\n`);
  process.exitCode = 1;
});
