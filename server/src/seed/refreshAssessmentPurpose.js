/**
 * Give the Purpose field of every Site Evaluation assessment its fixed text,
 * on every template that has one.
 *
 * Why a script rather than re-seeding: `seed.js` calls `Template.create`, which
 * wipes and rebuilds. The client-flow template has its own installer, but the
 * older "Store Launch" template has none — and live projects still run on it.
 * Leaving that one without the defaults would mean the same assessment asks
 * for a Purpose on one project and states it on another.
 *
 * Deliberately narrow: it ONLY sets `defaultValue` on the `purpose` field. It
 * does not replace the assessment forms, so any per-template customisation
 * survives untouched. A purpose that has already been given a default is left
 * alone unless --force.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/refreshAssessmentPurpose.js
 *   node src/seed/refreshAssessmentPurpose.js --apply
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

/** The canonical text, read from the seed definition — never duplicated here. */
const SOURCE = new Map(
  (storeLaunchTemplate.stages.find((s) => s.key === 'p2')?.assessmentTypes || []).map((a) => [
    a.key,
    (a.masterDataSchema || []).find((f) => f.key === 'purpose')?.defaultValue || null,
  ]),
);

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) - pass --apply to persist ==');
  console.log(`Purpose text known for: ${[...SOURCE.keys()].join(', ')}\n`);

  let changed = 0;
  for (const template of await Template.find({})) {
    const p2 = (template.stages || []).find((s) => s.key === 'p2');
    if (!p2?.assessmentTypes?.length) continue;
    console.log(`# ${template.name} [${template.code}]`);

    let touched = 0;
    for (const a of p2.assessmentTypes) {
      const text = SOURCE.get(a.key);
      const field = (a.masterDataSchema || []).find((f) => f.key === 'purpose');
      if (!text || !field) { console.log(`  ${a.key.padEnd(13)} skipped (no purpose field or no source text)`); continue; }
      if (field.defaultValue && !FORCE) { console.log(`  ${a.key.padEnd(13)} already set`); continue; }
      console.log(`  ${a.key.padEnd(13)} -> "${text.slice(0, 60)}…"`);
      if (APPLY) { field.defaultValue = text; touched += 1; }
    }

    if (APPLY && touched) {
      template.markModified('stages');
      await template.save();
      changed += touched;
      console.log(`  saved ${touched} field(s)`);
    }
  }

  console.log(APPLY
    ? `\nDone — ${changed} Purpose field(s) now fill themselves.`
    : '\nNothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
