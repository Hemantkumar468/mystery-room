/* eslint-disable no-console */
/**
 * `storeLaunchTemplate.js`'s p2 (Site Evaluation) `assessmentTypes` schema
 * gained new fields (Purpose on all four types, Financial's Profit Margin/
 * Financial Risk, Technical's Civil/HVAC/Maintenance, Operational's
 * Operations Readiness/Inventory/Training/Customer Flow) — but that file is
 * only ever read at `Template.create()` time during the original seed run.
 * Templates already sitting in the database (and every Project that
 * references one) won't see the new fields until the existing Template
 * document's `stages[p2].assessmentTypes` is patched in place.
 *
 * This does exactly that, and nothing else: no Project/Record is touched,
 * no other stage is touched, existing submitted values for fields that
 * still exist are untouched (Mongoose's Mixed `values` on each Record is
 * independent of the schema that renders it).
 *
 * SAFE BY DEFAULT: dry run, writes nothing. Pass --apply to persist.
 *   node src/seed/syncP2AssessmentSchema.js
 *   node src/seed/syncP2AssessmentSchema.js --apply
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING p2 assessmentTypes sync ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p2');
  if (!sourceStage) throw new Error('storeLaunchTemplate has no p2 stage — nothing to sync');

  const templates = await Template.find({ 'stages.key': 'p2' });
  console.log(`Found ${templates.length} template(s) with a p2 stage.`);

  // Compare by field keys only, not a raw JSON diff — Mongoose stamps a
  // fresh `_id` on every subdocument each time the array is reassigned, so a
  // literal JSON.stringify comparison would report "needs update" forever
  // even right after a successful apply.
  const fieldKeySignature = (assessmentTypes) =>
    assessmentTypes.map((t) => `${t.key}:${t.masterDataSchema.map((f) => f.key).join(',')}`).join('|');

  let patched = 0;
  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p2');
    if (!stage) continue;
    const before = fieldKeySignature(stage.assessmentTypes);
    const after = fieldKeySignature(sourceStage.assessmentTypes);
    if (before === after) {
      console.log(`  = ${template.name} (${template._id}) — already up to date`);
      continue;
    }
    console.log(`  ~ ${template.name} (${template._id}) — needs update`);
    if (APPLY) {
      stage.assessmentTypes = sourceStage.assessmentTypes;
      template.markModified('stages');
      // eslint-disable-next-line no-await-in-loop
      await template.save();
    }
    patched += 1;
  }

  console.log(`\n${APPLY ? '✅ Applied' : '🔎 Would apply'} — templates patched: ${patched}/${templates.length}`);
}

main()
  .catch((err) => {
    console.error('✖ p2 assessmentTypes sync failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
