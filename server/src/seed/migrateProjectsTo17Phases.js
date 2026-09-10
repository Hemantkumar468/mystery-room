/* eslint-disable no-console */
/**
 * Bring live projects onto the 17-phase client flow.
 *
 * A project SNAPSHOTS its template's phases when it is created — which is
 * right for day-to-day stability, and is why applying the template did not
 * change a single existing project. The consequence is that 18 live projects
 * still have the old 15/16 phases: no Contracts & Work Orders, no HR Hiring,
 * and phase names that still read "Phase 3B" and "Phase 4B".
 *
 * This walks each of them forward:
 *
 *   1. ADDS any template phase the project is missing (p21, p22), with the
 *      template's own schema, groups and gate, and generates that phase's
 *      tasks with the real people already on the template.
 *   2. RENAMES phases whose template name has changed, so "Phase 3B" becomes
 *      "Phase 4" everywhere at once.
 *   3. REORDERS the stages to the template's order, keeping any phase the
 *      template has since dropped in the position it already held.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────
 * It never touches an existing task. Dates, assignees, statuses and history
 * on phases the project already had are not rewritten — only the missing
 * phases get new tasks.
 *
 * It never removes a phase on the strength of "the template dropped it" —
 * that is a diagram's opinion, and somebody's finished work is not.
 * `--drop-empty-orphans` removes such a phase ONLY where the project can
 * prove nothing happened on it: no records, and every task still pending,
 * unstarted and uncompleted. Every task that would go is named in the plan
 * first. Anything with a trace of work stays exactly where it is, forever.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/migrateProjectsTo17Phases.js                # the plan
 *   node src/seed/migrateProjectsTo17Phases.js --apply        # persist
 *   node src/seed/migrateProjectsTo17Phases.js --apply --drop-empty-orphans
 *   node src/seed/migrateProjectsTo17Phases.js --apply --project MR-BHO-002
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { syncStageFromTemplate } from '../modules/pms/projects/project.service.js';

dns.setServers(['8.8.8.8', '8.8.4.4']);

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ONLY = arg('--project');
/* Removing a phase is never implied by the template. See `droppable` below. */
const DROP_EMPTY = process.argv.includes('--drop-empty-orphans');
const CODE = 'MR-PMS-CLIENT-FLOW';

/** The stage fields a project snapshots. Everything the board and forms read. */
const snapshotOf = (t, order, plannedStart, plannedEnd) => ({
  key: t.key,
  name: t.name,
  order,
  color: t.color,
  slaDays: t.slaDays,
  ownerDepartment: t.ownerDepartment,
  description: t.description,
  captureMode: t.captureMode || 'single',
  recordNoun: t.recordNoun || 'Record',
  masterDataSchema: t.masterDataSchema || [],
  assessmentTypes: t.assessmentTypes || [],
  recordGroups: t.recordGroups || [],
  whatWhoWhenHow: t.whatWhoWhenHow || [],
  parallelGroup: t.parallelGroup,
  branchOf: t.branchOf,
  alsoDrawnFrom: t.alsoDrawnFrom || [],
  gate: t.gate,
  exitCriteria: t.exitCriteria,
  status: 'pending',
  plannedStart,
  plannedEnd,
});

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const template = await Template.findOne({ code: CODE });
  if (!template) throw new Error(`Template ${CODE} not found`);
  const tplStages = [...template.stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tplByKey = new Map(tplStages.map((s) => [s.key, s]));
  console.log(`Template "${template.name}" — ${tplStages.length} phases\n`);

  const filter = { 'template.ref': template._id, ...(ONLY ? { code: ONLY } : {}) };
  const projects = await Project.find(filter);
  console.log(`${projects.length} project(s) on this template\n`);

  let touched = 0;
  let addedTotal = 0;
  let tasksTotal = 0;
  let droppedTotal = 0;

  for (const project of projects) {
    const have = new Map(project.stages.map((s) => [s.key, s]));
    const missing = tplStages.filter((t) => !have.has(t.key));
    const renames = tplStages
      .filter((t) => have.has(t.key) && have.get(t.key).name !== t.name)
      .map((t) => ({ key: t.key, from: have.get(t.key).name, to: t.name }));
    const orphans = project.stages.filter((s) => !tplByKey.has(s.key));

    const structDrift = tplStages.some((t) => {
      const live = have.get(t.key);
      return live && ((live.branchOf || null) !== (t.branchOf || null)
        || (live.parallelGroup || null) !== (t.parallelGroup || null)
        || (live.alsoDrawnFrom || []).join(',') !== (t.alsoDrawnFrom || []).join(','));
    });
    const nothingToDo = !missing.length && !renames.length && !structDrift
      && !(DROP_EMPTY && project.stages.some((s2) => !tplByKey.has(s2.key)));
    if (nothingToDo) {
      console.log(`  ${String(project.code).padEnd(12)} already current`);
      continue;
    }
    touched += 1;
    console.log(`  ${project.code}`);
    for (const m of missing) console.log(`      + ${m.key.padEnd(5)} ${m.name}`);
    for (const r of renames) console.log(`      ~ ${r.key.padEnd(5)} "${r.from}" → "${r.to}"`);
    /**
     * A phase the template has dropped.
     *
     * Never removed on the strength of "the template no longer has it" — that
     * is a diagram's opinion, and somebody's finished work is not. It is only
     * offered for removal when the project can PROVE nothing happened on it:
     * no records, and every task still pending with no start and no
     * completion. Even then it takes an explicit flag, and every task that
     * would go is named first.
     */
    const droppable = [];
    for (const o of orphans) {
      const oTasks = await Task.find({ project: project._id, stageKey: o.key })
        .select('code title status startedAt completedAt').lean();
      const oRecords = await Record.countDocuments({ project: project._id, stageKey: o.key });
      const worked = oTasks.filter((t) => t.status !== 'pending' || t.startedAt || t.completedAt);
      const empty = !oRecords && !worked.length;
      console.log(`      = ${o.key.padEnd(5)} "${o.name}" — dropped from the template · `
        + `${oTasks.length} task(s), ${oRecords} record(s), ${worked.length} touched`
        + `  → ${empty ? (DROP_EMPTY ? 'EMPTY, will be removed' : 'EMPTY (pass --drop-empty-orphans to remove)') : 'HAS WORK, kept'}`);
      if (empty) {
        oTasks.forEach((t) => console.log(`            ${t.code} "${t.title}" (${t.status})`));
        droppable.push({ stage: o, tasks: oTasks });
      }
    }

    /* Dates for a newly added phase. The template gives a duration, not a
       date, so the phase is placed after the phase it follows in the template
       order — using that neighbour's own planned dates rather than inventing
       a calendar. A branch starts with the phase it hangs off. */
    for (const t of missing) {
      const idx = tplStages.findIndex((x) => x.key === t.key);
      const anchorKey = t.branchOf
        || [...tplStages.slice(0, idx)].reverse().find((x) => have.has(x.key))?.key;
      const anchor = anchorKey ? have.get(anchorKey) : null;
      const start = t.branchOf
        ? dayjs(anchor?.plannedStart || project.plannedStartDate)
        : dayjs(anchor?.plannedEnd || anchor?.plannedStart || project.plannedStartDate);
      const end = start.add(t.slaDays || 7, 'day');
      const stage = snapshotOf(t, 0, start.toDate(), end.toDate());
      project.stages.push(stage);
      have.set(t.key, stage);
    }

    for (const r of renames) have.get(r.key).name = r.to;

    /**
     * Structural fields on phases the project ALREADY had.
     *
     * A rename is not enough. `branchOf` and `parallelGroup` decide the shape
     * of the whole diagram — which phases share a column, and which one hangs
     * off another feeding nothing — and a project that acquired a phase before
     * the template learned those facts keeps drawing the old shape forever.
     * Copied here because they are structure, not work: no task, date,
     * assignee or status is touched by this.
     */
    const restructured = [];
    for (const t of tplStages) {
      const live = have.get(t.key);
      if (!live) continue;
      if ((live.branchOf || null) !== (t.branchOf || null)) {
        restructured.push(`${t.key} branchOf ${live.branchOf || '—'} → ${t.branchOf || '—'}`);
        live.branchOf = t.branchOf;
      }
      if ((live.parallelGroup || null) !== (t.parallelGroup || null)) {
        restructured.push(`${t.key} parallelGroup ${live.parallelGroup || '—'} → ${t.parallelGroup || '—'}`);
        live.parallelGroup = t.parallelGroup;
      }
      const liveDrawn = (live.alsoDrawnFrom || []).join(',');
      const tplDrawn = (t.alsoDrawnFrom || []).join(',');
      if (liveDrawn !== tplDrawn) {
        restructured.push(`${t.key} alsoDrawnFrom ${liveDrawn || '—'} → ${tplDrawn || '—'}`);
        live.alsoDrawnFrom = t.alsoDrawnFrom || [];
      }
    }
    restructured.forEach((l) => console.log(`      * ${l}`));

    /* Reorder to the template. A phase the template dropped keeps its place
       by riding on the neighbour it used to follow, so nothing jumps. */
    const order = new Map(tplStages.map((s, i) => [s.key, i * 10]));
    let carried = 0;
    for (const s of project.stages) {
      if (order.has(s.key)) carried = order.get(s.key);
      else order.set(s.key, carried + 1); // an orphan sits just after where it was
    }
    project.stages.sort((a, b) => order.get(a.key) - order.get(b.key));
    project.stages.forEach((s, i) => { s.order = i; });
    project.markModified('stages');

    if (!APPLY) {
      addedTotal += missing.length;
      continue;
    }

    if (DROP_EMPTY && droppable.length) {
      for (const d of droppable) {
        project.stages = project.stages.filter((s2) => s2.key !== d.stage.key);
        await Task.deleteMany({ project: project._id, stageKey: d.stage.key });
        droppedTotal += 1;
        console.log(`      - ${d.stage.key} removed with ${d.tasks.length} untouched task(s)`);
      }
      project.stages.forEach((s2, i) => { s2.order = i; });
      project.markModified('stages');
    }

    await project.save();
    addedTotal += missing.length;

    /* Tasks for the new phases only. `syncStageFromTemplate` is the existing
       mechanism the CLI already uses for this — it resolves the template's
       real people, continues the project's task numbering, and keeps any
       finished work. Reusing it means the new phases' tasks are built exactly
       like every other phase's. */
    for (const t of missing) {
      const fresh = await Project.findById(project._id);
      const res = await syncStageFromTemplate(fresh, t.key, { apply: true });
      const n = res?.addTasks?.length ?? 0;
      tasksTotal += n;
      console.log(`      → ${t.key}: ${n} task(s) created`);
    }
  }

  console.log(`\n${touched} project(s) ${APPLY ? 'updated' : 'would change'}`);
  console.log(`${addedTotal} phase(s) ${APPLY ? 'added' : 'would be added'}`);
  if (APPLY) console.log(`${tasksTotal} task(s) created`);
  if (DROP_EMPTY) console.log(`${droppedTotal} empty dropped-phase(s) removed`);
  /* The closing line has to agree with the count printed above it. Saying
     "no phase was removed" under a line reading "1 removed" teaches people to
     stop reading the summary. */
  console.log(APPLY
    ? `\nDone. ${droppedTotal
      ? `${droppedTotal} provably empty dropped phase(s) removed; nothing with any work on it was touched.`
      : 'No phase was removed and no existing task was touched.'}`
    : '\nNothing written. Re-run with --apply.');

  await disconnectDatabase();
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
