/* eslint-disable no-console */
/**
 * One-time migration: remove the "Documents" and "Doer's Notes" fields from
 * Property Identification (p1)'s masterDataSchema, to match the updated
 * template definition in storeLaunchTemplate.js. "Audio" stays.
 *
 * Touches only each template's `p1` stage's masterDataSchema — no other
 * stage, project, or record data is modified. Any already-submitted p1
 * Record whose `values` still has `documents`/`notes` keeps that data (it's
 * just no longer shown, since the form now renders off the trimmed schema).
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP1RemoveDocsNotes.js            # preview only
 *   node src/seed/migrateP1RemoveDocsNotes.js --apply     # actually migrate
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

const REMOVED_KEYS = new Set(['documents', 'notes']);
const APPLY = process.argv.includes('--apply');

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p1' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p1');
    if (!stage) continue;

    const before = stage.masterDataSchema.length;
    const kept = stage.masterDataSchema.filter((f) => !REMOVED_KEYS.has(f.key));
    if (kept.length === before) continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    console.log(`  • p1 masterDataSchema: ${before} fields -> ${kept.length} fields (removed ${before - kept.length})`);

    stage.masterDataSchema = kept;
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
