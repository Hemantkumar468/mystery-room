/* eslint-disable no-console */
/**
 * One-time migration: bring an already-seeded database's Approval Workflow
 * (p7) stage definition up to date with the six-stage generic pipeline now
 * defined in storeLaunchTemplate.js (Department Review / Functional Review /
 * Finance Approval / Legal Review / Management Approval / Final Approval),
 * replacing the previous twelve per-department sign-off modules
 * (Construction/Interior/.../Management/CEO-MD) that migrateP7ApprovalWorkflow.js
 * introduced.
 *
 * Re-running `npm run seed` would apply this too, but it destroys every
 * project/record/user in the database — this migration instead updates only
 * the p7 stage of every Template document that has one, in place, leaving
 * every project, record and user untouched.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP7ApprovalWorkflowV2.js            # preview only
 *   node src/seed/migrateP7ApprovalWorkflowV2.js --apply     # actually migrate
 *
 * Touches only each template's `p7` stage (assessmentTypes, captureMode,
 * recordNoun, masterDataSchema) — no other stage, project, or record data is
 * modified. Any existing p7 Records whose `assessmentType` is one of the old
 * twelve department keys (e.g. 'construction', 'management', 'ceo_md') are
 * left in place but orphaned — they no longer match any of the new six
 * pipeline-stage keys, so they simply stop counting toward this stage's
 * progress, same as the prior migration left the flat-schema records it
 * superseded. This migration does not remap or delete old records.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p7');

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p7' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p7');
    if (!stage) continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    console.log(`  • assessmentTypes: ${stage.assessmentTypes?.length || 0} -> ${sourceStage.assessmentTypes.length}`);
    console.log(`  • recordNoun: "${stage.recordNoun}" -> "${sourceStage.recordNoun}"`);

    stage.assessmentTypes = sourceStage.assessmentTypes;
    stage.captureMode = sourceStage.captureMode;
    stage.recordNoun = sourceStage.recordNoun;
    stage.masterDataSchema = sourceStage.masterDataSchema;
    template.markModified('stages');
    touched += 1;

    if (APPLY) await template.save();
  }

  console.log(`\nTemplates with a p7 stage: ${touched}`);
  return touched;
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING migration ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const touched = await migrate();
  console.log(`\n${APPLY ? 'Applied' : 'Would update'}: ${touched} template(s).`);
}

main()
  .catch((err) => {
    console.error('✖ Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
