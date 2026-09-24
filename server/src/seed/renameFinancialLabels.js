/**
 * One-off migration: relabel finance jargon to plain English across every
 * template's masterDataSchema (any stage, any assessment type):
 *
 *   capex           CapEx / CAPEX          → Setup Cost
 *   opex            OpEx / OPEX (Monthly)  → Monthly Operating Cost
 *   roi             ROI (%)                → Return on Investment (%)
 *   payback_period  Payback Period (...)   → Investment Recovery Time (...)
 *
 * Matches by field `key`, not by old label text, so it's safe to run
 * regardless of what a field is currently labelled. Targeted label rewrite
 * only — unlike `npm run seed`, this does NOT touch users/projects/tasks.
 *
 * Safe to run more than once: fields already on the new label are left alone.
 *
 *   node src/seed/renameFinancialLabels.js            # apply
 *   node src/seed/renameFinancialLabels.js --dry-run  # report only
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

// Old label text is kept verbatim in the new label where it carried extra
// detail (e.g. "(%)", "(Monthly)") by just swapping the jargon prefix.
const RELABEL = {
  capex: () => 'Setup Cost',
  opex: () => 'Monthly Operating Cost',
  roi: (label) => label.replace(/^ROI/, 'Return on Investment'),
  payback_period: (label) => label.replace(/^Payback Period/, 'Investment Recovery Time'),
};

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const templates = mongoose.connection.collection('templates');

  const docs = await templates.find({}).toArray();
  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will change' : 'Migrating templates'}\n`);
  console.log(`  found ${docs.length} template(s)`);

  let templatesChanged = 0;
  let fieldsRenamed = 0;

  const relabelSchema = (schema, doc, where) => {
    let touched = false;
    for (const field of schema || []) {
      const rewrite = RELABEL[field.key];
      if (!rewrite) continue;
      const newLabel = rewrite(field.label);
      if (newLabel !== field.label) {
        console.log(`  ${doc.name} → ${where}: "${field.label}" → "${newLabel}"`);
        field.label = newLabel;
        fieldsRenamed += 1;
        touched = true;
      }
    }
    return touched;
  };

  for (const doc of docs) {
    let touched = false;
    for (const stage of doc.stages || []) {
      if (relabelSchema(stage.masterDataSchema, doc, stage.name)) touched = true;
      for (const at of stage.assessmentTypes || []) {
        if (relabelSchema(at.masterDataSchema, doc, `${stage.name} → ${at.name}`)) touched = true;
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
      `${templatesChanged} template(s), ${fieldsRenamed} field(s) ${DRY_RUN ? 'would be' : ''} relabelled.\n`,
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('\nMigration failed:', err.message, '\n');
  process.exit(1);
});
