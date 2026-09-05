/**
 * Re-sync the WORDING of live tasks from their template — and nothing else.
 *
 * WHY THIS EXISTS SEPARATELY FROM syncProjectStage. A task is a snapshot: when
 * a project is created the template's title, brief and checklist are copied
 * onto it, and the copy is then the thing people read. That is right — a task
 * must not silently change under someone mid-job — but it means fixing a
 * confusing sentence in a template fixes it only for projects created after.
 * Every live project keeps reading the old one.
 *
 * `syncProjectStage --apply` does fix it, by deleting the pending tasks and
 * cascading fresh ones. That is far too blunt for a typo: it throws away the
 * task's id, and with it every record filed against it, every outsourcing
 * link pointing at it and the task's own history.
 *
 * So this moves ONE thing: the words. Title, the What/Who/When/How brief, and
 * checklist LABELS where the list still matches item for item. It never
 * touches status, assignees, dates, ticked boxes, or which tasks exist.
 *
 *   node src/seed/refreshTaskBriefs.js --template MR-PMS-CLIENT-FLOW
 *   node src/seed/refreshTaskBriefs.js --template MR-PMS-CLIENT-FLOW --stage p11 --apply
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const INCLUDE_DONE = process.argv.includes('--include-done');
/** Finished work, left alone by default — see the guard in the loop. */
const DONE_STATES = new Set(['complete', 'done', 'cancelled']);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

/* eslint-disable no-console */
async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { withTenant, withoutTenant } = await import('../core/tenancy/tenantContext.js');
  const { Project } = await import('../modules/pms/projects/project.model.js');
  const { Template } = await import('../modules/pms/templates/template.model.js');
  const { Task } = await import('../modules/pms/tasks/task.model.js');

  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const stageFilter = arg('--stage');
  const templateCode = arg('--template');
  if (!templateCode) throw new Error('Pass --template <CODE>');

  const { template, projects } = await withoutTenant(
    'one template is shared across companies, so its wording is too',
    async () => {
      const t = await Template.findOne({ code: templateCode }).lean();
      if (!t) throw new Error(`Template ${templateCode} not found`);
      return { template: t, projects: await Project.find({ 'template.ref': t._id }).lean() };
    },
  );

  /* What the template says today, keyed by task. */
  const wanted = new Map();
  for (const stage of template.stages || []) {
    if (stageFilter && stage.key !== stageFilter) continue;
    for (const t of stage.tasks || []) {
      wanted.set(`${stage.key}::${t.key}`, {
        title: t.title,
        brief: t.brief,
        checklist: t.checklist || [],
      });
    }
  }
  if (!wanted.size) throw new Error(stageFilter ? `No tasks on stage ${stageFilter}` : 'No tasks on that template');

  let changed = 0;
  let checked = 0;
  let skippedDone = 0;

  for (const project of projects) {
    const run = (fn) => (project.tenant ? withTenant(String(project.tenant), fn) : fn());
    await run(async () => {
      const tasks = await Task.find({
        project: project._id,
        ...(stageFilter ? { stageKey: stageFilter } : {}),
        templateTaskKey: { $exists: true, $ne: null },
      });

      for (const task of tasks) {
        const want = wanted.get(`${task.stageKey}::${task.templateTaskKey}`);
        if (!want) continue;

        /* A FINISHED task is a record of what somebody was asked to do and
           did. Re-wording it changes that record after the fact, so it is
           left alone unless someone explicitly asks — the point of this tool
           is to fix instructions for people who have yet to follow them. */
        if (DONE_STATES.has(task.status) && !INCLUDE_DONE) {
          skippedDone += 1;
          continue;
        }
        checked += 1;

        const set = {};
        if (want.title && want.title !== task.title) set.title = want.title;
        for (const k of ['what', 'who', 'when', 'how']) {
          const next = want.brief?.[k];
          if (next && next !== task.brief?.[k]) set[`brief.${k}`] = next;
        }

        /* Checklist LABELS only, and only when the two lists still line up
           item for item. A template that gained or lost an item is a change
           of substance, not wording, and belongs to syncProjectStage — doing
           it here would silently move somebody's ticks onto other items. */
        if (
          want.checklist.length
          && want.checklist.length === (task.checklist || []).length
          && want.checklist.some((c, i) => c.label !== task.checklist[i]?.label)
        ) {
          set.checklist = task.checklist.map((c, i) => ({
            ...(c.toObject ? c.toObject() : c),
            label: want.checklist[i].label,
            required: want.checklist[i].required ?? c.required,
          }));
        }

        if (!Object.keys(set).length) continue;
        changed += 1;
        console.log(`  ${project.code} ${task.code} ${task.templateTaskKey}`);
        for (const [k, v] of Object.entries(set)) {
          console.log(`      ${k}: ${typeof v === 'string' ? `"${String(v).slice(0, 90)}${String(v).length > 90 ? '…' : ''}"` : `${v.length} checklist labels`}`);
        }
        if (APPLY) await Task.updateOne({ _id: task._id }, { $set: set });
      }
    });
  }

  console.log(`\n${checked} task(s) checked across ${projects.length} project(s), ${changed} with wording to update.`);
  if (skippedDone) {
    console.log(`${skippedDone} finished task(s) left exactly as they were — pass --include-done to re-word those too.`);
  }
  console.log(APPLY ? 'Done.' : 'Nothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
