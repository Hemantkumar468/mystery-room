/**
 * REGRESSION SUITE — an assessment task exists only where an assessment was asked for.
 *
 * THE BUG. Step 2 asks the MD "which assessments?" and the MD ticks a subset,
 * usually one. `syncAssessmentTasks` then ran every template assessment task
 * across every property still in evaluation, so ticking Feasibility alone put
 * four jobs on somebody's My Tasks — Feasibility, Financial, Technical and
 * Operational. The Step 3 queue was right the whole time, because it reads the
 * child forms and only one had been opened; My Tasks was reading the TEMPLATE,
 * which knows the four assessments that EXIST, not the ones that were CHOSEN.
 *
 * THE SECOND HALF, which the first fix exposed. Opening a p2 form says an
 * assessment is to be done; it does not put it on a desk. Nothing on the MD's
 * decision path called the sync, and it had never shown, because the planner
 * used to raise all four tasks for every property regardless — so a task was
 * always already there by the time anyone looked. The moment tasks followed
 * the selection, the queue started reading "No task raised" against the one
 * assessment that WAS asked for.
 *
 * So this suite asserts a count in both directions: the chosen assessment has
 * a task, and the unchosen ones have none. A regression in either direction is
 * silent in the database and only shows up as work on the wrong person's list.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/pms';
const { projectService } = await import(`${B}/projects/project.service.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { RECORD_STATUS } = await import('../../src/core/constants/index.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);

const tag = `ZZAS-${Date.now()}`;
const bin = { projects: [], templates: [], records: [] };
const admin = await User.findOne({ role: 'md' }).select('_id');

/* The four assessments, as the real template carries them: one `assessmentTypes`
   entry per form and one task per form, joined by `formKey`. */
const TYPES = ['feasibility', 'financial', 'technical', 'operational'];

const tpl = await Template.create({
  name: `${tag}_TPL`,
  code: `${tag}-T`,
  status: 'published',
  version: 1,
  stages: [
    { key: 'p1', name: 'Property capture', order: 1, captureMode: 'collection' },
    {
      key: 'p2',
      name: 'Site evaluation',
      order: 2,
      captureMode: 'collection',
      assessmentTypes: TYPES.map((k) => ({
        key: k,
        name: k,
        masterDataSchema: [{ key: `${k}_note`, label: 'Note', type: 'text' }],
      })),
      tasks: TYPES.map((k, i) => ({
        key: `p2_${k}`, title: `Do the ${k} assessment`, order: i + 1, estimatedDays: 2, formKey: k,
      })),
    },
  ],
});
bin.templates.push(tpl._id);

const project = await Project.create({
  name: `${tag}_P`,
  code: `${tag}-P`,
  city: 'Probe',
  plannedStartDate: new Date('2026-01-01'),
  template: { ref: tpl._id, name: tpl.name, version: 1 },
  stages: [
    { key: 'p1', name: 'Property capture', order: 1, captureMode: 'collection', plannedStart: new Date('2026-01-01') },
    { key: 'p2', name: 'Site evaluation', order: 2, captureMode: 'collection', plannedStart: new Date('2026-01-05') },
  ],
});
bin.projects.push(project._id);

/** A captured property, in evaluation — the shape the planner looks for. */
const mkProperty = async (name) => {
  const r = await Record.create({
    project: project._id,
    stageKey: 'p1',
    title: name,
    status: RECORD_STATUS.SHORTLISTED,
    values: { property_name: name },
    createdBy: admin._id,
  });
  bin.records.push(r._id);
  return r;
};

/** The MD ticking an assessment IS a p2 child form opening under the property. */
const chooseAssessment = async (property, type) => {
  const r = await Record.create({
    project: project._id,
    stageKey: 'p2',
    parentRecordId: property._id,
    assessmentType: type,
    status: RECORD_STATUS.DRAFT,
    values: {},
    createdBy: admin._id,
  });
  bin.records.push(r._id);
  return r;
};

/** The assessment tasks standing against one property, by assessment. */
const tasksFor = async (property) => {
  const rows = await Task.find({
    project: project._id, stageKey: 'p2', subjectRecord: property._id,
  }).select('templateTaskKey title status').lean();
  return rows.map((t) => String(t.templateTaskKey || '').replace('p2_', '')).sort();
};

try {
  /* ── ONE TICKED, ONE RAISED ─────────────────────────────────────────── */
  console.log('── The MD ticks Feasibility and nothing else ──');
  const one = await mkProperty(`${tag} one-assessment`);
  await chooseAssessment(one, 'feasibility');
  await projectService.syncAssessmentTasks(project._id, { actorId: admin._id });
  {
    const got = await tasksFor(one);
    is('exactly one assessment task exists', got.length, 1);
    is('and it is the one that was ticked', got[0], 'feasibility');
    is('no financial task', got.includes('financial'), false);
    is('no technical task', got.includes('technical'), false);
    is('no operational task', got.includes('operational'), false);
  }

  /* ── NO DECISION, NO TASK ───────────────────────────────────────────── */
  console.log('\n── A property the MD has not decided on yet ──');
  const undecided = await mkProperty(`${tag} undecided`);
  await projectService.syncAssessmentTasks(project._id, { actorId: admin._id });
  is('an undecided property carries no assessment task', (await tasksFor(undecided)).length, 0);
  is('and the decided one is untouched', (await tasksFor(one)).length, 1);

  /* ── TICKING A SECOND ONE LATER ─────────────────────────────────────── */
  console.log('\n── The MD adds Technical to the same property ──');
  await chooseAssessment(one, 'technical');
  await projectService.syncAssessmentTasks(project._id, { actorId: admin._id });
  {
    const got = await tasksFor(one);
    is('now two tasks stand against it', got.length, 2);
    is('and they are the two that were ticked', got.join(','), 'feasibility,technical');
  }

  /* ── UN-TICKING TIDIES UP AFTER ITSELF ──────────────────────────────── */
  console.log('\n── The decision is withdrawn: the child forms go ──');
  await Record.deleteMany({ parentRecordId: one._id, stageKey: 'p2' });
  await projectService.syncAssessmentTasks(project._id, { actorId: admin._id });
  {
    const got = await tasksFor(one);
    /* One task may survive as a phase-wide row — the planner detaches rather
       than deletes when it would otherwise leave the phase with none. What
       must not survive is a task still POINTING AT the property. */
    is('no task is left pointing at the property', got.length, 0);
  }

  /* ── WORK IN PROGRESS IS NEVER THROWN AWAY ──────────────────────────── */
  console.log('\n── An un-tick cannot delete work somebody has started ──');
  const busy = await mkProperty(`${tag} started`);
  await chooseAssessment(busy, 'financial');
  await projectService.syncAssessmentTasks(project._id, { actorId: admin._id });
  is('the financial task was raised', (await tasksFor(busy)).join(','), 'financial');

  await Task.updateOne(
    { project: project._id, stageKey: 'p2', subjectRecord: busy._id },
    { $set: { status: 'processing', actualStart: new Date() } },
  );
  await Record.deleteMany({ parentRecordId: busy._id, stageKey: 'p2' });
  await projectService.syncAssessmentTasks(project._id, { actorId: admin._id });
  is('a task somebody had started survives the un-tick', (await tasksFor(busy)).join(','), 'financial');
} finally {
  console.log('\n── Cleaning up ──');
  await Task.deleteMany({ project: { $in: bin.projects } });
  await Record.deleteMany({ _id: { $in: bin.records } });
  await Project.deleteMany({ _id: { $in: bin.projects } });
  await Template.deleteMany({ _id: { $in: bin.templates } });
  await disconnect();
}

finish('Assessment selection');
