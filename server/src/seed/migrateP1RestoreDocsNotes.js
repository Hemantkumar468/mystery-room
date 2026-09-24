/* eslint-disable no-console */
/**
 * One-time migration: reverts migrateP1RemoveDocsNotes.js — restores the
 * "Documents" and "Doer's Notes" fields to Property Identification (p1)'s
 * masterDataSchema, back to the definition in storeLaunchTemplate.js.
 *
 * Touches only each template's `p1` stage's masterDataSchema — no other
 * stage, project, or record data is modified.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP1RestoreDocsNotes.js            # preview only
 *   node src/seed/migrateP1RestoreDocsNotes.js --apply     # actually migrate
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p1');

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p1' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p1');
    if (!stage) continue;

    const existingKeys = new Set(stage.masterDataSchema.map((f) => f.key));
    const missing = sourceStage.masterDataSchema.filter((f) => !existingKeys.has(f.key));
    if (!missing.length) continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    console.log(`  • p1 masterDataSchema: ${stage.masterDataSchema.length} fields -> ${stage.masterDataSchema.length + missing.length} fields (restoring ${missing.map((f) => f.key).join(', ')})`);

    stage.masterDataSchema = sourceStage.masterDataSchema;
    template.markModified('stages');
    touched += 1;

    if (APPLY) await template.save();
  }

  console.log(`\nTemplates with a p1 stage needing update: ${touched}`);
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
