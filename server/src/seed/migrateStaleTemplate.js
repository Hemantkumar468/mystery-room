/* eslint-disable no-console */
/**
 * MIGRATION — refresh a stored Template's stage blueprints from the source
 * definition in storeLaunchTemplate.js.
 *
 * Two things drifted:
 *
 *   1. `taskCategory` was missing from templateTaskSchema, so Mongoose
 *      silently dropped it on every save. The stored p8/p9 blueprint tasks
 *      therefore carry no category at all — which is why Store Readiness had
 *      to hardcode its nine categories in client code, and why the p8/p9
 *      "mandatory module coverage" gates stay inert. (The schema is fixed;
 *      the stored data still needs rewriting.)
 *
 *   2. The stored blueprint is simply older than the source — e.g. 10 p8
 *      tasks stored against 81 defined.
 *
 * Rewrites ONLY `stages[].tasks` and `stages[].assessmentTypes` for stages
 * the source defines. Never touches project data, and never touches a stage
 * the source doesn't know about.
 *
 * DRY RUN BY DEFAULT.
 *
 *   node src/seed/migrateStaleTemplate.js            # dry run
 *   node src/seed/migrateStaleTemplate.js --apply    # actually write
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');

const countCats = (tasks = []) => new Set(tasks.map((t) => t.taskCategory).filter(Boolean)).size;

async function run() {
  const source = storeLaunchTemplate;
  const template = await Template.findOne({ code: source.code })
    || await Template.findOne({ name: source.name });

  if (!template) {
    console.log(`No stored template matches "${source.name}" (${source.code}) — nothing to refresh.`);
    return;
  }

  const inUse = await Project.countDocuments({ 'template.ref': template._id });
  console.log(`Template "${template.name}" (v${template.version}) — used by ${inUse} project(s).\n`);
  console.log('stage  stored tasks -> source tasks   stored categories -> source categories');

  let changed = 0;
  for (const srcStage of source.stages) {
    const stored = template.stages.find((s) => s.key === srcStage.key);
    if (!stored) {
      console.log(`  ${srcStage.key}: not present in the stored template — skipping (no stage is added or removed).`);
      continue;
    }
    const before = { tasks: stored.tasks?.length || 0, cats: countCats(stored.tasks) };
    const after = { tasks: srcStage.tasks?.length || 0, cats: countCats(srcStage.tasks) };
    const types = {
      before: stored.assessmentTypes?.length || 0,
      after: srcStage.assessmentTypes?.length || 0,
    };

    const drift = before.tasks !== after.tasks || before.cats !== after.cats || types.before !== types.after;
    if (drift) changed += 1;
    console.log(
      `  ${srcStage.key.padEnd(4)} ${String(before.tasks).padStart(5)} -> ${String(after.tasks).padEnd(5)}`
      + `        ${String(before.cats).padStart(4)} -> ${String(after.cats).padEnd(4)}`
      + `   assessmentTypes ${types.before} -> ${types.after}`
      + `${drift ? '   [DRIFT]' : ''}`,
    );

    if (APPLY && drift) {
      stored.tasks = srcStage.tasks || [];
      if (srcStage.assessmentTypes) stored.assessmentTypes = srcStage.assessmentTypes;
    }
  }

  if (!changed) {
    console.log('\nNo drift — the stored template already matches the source.');
    return;
  }

  if (APPLY) {
    // Bump the version: live projects resolve their schema through this
    // document, so a structural rewrite is a new version by definition.
    template.version = (template.version || 1) + 1;
    template.markModified('stages');
    await template.save();
    console.log(`\nRefreshed ${changed} stage(s); template is now v${template.version}.`);

    const check = await Template.findById(template._id).select('stages').lean();
    for (const k of ['p8', 'p9']) {
      const st = check.stages.find((s) => s.key === k);
      console.log(`  verified ${k}: ${st?.tasks?.length || 0} tasks, ${countCats(st?.tasks)} categories persisted`);
    }
  } else {
    console.log(`\nWould refresh ${changed} stage(s) and bump the version.`);
    console.log('DRY RUN — nothing was written. Re-run with --apply to commit.');
  }
}

connectDatabase()
  .then(run)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(disconnectDatabase);
