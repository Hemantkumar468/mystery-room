/* eslint-disable no-console */
/**
 * The template's phases, written out as a spreadsheet and as a doc table.
 *
 * WHY THIS EXISTS. `docs/PMS_TEMPLATE_OVERVIEW.md` said "15 phases, 56 tasks"
 * while the seed had grown to 17 and 59 — a hand-maintained copy of machine
 * data, and it drifted the moment somebody added a phase. Anything anyone has
 * to remember to update is already wrong.
 *
 * So both outputs are generated FROM THE SEED, never typed:
 *
 *   server/SHEET/Template phases.xlsx   — one row per phase, for editing and
 *                                         circulating outside the app
 *   docs/PMS_TEMPLATE_OVERVIEW.md       — the "Contents" counts and the
 *                                         client-flow phase table, rewritten
 *                                         in place between two markers
 *
 * Run it after any change to a template seed:
 *
 *   node src/seed/exportTemplatePhases.mjs
 *
 * It reads the seed files directly and touches no database.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/* No spreadsheet package in this repo, and one report is not a reason to
   add one — see lib/miniXlsx.mjs. */
import { writeXlsx } from './lib/miniXlsx.mjs';

import clientFlow from './clientFlowTemplate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '../..');
const ROOT = path.resolve(SERVER, '..');

/** Every template this script knows how to write out. */
const TEMPLATES = [clientFlow];

/**
 * One phase, flattened.
 *
 * `Runs with` and `Branch of` are the two facts the diagram is drawn from and
 * the two a reader cannot get from a list of names — a phase that runs beside
 * another, and a phase that hangs off one and blocks nothing.
 */
function phaseRows(tpl) {
  return (tpl.stages || []).map((s, i) => ({
    '#': i + 1,
    Key: s.key,
    Phase: s.name,
    'SLA days': s.slaDays ?? '',
    Department: s.ownerDepartment ?? '',
    Tasks: (s.tasks || []).length,
    Modules: (s.assessmentTypes || []).length,
    'Runs with': s.parallelGroup || '',
    'Branch of': s.branchOf || '',
    Gate: s.gate ? (s.gate.label || 'yes') : '',
    Capture: s.captureMode || 'single',
    'Exit criteria': (s.exitCriteria || '').replace(/\s+/g, ' '),
  }));
}

/** Every task, so the sheet answers "who does what" as well as "what". */
function taskRows(tpl) {
  const out = [];
  (tpl.stages || []).forEach((s, i) => {
    (s.tasks || []).forEach((t, j) => {
      out.push({
        Phase: `${i + 1}. ${s.name}`,
        '#': j + 1,
        Task: t.title,
        Department: t.department || s.ownerDepartment || '',
        Priority: t.priority || '',
        'Est. days': t.estimatedDays ?? '',
        Doer: [...(t.assignees || []), t.primaryAssignee].filter(Boolean).join(', '),
        Backup: [...(t.backupAssignees || []), t.backupAssignee].filter(Boolean).join(', '),
        Checklist: (t.checklist || []).length,
      });
    });
  });
  return out;
}

const summary = (tpl) => {
  const rows = phaseRows(tpl);
  return {
    Template: tpl.name,
    Code: tpl.code,
    Status: tpl.status,
    Default: tpl.isDefault ? 'yes' : 'no',
    Phases: rows.length,
    Tasks: rows.reduce((a, r) => a + r.Tasks, 0),
    'Plan days': rows.reduce((a, r) => a + (Number(r['SLA days']) || 0), 0),
    Gates: rows.filter((r) => r.Gate).length,
    Branches: rows.filter((r) => r['Branch of']).length,
  };
};

/* ── the spreadsheet ─────────────────────────────────────────────────── */
function writeWorkbook() {
  const sheets = [{ name: 'Summary', rows: TEMPLATES.map(summary) }];
  for (const tpl of TEMPLATES) {
    const base = tpl.code.replace(/^MR-(PMS-)?/, '');
    sheets.push({ name: `${base} phases`, rows: phaseRows(tpl) });
    sheets.push({ name: `${base} tasks`, rows: taskRows(tpl) });
  }
  return writeXlsx(path.join(SERVER, 'SHEET', 'Template phases.xlsx'), sheets);
}

/* ── the doc ─────────────────────────────────────────────────────────── */
const md = (v) => String(v ?? '').replace(/\|/g, '\\|');

function phaseTable(tpl) {
  const rows = phaseRows(tpl);
  const head = '| # | Phase | Key | SLA | Dept | Tasks | Runs with | Branch of | Gate |';
  const rule = '|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r['#']} | ${md(r.Phase)} | \`${r.Key}\` | ${r['SLA days']}d | ${md(r.Department)} `
    + `| ${r.Tasks} | ${md(r['Runs with'] || '—')} | ${md(r['Branch of'] || '—')} | ${md(r.Gate || '—')} |`);
  return [head, rule, ...body].join('\n');
}

/**
 * Rewrite the generated block in place.
 *
 * The markers matter: everything a person wrote around them survives, and
 * everything between them is replaced wholesale. Without them this would
 * either clobber the prose or append a second copy every run.
 */
const START = '<!-- GENERATED:template-phases -->';
const END = '<!-- /GENERATED:template-phases -->';

function writeDoc() {
  const file = path.join(ROOT, 'docs', 'PMS_TEMPLATE_OVERVIEW.md');
  if (!fs.existsSync(file)) return null;
  let text = fs.readFileSync(file, 'utf8');

  const s = summary(clientFlow);
  const block = [
    START,
    '',
    `_Generated from \`server/src/seed/\` by \`exportTemplatePhases.mjs\` — do not edit by hand._`,
    '',
    `**${s.Template}** \`${s.Code}\` — **${s.Phases} phases**, ${s.Tasks} tasks, ${s['Plan days']} planned days, `
      + `${s.Gates} gate${s.Gates === 1 ? '' : 's'}, ${s.Branches} branch${s.Branches === 1 ? '' : 'es'}.`,
    '',
    phaseTable(clientFlow),
    '',
    END,
  ].join('\n');

  if (text.includes(START) && text.includes(END)) {
    text = text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
  } else {
    /* First run: put it directly under the Contents list, which is where the
       stale counts lived. */
    const anchor = '\n---\n';
    const at = text.indexOf(anchor);
    text = at === -1 ? `${text}\n\n${block}\n` : `${text.slice(0, at)}\n${block}\n${text.slice(at)}`;
  }

  /* The Contents line carried its own copy of the count. One number, one
     place — so it is rewritten rather than left to disagree. */
  text = text.replace(
    /- \*\*A\. Branch Opening — Client Flow\*\* `MR-PMS-CLIENT-FLOW` — \d+ phases, \d+ tasks/,
    `- **A. Branch Opening — Client Flow** \`MR-PMS-CLIENT-FLOW\` — ${s.Phases} phases, ${s.Tasks} tasks`,
  );

  fs.writeFileSync(file, text);
  return file;
}

const xlsx = writeWorkbook();
const doc = writeDoc();
const s = summary(clientFlow);
console.log(`${s.Template}: ${s.Phases} phases · ${s.Tasks} tasks · ${s['Plan days']} planned days`);
console.log(`  spreadsheet → ${path.relative(ROOT, xlsx)}`);
console.log(doc ? `  doc        → ${path.relative(ROOT, doc)}` : '  doc        → not found, skipped');
