/* eslint-disable no-console */
/**
 * One-time migration: give the four Phase 2 assessment tasks their `formKey`,
 * so `project.service.js#syncAssessmentTasks` can finally do the one thing it
 * was built for — splitting each into its own task per shortlisted property.
 *
 * WHY THIS WAS NEEDED. `syncAssessmentTasks` matches a template task to an
 * assessmentType by `t.formKey && formKeys.has(t.formKey)`. The four p2 tasks
 * in storeLaunchTemplate.js (`p2_t1`..`p2_t4`) never carried a `formKey` — an
 * oversight, not a design choice; the field exists on the Task schema
 * specifically for this. With none of them matching, that filter always came
 * back empty and the function returned immediately: every property ever
 * shortlisted under this template got ZERO Phase 2 tasks — no per-property
 * assignee, no plan date, nothing for My Tasks or this queue's Assigned/Plan
 * Date columns to read. The fix in storeLaunchTemplate.js only affects a
 * FRESH seed; this migration brings the Template documents already sitting in
 * the database up to the same definition, and a second pass
 * (`syncAssessmentTasks.js --apply`) then creates the tasks the fix unblocks
 * for every property already shortlisted.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to
 * persist. Touches only the four named tasks' `formKey` within each
 * template's `p2` stage — no other field, stage, project or record.
 *
 *   node src/seed/migrateP2AssessmentFormKeys.js            # preview only
 *   node src/seed/migrateP2AssessmentFormKeys.js --apply    # actually migrate
 *
 * Run `node src/seed/syncAssessmentTasks.js --apply` straight after, to
 * create the now-unblocked tasks for properties already shortlisted.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p2');
/* Task key → the formKey it should carry, read off the corrected source file
   rather than hand-duplicated, so this migration can never drift from it. */
const WANTED = new Map(sourceStage.tasks.filter((t) => t.formKey).map((t) => [t.key, t.formKey]));

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p2' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p2');
    if (!stage) continue;

    const changes = [];
    for (const task of stage.tasks || []) {
      const want = WANTED.get(task.key);
      if (!want || task.formKey === want) continue;
      changes.push(`  • ${task.key} "${task.title}": formKey "${task.formKey || '(none)'}" -> "${want}"`);
      task.formKey = want;
    }
    if (!changes.length) continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    changes.forEach((line) => console.log(line));
    template.markModified('stages');
    touched += 1;

    if (APPLY) await template.save();
  }

  console.log(`\nTemplates with a p2 stage needing this: ${touched}`);
  return touched;
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING migration ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const touched = await migrate();
  console.log(`\n${APPLY ? 'Applied' : 'Would update'}: ${touched} template(s).`);
  if (APPLY && touched) {
    console.log('\nNext: node src/seed/syncAssessmentTasks.js --apply');
    console.log('  (creates the per-property tasks this unblocks, for properties already shortlisted)');
  }
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
