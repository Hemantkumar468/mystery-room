/* eslint-disable no-console */
/**
 * MIGRATION — two small drift fixes on p11's stored masterDataSchema, on the
 * already-stored MR-PMS-CLIENT-FLOW template.
 *
 * Editing clientFlowTemplate.js alone (done) only changes what a NEW template
 * install gets — every project already points at the stored Template document
 * in Mongo, which keeps its own snapshot of masterDataSchema.
 *
 *   1. Drop "Approved" from `checklist_status`'s options. Without this, every
 *      existing project's Phase 5 form would still let a filer set their own
 *      drawing to "Approved" directly, defeating the gated Approve/Resend
 *      workflow (designDrawingsFms.service.js).
 *   2. Drop `required` from `drawing_type`. It has no `showIf`, so it was
 *      unconditionally required on every p11 submission — including a
 *      checklist upload (Design & Drawings FMS's Upload action), which files
 *      `checklist_drawing` instead and has no reason to fill it. That blocked
 *      every checklist upload with "Drawing Type is required" until fixed.
 *
 * DRY RUN BY DEFAULT.
 *
 *   node src/seed/migrateP11StatusOptions.js            # dry run
 *   node src/seed/migrateP11StatusOptions.js --apply    # actually write
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { DRAWING_STATUS_APPROVED } from './drawingChecklist.js';

const APPLY = process.argv.includes('--apply');
const CODE = 'MR-PMS-CLIENT-FLOW';

async function run() {
  const template = await Template.findOne({ code: CODE });
  if (!template) {
    console.log(`No stored template "${CODE}" — nothing to migrate.`);
    return;
  }

  const stage = template.stages.find((s) => s.key === 'p11');
  if (!stage) {
    console.log(`Template "${CODE}" has no p11 stage — nothing to migrate.`);
    return;
  }

  let changed = false;

  const statusField = stage.masterDataSchema.find((f) => f.key === 'checklist_status');
  if (!statusField) {
    console.log('p11 has no checklist_status field — skipping fix 1.');
  } else if (!statusField.options.includes(DRAWING_STATUS_APPROVED)) {
    console.log('Fix 1: checklist_status already excludes "Approved" — nothing to do.');
  } else {
    console.log(`Fix 1: checklist_status options [${statusField.options.join(', ')}]`);
    const next = statusField.options.filter((o) => o !== DRAWING_STATUS_APPROVED);
    console.log(`         -> [${next.join(', ')}]`);
    if (APPLY) { statusField.options = next; }
    changed = true;
  }

  const typeField = stage.masterDataSchema.find((f) => f.key === 'drawing_type');
  if (!typeField) {
    console.log('p11 has no drawing_type field — skipping fix 2.');
  } else if (!typeField.required) {
    console.log('Fix 2: drawing_type is already not required — nothing to do.');
  } else {
    console.log('Fix 2: drawing_type.required true -> false');
    if (APPLY) { typeField.required = false; }
    changed = true;
  }

  if (!changed) {
    console.log('\nNothing to migrate.');
    return;
  }

  if (APPLY) {
    template.markModified('stages');
    await template.save();
    console.log('\nSaved.');
  } else {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to commit.');
  }
}

connectDatabase()
  .then(run)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(disconnectDatabase);
