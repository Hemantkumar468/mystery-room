/**
 * One-off migration: drop the retired `store_format` / `business_unit` /
 * `city` fields from every template's masterDataSchema (any stage, any
 * assessment type).
 *
 * Targeted field removal only — unlike `npm run seed`, this does NOT touch
 * users/projects/tasks, so in-flight project data is preserved.
 *
 * Safe to run more than once: templates with none of these fields are left
 * alone.
 *
 *   node src/seed/removeStoreFormatBusinessUnit.js            # apply
 *   node src/seed/removeStoreFormatBusinessUnit.js --dry-run  # report only
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const DROP_KEYS = new Set(['store_format', 'business_unit', 'city', 'currency']);
const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const templates = mongoose.connection.collection('templates');

  const docs = await templates.find({}).toArray();
  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will change' : 'Migrating templates'}\n`);
  console.log(`  found ${docs.length} template(s)`);

  let templatesChanged = 0;
  let fieldsRemoved = 0;

  for (const doc of docs) {
    let touched = false;
    for (const stage of doc.stages || []) {
      // Collection-mode stages (e.g. Property Identification) carry their
      // form fields directly on masterDataSchema, not nested under assessmentTypes.
      if (stage.masterDataSchema) {
        const before = stage.masterDataSchema.length;
        stage.masterDataSchema = stage.masterDataSchema.filter((f) => !DROP_KEYS.has(f.key));
        const removed = before - stage.masterDataSchema.length;
        if (removed) {
          fieldsRemoved += removed;
          touched = true;
          console.log(`  ${doc.name} → ${stage.name}: removed ${removed} field(s)`);
        }
      }
      for (const at of stage.assessmentTypes || []) {
        const before = (at.masterDataSchema || []).length;
        at.masterDataSchema = (at.masterDataSchema || []).filter((f) => !DROP_KEYS.has(f.key));
        const removed = before - at.masterDataSchema.length;
        if (removed) {
          fieldsRemoved += removed;
          touched = true;
          console.log(`  ${doc.name} → ${stage.name} → ${at.name}: removed ${removed} field(s)`);
        }
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
      `${templatesChanged} template(s), ${fieldsRemoved} field(s) ${DRY_RUN ? 'would be' : ''} removed.\n`,
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('\nMigration failed:', err.message, '\n');
  process.exit(1);
});
