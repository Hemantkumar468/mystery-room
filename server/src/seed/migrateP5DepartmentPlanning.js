/* eslint-disable no-console */
/**
 * One-time migration: bring an already-seeded database's Department Planning
 * (p5) stage definition up to date with the ten-department assessmentTypes
 * defined in storeLaunchTemplate.js (Construction/Interior/Procurement/
 * Automation/IT/Marketing/HR/Finance/Operations/Legal — replacing the old
 * empty/flat schema).
 *
 * Re-running `npm run seed` would apply this too, but it destroys every
 * project/record/user in the database — this migration instead updates only
 * the p5 stage of every Template document that has one, in place, leaving
 * every project, record and user untouched.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP5DepartmentPlanning.js            # preview only
 *   node src/seed/migrateP5DepartmentPlanning.js --apply     # actually migrate
 *
 * Touches only each template's `p5` stage (assessmentTypes, description,
 * recordNoun, captureMode) — no other stage, project, or record data is
 * modified.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p5');

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p5' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p5');
    if (!stage) continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    console.log(`  • captureMode: "${stage.captureMode}" -> "${sourceStage.captureMode}"`);
    console.log(`  • assessmentTypes: ${stage.assessmentTypes?.length || 0} -> ${sourceStage.assessmentTypes.length}`);
    console.log(`  • recordNoun: "${stage.recordNoun}" -> "${sourceStage.recordNoun}"`);
    console.log(`  • description: "${stage.description}" -> "${sourceStage.description}"`);

    stage.captureMode = sourceStage.captureMode;
    stage.masterDataSchema = sourceStage.masterDataSchema;
    stage.assessmentTypes = sourceStage.assessmentTypes;
    stage.recordNoun = sourceStage.recordNoun;
    stage.description = sourceStage.description;
    template.markModified('stages');
    touched += 1;

    if (APPLY) await template.save();
  }

  console.log(`\nTemplates with a p5 stage: ${touched}`);
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
