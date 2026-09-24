/**
 * Add the two per-engagement fields to the Vendor Master (p12) schema:
 *
 *   work_scope        "Wiring, DB and lighting" — what this vendor is doing HERE
 *   linked_task_code  "MR-BPL-001-T019"        — the execution task it sits under
 *
 * Same reason migrateBoqDerivedFields.js exists: a project's form reads its
 * field list from the Template *document* in Mongo, copied from the seed when
 * the template was first published. Editing `clientFlowTemplate.js` changes
 * what a FRESH database gets and nothing else, so every existing deployment
 * keeps the old schema until something rewrites it.
 *
 * Without these two fields the vendor drill-down's "Work assigned on this
 * project" panel has nothing to render — it is the one part of that screen
 * whose data did not already exist.
 *
 * Non-destructive and idempotent: appends the two fields only if absent, only
 * on stages keyed `p12`, and reports without saving unless `--apply` is passed.
 *
 *   node src/seed/migrateVendorWorkScope.js            # dry run
 *   node src/seed/migrateVendorWorkScope.js --apply    # persist
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

const VENDOR_STAGE_KEY = 'p12';
const APPLY = process.argv.includes('--apply');

/** Kept in step with the same two entries in clientFlowTemplate.js. */
const NEW_FIELDS = [
  {
    key: 'work_scope',
    label: 'Work to be done',
    type: 'textarea',
    section: 'Work on this project',
    order: 7.5,
    helpText: 'The scope this vendor is engaged for, e.g. "Wiring, DB and lighting".',
  },
  {
    key: 'linked_task_code',
    label: 'Linked Task Code',
    type: 'text',
    section: 'Work on this project',
    order: 7.6,
    helpText: 'The execution task this work sits under, e.g. MR-BPL-001-T019.',
  },
];

async function run() {
  await connectDatabase();

  const templates = await Template.find({ 'stages.key': VENDOR_STAGE_KEY });
  if (!templates.length) {
    console.log('No template has a Vendor Master (p12) stage — nothing to do.');
    return;
  }

  let changed = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === VENDOR_STAGE_KEY);
    if (!stage) continue;
    stage.masterDataSchema = stage.masterDataSchema || [];

    const notes = [];
    for (const field of NEW_FIELDS) {
      if (stage.masterDataSchema.some((f) => f.key === field.key)) {
        continue; // already there — re-running must be a no-op
      }
      stage.masterDataSchema.push({ ...field });
      notes.push(`+ ${field.key} (${field.label})`);
    }

    if (!notes.length) continue;

    console.log(`${APPLY ? '✔' : '·'} ${template.name}`);
    notes.forEach((n) => console.log(`    ${n}`));

    if (APPLY) {
      // Nested array-of-subdocuments — Mongoose does not always see a mutation
      // this deep, so mark it explicitly (same as migrateBoqDerivedFields).
      template.markModified('stages');
      await template.save();
    }
    changed += 1;
  }

  console.log(
    changed === 0
      ? '\nNothing to change — every template already has both fields.'
      : `\n${changed} template(s) ${APPLY ? 'updated.' : 'would change — re-run with --apply to persist.'}`,
  );
}

run()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
