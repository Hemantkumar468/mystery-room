/* eslint-disable no-console */
/**
 * One-time migration: blank out the "Doer's Notes" label on Property
 * Identification (p1)'s `notes` field, to match storeLaunchTemplate.js.
 * The field itself (a textarea) stays — only its visible label text is
 * removed.
 *
 * Touches only each template's `p1.masterDataSchema[].notes.label` — no
 * other field, stage, project, or record data is modified.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP1NotesLabel.js            # preview only
 *   node src/seed/migrateP1NotesLabel.js --apply     # actually migrate
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

const APPLY = process.argv.includes('--apply');

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p1' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p1');
    const field = stage?.masterDataSchema?.find((f) => f.key === 'notes');
    if (!field || field.label === '') continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    console.log(`  • p1.notes label: "${field.label}" -> ""`);

    field.label = '';
    template.markModified('stages');
    touched += 1;

    if (APPLY) await template.save();
  }

  console.log(`\nTemplates needing update: ${touched}`);
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
