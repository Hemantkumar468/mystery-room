/* eslint-disable no-console */
/**
 * One-time migration: Phase 1 is ONE task, not two.
 *
 * Phase 1 used to carry `p1_capture` ("Capture the properties on site") and
 * `p1_shortlist` ("Review the captured properties & shortlist"). The second
 * was a job with no work in it: shortlisting is a decision taken on a
 * property, one property at a time, and the moment it is taken that property
 * is in Phase 2. Nothing is left for a task to track — so the row only ever
 * reported on the other row, and made Phase 1 look like two jobs when the
 * consultant only ever had one.
 *
 * The capture task's checklist absorbs the decision ("Every property
 * shortlisted or rejected, with a reason"), so nothing that was being asked
 * for stops being asked for.
 *
 * ── Work is never deleted ────────────────────────────────────────────
 * A `p1_shortlist` task is removed ONLY where the project can prove nothing
 * happened on it: still pending, never started, never completed, no checklist
 * ticked, no comment, nobody's approval on it. Every task is named in the
 * plan first, and anything with a trace of work is KEPT and reported — a
 * project manager can close it by hand once they have looked at it.
 *
 * Records are never touched: the properties themselves live on `p1`, not on
 * either task, and this does not read or write a single one.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/migrateP1SingleTask.js            # the plan
 *   node src/seed/migrateP1SingleTask.js --apply    # persist
 */
import dns from 'node:dns';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { clientFlowTemplate } from './clientFlowTemplate.js';

dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const GONE = 'p1_shortlist';

const sourceP1 = clientFlowTemplate.stages.find((s) => s.key === 'p1');
const sourceCapture = sourceP1?.tasks?.find((t) => t.key === 'p1_capture');

/** Has anybody actually done anything to this task? */
function traceOfWork(t) {
  const marks = [];
  if (t.status && t.status !== 'pending') marks.push(`status ${t.status}`);
  if (t.startedAt) marks.push('started');
  if (t.completedAt) marks.push('completed');
  if (t.approvalState && t.approvalState !== 'none') marks.push(`approval ${t.approvalState}`);
  if ((t.checklist || []).some((c) => c.done)) marks.push('checklist ticked');
  if ((t.comments || []).length) marks.push(`${t.comments.length} comment(s)`);
  if (t.progress) marks.push(`progress ${t.progress}`);
  return marks;
}

async function migrateTemplates() {
  const templates = await Template.find({ 'stages.tasks.key': GONE });
  let touched = 0;
  for (const template of templates) {
    for (const stage of template.stages) {
      const before = (stage.tasks || []).length;
      if (!(stage.tasks || []).some((t) => t.key === GONE)) continue;
      console.log(`\nTemplate "${template.name}" (${template.code}) · stage ${stage.key}:`);
      stage.tasks = stage.tasks.filter((t) => t.key !== GONE);
      /* The capture task takes over the decision, so the checklist it is
         judged against has to say so — otherwise removing the second task
         quietly removes the requirement with it. */
      const capture = stage.tasks.find((t) => t.key === 'p1_capture');
      if (capture && sourceCapture) {
        capture.checklist = sourceCapture.checklist;
        /* `how` lives inside the brief, not on the task — see job() in
           clientFlowTemplate.js. Setting it at the top level would write a
           field nothing reads and leave the old instructions on screen. */
        capture.brief = sourceCapture.brief;
      }
      console.log(`  • tasks ${before} → ${stage.tasks.length} (removed ${GONE})`);
      console.log(capture
        ? `  • p1_capture checklist → ${sourceCapture.checklist.length} items, now including the shortlist decision`
        : '  • no p1_capture on this stage to fold the decision into');
      template.markModified('stages');
      touched += 1;
    }
    if (APPLY && template.isModified()) await template.save();
  }
  return touched;
}

/**
 * Only the Task rows. A project does NOT snapshot its stages' task lists —
 * `projectStageSchema` has no `tasks` field at all (unlike masterDataSchema
 * and whatWhoWhenHow, which it does copy), so tasks exist in exactly one
 * place: the `tasks` collection. Checked against the live data before this
 * was written: 0 projects carry a stage task array.
 */
async function migrateProjects() {
  const projects = await Project.find({}).select('name code').lean();
  const stats = { removed: 0, kept: 0, projects: 0 };

  for (const project of projects) {
    const tasks = await Task.find({ project: project._id, templateTaskKey: GONE })
      .select('code title status startedAt completedAt approvalState checklist comments progress').lean();
    if (!tasks.length) continue;

    stats.projects += 1;
    const records = await Record.countDocuments({ project: project._id, stageKey: 'p1' });
    console.log(`\n  ${project.code || project.name} — ${records} propert${records === 1 ? 'y' : 'ies'} on p1 (untouched by this)`);

    for (const t of tasks) {
      const work = traceOfWork(t);
      if (work.length) {
        stats.kept += 1;
        console.log(`    KEEP   ${t.code || t._id} "${t.title}" — ${work.join(', ')}`);
      } else {
        stats.removed += 1;
        console.log(`    REMOVE ${t.code || t._id} "${t.title}" — pending, never started, nothing on it`);
        if (APPLY) await Task.deleteOne({ _id: t._id });
      }
    }
  }
  return stats;
}

async function main() {
  if (!sourceCapture) throw new Error('clientFlowTemplate has no p1_capture task to fold the decision into');

  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING migration ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const templates = await migrateTemplates();
  if (!templates) console.log(`\nNo template still declares ${GONE}.`);

  console.log('\nProjects:');
  const s = await migrateProjects();
  if (!s.projects) console.log('  (none carry it)');

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  Templates updated:            ${templates}`);
  console.log(`  Projects carrying the task:   ${s.projects}`);
  console.log(`  Tasks removed (nothing on them): ${s.removed}`);
  console.log(`  Tasks KEPT (work on them):       ${s.kept}`);
  console.log(`${'─'.repeat(64)}`);
  if (s.kept) {
    console.log(`\n  ${s.kept} task(s) had work on them and were left exactly where they are.`);
    console.log('  They are named above; close or delete them by hand once you have looked.');
  }
  console.log(APPLY
    ? '\nDone. Phase 1 is one task — capture — and shortlisting a property is what sends it to Phase 2.\n'
    : '\nNothing was written. Re-run with --apply to persist.\n');

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase();
  process.exit(1);
});
