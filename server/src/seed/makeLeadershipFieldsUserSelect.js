/**
 * One-off migration: switch the Project Creation "Leadership" fields
 * (Project Manager, Reporting Manager, Construction Head, Operations Head,
 * Owner) from free-text inputs to an employee-picker select, so they can be
 * chosen from the roster instead of typed by hand.
 *
 * Matches by field `key`, not by current type, so it's safe to run
 * regardless of the field's current type. Targeted field-type rewrite
 * only — unlike `npm run seed`, this does NOT touch users/projects/tasks.
 * Existing free-text values (e.g. "Priya Menon") are left as-is in stored
 * records; they just won't match a roster id until re-selected.
 *
 * Safe to run more than once: fields already typed 'user' are left alone.
 *
 *   node src/seed/makeLeadershipFieldsUserSelect.js            # apply
 *   node src/seed/makeLeadershipFieldsUserSelect.js --dry-run  # report only
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const RETYPE_KEYS = new Set([
  'project_manager', 'reporting_manager', 'construction_head', 'operations_head', 'owner',
]);
const NEW_TYPE = 'user';
const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const templates = mongoose.connection.collection('templates');

  const docs = await templates.find({}).toArray();
  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will change' : 'Migrating templates'}\n`);
  console.log(`  found ${docs.length} template(s)`);

  let templatesChanged = 0;
  let fieldsRetyped = 0;

  const retypeSchema = (schema, doc, where) => {
    let touched = false;
    for (const field of schema || []) {
      if (!RETYPE_KEYS.has(field.key) || field.type === NEW_TYPE) continue;
      console.log(`  ${doc.name} → ${where}: "${field.label}" (${field.type} → ${NEW_TYPE})`);
      field.type = NEW_TYPE;
      fieldsRetyped += 1;
      touched = true;
    }
    return touched;
  };

  for (const doc of docs) {
    let touched = false;
    for (const stage of doc.stages || []) {
      if (retypeSchema(stage.masterDataSchema, doc, stage.name)) touched = true;
      for (const at of stage.assessmentTypes || []) {
        if (retypeSchema(at.masterDataSchema, doc, `${stage.name} → ${at.name}`)) touched = true;
      }
    }
    if (touched) {
      templatesChanged += 1;
      if (!DRY_RUN) {
        await templates.updateOne({ _id: doc._id }, { $set: { stages: doc.stages } });
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? 'Dry run complete — no writes.' : 'Done.'} ` +
      `${templatesChanged} template(s), ${fieldsRetyped} field(s) ${DRY_RUN ? 'would be' : ''} retyped.\n`,
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('\nMigration failed:', err.message, '\n');
  process.exit(1);
});
