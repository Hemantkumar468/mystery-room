/* eslint-disable no-console */
/**
 * One-time backfill: Feasibility's `footfall_assessment` field (a "/10"
 * score) never had `min`/`max` set on its template definition, so the
 * client-side NumberInput never clamped it — a user could type any number,
 * not just 0-10. `min: 0, max: 10` were added to the field's definition in
 * storeLaunchTemplate.js and to template.model.js's masterDataFieldSchema,
 * but that only affects templates created from now on — existing Template
 * documents already in the database still have the old, unbounded field.
 * This patches those in place.
 *
 * Always applies (idempotent) — safe to re-run; it only writes when a
 * template's footfall_assessment field doesn't already have min:0/max:10.
 *
 *   node src/seed/patchFootfallAssessmentRange.js
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

async function patch() {
  const templates = await Template.find({ 'stages.assessmentTypes.masterDataSchema.key': 'footfall_assessment' });
  console.log(`Found ${templates.length} template(s) with a footfall_assessment field.`);

  let patched = 0;
  for (const tpl of templates) {
    let changed = false;
    for (const stage of tpl.stages) {
      for (const at of stage.assessmentTypes || []) {
        for (const f of at.masterDataSchema || []) {
          if (f.key === 'footfall_assessment' && (f.min !== 0 || f.max !== 10)) {
            f.min = 0;
            f.max = 10;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      // eslint-disable-next-line no-await-in-loop
      await tpl.save();
      patched += 1;
      console.log(`Patched template "${tpl.name}" (${tpl._id})`);
    }
  }
  console.log(`Done — ${patched} template(s) patched, ${templates.length - patched} already correct.`);
}

async function main() {
  await connectDatabase();
  await patch();
}

main()
  .catch((err) => {
    console.error('✖ Patch failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
