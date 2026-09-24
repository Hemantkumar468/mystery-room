/**
 * REGRESSION SUITE — three states, free ordering, derived phase progress.
 *
 * These are the spec's own acceptance checks, plus the things that were true
 * before and must now be false. The dangerous direction is not "a rule stopped
 * working" — it is a rule QUIETLY SURVIVING: one leftover gate, one stored
 * stage status, one cascade, and the screen goes back to telling people they
 * cannot do something the product now says they can. None of those would raise
 * an error; they would just refuse, or silently start the next task.
 *
 * So most of what follows asserts an ABSENCE.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';
import { completePhase, reopenPhase } from '../helpers/phases.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/pms';
const { taskService } = await import(`${B}/tasks/task.service.js`);
const { projectService } = await import(`${B}/projects/project.service.js`);
const { phaseProgress } = await import(`${B}/projects/phaseProgress.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { TASK_STATUS, STAGE_LIFECYCLE } = await import('../../src/core/constants/index.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, d = '') => (v ? ok(name) : no(name, d || `got ${JSON.stringify(v)}`));

const tag = `ZZ3S-${Date.now()}`;
const bin = { tasks: [], projects: [], templates: [], records: [] };
const admin = await User.findOne({ role: 'md' }).select('_id');
const actor = { id: String(admin._id), role: 'md' };

const tpl = await Template.create({
  name: `${tag}_TPL`, code: `${tag}-T`, status: 'published', version: 1,
  stages: [
    /* p1 owns its fields directly; p2 keeps them inside two assessments. The
       tree has to flatten the second shape, and only a fixture carrying both
       proves that it does. */
    {
      key: 'p1',
      name: 'Phase one',
      order: 1,
      captureMode: 'single',
      slaDays: 9,
      tasks: [
        { key: 'bp_one', title: 'Blueprint one', order: 1, estimatedDays: 4 },
        { key: 'bp_two', title: 'Blueprint two', order: 2, estimatedDays: 3 },
      ],
      masterDataSchema: [
        { key: 'plain_one', label: 'Plain one', type: 'text', required: true },
        { key: 'plain_two', label: 'Plain two', type: 'number' },
        /* A SECOND datetime, on an EARLIER stage. Without this the launch rule
           has only one candidate and "the latest stage wins" passes for the
           wrong reason. */
        { key: 'earlyDate', label: 'Early date', type: 'datetime' },
      ],
    },
    {
      key: 'p2',
      name: 'Phase two',
      order: 2,
      captureMode: 'single',
      assessmentTypes: [
        {
          key: 'alpha',
          name: 'Alpha',
          masterDataSchema: [{ key: 'a_one', label: 'A one', type: 'select', options: ['x', 'y'] }],
        },
        {
          key: 'beta',
          name: 'Beta',
          masterDataSchema: [{ key: 'b_one', label: 'B one', type: 'boolean' }],
        },
      ],
    },
    {
      key: 'p3',
      name: 'Phase three',
      order: 3,
      captureMode: 'single',
      slaDays: 4,
      /* The launch target. Deliberately on the LAST stage, because the rule the
         server follows is "the datetime field in the latest stage wins" and a
         fixture that puts it first would pass without exercising that. */
      masterDataSchema: [
        { key: 'launchDateTime', label: 'Launch Date & Time', type: 'datetime' },
      ],
    },
  ],
});
bin.templates.push(tpl._id);

const project = await Project.create({
  name: `${tag}_P`, code: `${tag}-P`, city: 'Probe',
  plannedStartDate: new Date('2020-01-01'),
  template: { ref: tpl._id, name: tpl.name, version: 1 },
  stages: [
    { key: 'p1', name: 'Phase one', order: 1, captureMode: 'single' },
    { key: 'p2', name: 'Phase two', order: 2, captureMode: 'single' },
    { key: 'p3', name: 'Phase three', order: 3, captureMode: 'single' },
  ],
});
bin.projects.push(project._id);

let n = 0;
const mkTask = async (stageKey, over = {}) => {
  n += 1;
  const t = await Task.create({
    project: project._id, stageKey, stageName: stageKey,
    code: `${tag}-T${n}`, title: `${tag} task ${n}`, department: 'construction', ...over,
  });
  bin.tasks.push(t._id);
  return t;
};
const statusOf = async (id) => (await Task.findById(id).select('status').lean()).status;
const set = (id, status) => taskService.update(id, { status }, actor);

try {
  /* ── ACCEPTANCE: new project → pending = all ────────────────────────── */
  console.log('── A new project is entirely pending ──');
  {
    const a = await mkTask('p1');
    const b = await mkTask('p1');
    const c = await mkTask('p2');
    is('task 1 defaults to pending', a.status, TASK_STATUS.PENDING);
    is('task 2 defaults to pending', b.status, TASK_STATUS.PENDING);
    is('task 3 defaults to pending', c.status, TASK_STATUS.PENDING);
    const all = await Task.find({ project: project._id }).select('status').lean();
    is('processing = 0', all.filter((t) => t.status === TASK_STATUS.PROCESSING).length, 0);
    is('complete = 0', all.filter((t) => t.status === TASK_STATUS.COMPLETE).length, 0);
  }

  /* ── ACCEPTANCE: completing a task starts nothing ───────────────────── */
  console.log('\n── Completing a task starts nothing ──');
  {
    const t1 = await mkTask('p3');
    const t2 = await mkTask('p3');
    await set(t1._id, TASK_STATUS.COMPLETE);
    is('task 1 is complete', await statusOf(t1._id), TASK_STATUS.COMPLETE);
    /* THE assertion the whole model turns on. */
    is('task 2 is untouched, still pending', await statusOf(t2._id), TASK_STATUS.PENDING);
  }

  /* ── ACCEPTANCE: nothing blocks anything ────────────────────────────── */
  console.log('\n── Any task, any phase, any state, on day one ──');
  {
    /* The LAST phase's task, set on a project where nothing before it has been
       touched. Every gate that used to exist would have refused this. */
    const last = await mkTask('p3');
    await set(last._id, TASK_STATUS.COMPLETE);
    is('the last phase\'s task can be completed first', await statusOf(last._id), TASK_STATUS.COMPLETE);

    const dep = await mkTask('p1');
    const blocked = await mkTask('p1', { dependencies: [dep._id] });
    await set(blocked._id, TASK_STATUS.COMPLETE);
    is('a task completes with its dependency still pending', await statusOf(blocked._id), TASK_STATUS.COMPLETE);
    is('and the dependency is not dragged along', await statusOf(dep._id), TASK_STATUS.PENDING);
  }

  /* ── ACCEPTANCE: complete → pending succeeds ────────────────────────── */
  console.log('\n── Every move is legal, in both directions ──');
  {
    const t = await mkTask('p2');
    for (const [from, to] of [
      [TASK_STATUS.PENDING, TASK_STATUS.COMPLETE],
      [TASK_STATUS.COMPLETE, TASK_STATUS.PENDING],
      [TASK_STATUS.PENDING, TASK_STATUS.PROCESSING],
      [TASK_STATUS.PROCESSING, TASK_STATUS.PENDING],
      [TASK_STATUS.PENDING, TASK_STATUS.COMPLETE],
      [TASK_STATUS.COMPLETE, TASK_STATUS.PROCESSING],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await set(t._id, to);
      // eslint-disable-next-line no-await-in-loop
      is(`${from} → ${to}`, await statusOf(t._id), to);
    }
  }

  /* ── ACCEPTANCE: phase progress is derived ──────────────────────────── */
  console.log('\n── Phase progress is arithmetic, never stored ──');
  {
    const s = 'p2';
    await Task.deleteMany({ project: project._id, stageKey: s });
    const a = await mkTask(s);
    const b = await mkTask(s);
    const tasksIn = async () => Task.find({ project: project._id, stageKey: s }).select('status').lean();

    is('two pending → pending', phaseProgress(await tasksIn()), TASK_STATUS.PENDING);
    await set(a._id, TASK_STATUS.PROCESSING);
    is('one processing → processing', phaseProgress(await tasksIn()), TASK_STATUS.PROCESSING);
    await set(a._id, TASK_STATUS.COMPLETE);
    is('one complete, one pending → processing', phaseProgress(await tasksIn()), TASK_STATUS.PROCESSING);
    await set(b._id, TASK_STATUS.COMPLETE);
    is('all complete → complete', phaseProgress(await tasksIn()), TASK_STATUS.COMPLETE);
    await set(b._id, TASK_STATUS.PENDING);
    is('setting one back reopens the phase', phaseProgress(await tasksIn()), TASK_STATUS.PROCESSING);

    is('an empty phase is pending, not complete', phaseProgress([]), TASK_STATUS.PENDING);
  }

  /* ── the stage carries NO progress ──────────────────────────────────── */
  console.log('\n── The stage stores lifecycle, not progress ──');
  {
    const fresh = await Project.findById(project._id).lean();
    const s = fresh.stages[0];
    truthy('stage has a lifecycle', Boolean(s.lifecycle));
    is('and it defaults to active', s.lifecycle, STAGE_LIFECYCLE.ACTIVE);
    is('stage.status is gone from the schema', Project.schema.path('stages').schema.path('status'), undefined);
  }

  /* ── ACCEPTANCE: red is a date, not a state ─────────────────────────── */
  console.log('\n── Red is a date, not a fourth state ──');
  {
    const t = await mkTask('p1', { dueAt: new Date('2020-01-01') });
    const doc = await Task.findById(t._id);
    is('a past-due task keeps its state', doc.status, TASK_STATUS.PENDING);
    is('and reads as overdue', doc.isOverdue, true);
    await set(t._id, TASK_STATUS.COMPLETE);
    const done = await Task.findById(t._id);
    is('a completed task is never overdue', done.isOverdue, false);
  }

  /* ── the gates are really gone ──────────────────────────────────────── */
  console.log('\n── The gate machinery is absent, not merely unused ──');
  {
    is('completeStage no longer exists', typeof projectService.completeStage, 'undefined');
    is('reopenStage no longer exists', typeof projectService.reopenStage, 'undefined');
    truthy('launchStore does', typeof projectService.launchStore === 'function');
    truthy('tree does', typeof projectService.tree === 'function');
  }

  /* ── the tree endpoint's shape ──────────────────────────────────────── */
  console.log('\n── The tree ──');
  {
    const tree = await projectService.tree(String(project._id));
    is('every phase comes back', tree.phases.length, 3);
    truthy('phases carry their tasks', Array.isArray(tree.phases[0].tasks));
    truthy('and a derived progress', Boolean(tree.phases[0].progress));
    is('no phase carries a stored status', tree.phases.filter((p) => 'status' in p).length, 0);
    /* THE FORM TRAVELS WITH THE TREE.

       The first version of this read `masterDataSchema` off the PROJECT's stage
       snapshot. A project stage deliberately never carries it, so every phase
       came back with `fields: []` — no error, no warning, just a drawer saying
       "this phase has no form" about a phase with 55 of them. The questions
       come from the template; only the answers live on the project. */
    const p1 = tree.phases.find((p) => p.key === 'p1');
    const p2 = tree.phases.find((p) => p.key === 'p2');
    const p3 = tree.phases.find((p) => p.key === 'p3');
    is('a phase with its own fields carries them', p1.fields.length, 3);
    is('a required field stays marked required', p1.fields.filter((f) => f.required).length, 1);
    is('assessment fields are flattened into the phase form', p2.fields.length, 2);
    is('and each names the module it came from',
      p2.fields.map((f) => f.moduleKey).sort().join(','), 'alpha,beta');
    is('with the module display name alongside the key',
      p2.fields.map((f) => f.module).sort().join(','), 'Alpha,Beta');
    is('the launch phase carries its one launch field', p3.fields.length, 1);

    /* ── the modules a phase is made of ──────────────────────────────────
       Commercial Closure has SIX assessment modules and five tasks, and no
       task names a module — so the tree branches on modules, and it can only
       do that if they travel with the tree. */
    is('a phase with assessments lists them', p2.assessments.length, 2);
    is('in the template order, by key',
      p2.assessments.map((a) => a.key).join(','), 'alpha,beta');
    is('with the name a person reads',
      p2.assessments.map((a) => a.name).join(','), 'Alpha,Beta');
    is('a phase with no assessments gets an empty list, not undefined',
      Array.isArray(p1.assessments) ? p1.assessments.length : 'undefined', 0);
    truthy('every phase carries a records array',
      tree.phases.every((ph) => Array.isArray(ph.records)),
      'a phase without one would crash the branch that maps over it');
    is('a phase with no modules carries no records either', p1.records.length, 0);
    truthy('every phase carries its saved answers',
      tree.phases.every((p) => p.values && typeof p.values === 'object'));

    /* ── the template's plan, reported beside the actual ── */
    is('a phase carries the template SLA', p1.plan.slaDays, 9);
    is('and the blueprint task count', p1.plan.blueprintTasks, 2);
    is('and the estimated days those tasks add up to', p1.plan.estimatedDays, 7);
    is('a phase the template gave no tasks reports zero, not null',
      tree.phases.find((p) => p.key === 'p2').plan.blueprintTasks, 0);

    /* DRIFT IS REPORTED, NEVER REPAIRED. Both blueprint titles are unmet here
       because the fixture creates tasks with generated names — which is the
       renamed-task case exactly, and the count must reflect it rather than the
       endpoint quietly creating the missing rows. */
    is('unmet blueprint rows are listed', p1.plan.unmet.length, 2);
    truthy('and listed by their template title', p1.plan.unmet.includes('Blueprint one'));
    const beforeDrift = await Task.countDocuments({ project: project._id, stageKey: 'p1' });
    await projectService.tree(String(project._id));
    is('reading the tree creates nothing',
      await Task.countDocuments({ project: project._id, stageKey: 'p1' }), beforeDrift);

    /* A task naming its own assessment is what lets the drawer open on one
       module instead of on all fourteen.

       Asserted by ROUND-TRIPPING a real value, not by testing for the key: a
       lean() document simply omits a field that was never set, so `'formKey' in
       task` fails on every unset task and says nothing at all about whether the
       endpoint selects it. */
    const scoped = await mkTask('p2', { formKey: 'beta' });
    const tree2 = await projectService.tree(String(project._id));
    const back = tree2.phases.find((p) => p.key === 'p2').tasks
      .find((t) => String(t._id) === String(scoped._id));
    is('a task carries the assessment it belongs to', back?.formKey, 'beta');
    is('and that key matches one the phase form offers',
      tree2.phases.find((p) => p.key === 'p2').fields
        .filter((f) => f.moduleKey === back.formKey).length, 1);
  }

  /* ── a module's records reach the tree ──────────────────────────────── */
  console.log('\n── Assessment records ──');
  {
    /* A record is what turns a module card from "open the form" into "here is
       the report, filed by X on Y". The endpoint has to carry the submitter and
       the property it hangs off, or the card can show neither. */
    const parent = await Record.create({
      project: project._id, stageKey: 'p2', assessmentType: 'alpha',
      status: 'approved', values: {}, submittedBy: admin._id, submittedAt: new Date(),
    });
    bin.records.push(parent._id);
    const child = await Record.create({
      project: project._id, stageKey: 'p2', assessmentType: 'beta',
      status: 'submitted', values: {}, parentRecordId: parent._id,
      submittedBy: admin._id, submittedAt: new Date(),
    });
    bin.records.push(child._id);

    const t = await projectService.tree(String(project._id));
    const ph = t.phases.find((x) => x.key === 'p2');
    is('the phase carries its records', ph.records.length, 2);
    truthy('newest first, so the client can read [0] for the live property',
      new Date(ph.records[0].createdAt) >= new Date(ph.records[1].createdAt));
    const beta = ph.records.find((r) => r.assessmentType === 'beta');
    truthy('the submitter is populated, not left as an id',
      beta.submittedBy && typeof beta.submittedBy === 'object' && beta.submittedBy.name,
      `submittedBy is ${JSON.stringify(beta.submittedBy)} — the card cannot say who filed it`);
    truthy('and the property it hangs off travels with it', Boolean(beta.parentRecordId));
    truthy('the heavy values blob is NOT sent',
      beta.values === undefined,
      'every record on every phase would ship its whole payload to colour a card');
  }

  /* ── what the project counts down to ────────────────────────────────── */
  console.log('\n── The launch countdown ──');
  {
    /* No launch date typed and no target opening date: the tree must say there
       is none rather than invent one. A countdown to a made-up date is worse
       than no countdown, because people plan against it. */
    await Project.updateOne({ _id: project._id }, { $unset: { targetEndDate: 1 }, $set: { masterData: {} } });
    is('with nothing set there is no target',
      (await projectService.tree(String(project._id))).launch, null);

    /* The project's own target opening date is the weaker fallback. */
    const target = new Date('2027-03-01T00:00:00.000Z');
    await Project.updateOne({ _id: project._id }, { $set: { targetEndDate: target } });
    const viaTarget = (await projectService.tree(String(project._id))).launch;
    is('the target end date is used when nothing else is', viaTarget.source, 'target');

    /* A date typed into the template's own launch field beats it. */
    const typed = new Date('2027-01-15T11:30:00.000Z');
    const earlier = new Date('2026-06-01T09:00:00.000Z');
    await Project.updateOne({ _id: project._id }, {
      $set: {
        masterData: {
          p1: { earlyDate: earlier.toISOString() },
          p3: { launchDateTime: typed.toISOString() },
        },
      },
    });
    const viaForm = (await projectService.tree(String(project._id))).launch;
    is('a date typed into the launch form wins', viaForm.source, 'form');
    is('and it is the LATER phase date, not the earlier one',
      new Date(viaForm.at).toISOString(), typed.toISOString());
    is('labelled with the template wording, not a hardcoded string',
      viaForm.label, 'Launch Date & Time');
    is('and it names the phase that owns the field', viaForm.stageKey, 'p3');

    /* The target is found by TYPE, so renaming the field must not break it. */
    await Template.updateOne(
      { _id: tpl._id, 'stages.key': 'p3' },
      { $set: { 'stages.$.masterDataSchema.0.key': 'goLiveAt', 'stages.$.masterDataSchema.0.label': 'Go live at' } },
    );
    await Project.updateOne({ _id: project._id }, {
      $set: {
        masterData: {
          p1: { earlyDate: earlier.toISOString() },
          p3: { goLiveAt: typed.toISOString() },
        },
      },
    });
    const renamed = (await projectService.tree(String(project._id))).launch;
    is('renaming the template field keeps the countdown working', renamed?.source, 'form');
    is('and the banner follows the new label', renamed?.label, 'Go live at');
  }

  /* ── which template a screen is based on ────────────────────────────── */
  console.log('\n── The template a project is built from ──');
  {
    const t = await projectService.tree(String(project._id));
    is('the tree names its template', t.template.code, tpl.code);

    /* A project with no template is a real state — one draft in this database
       is in it. The tree must return null and let the screen say so, not throw
       and not pretend the plan is empty. */
    const orphan = await Project.create({
      name: `${tag}_ORPHAN`, code: `${tag}-ORPH`, city: 'Probe',
      plannedStartDate: new Date('2020-01-01'),
      stages: [{ key: 'p1', name: 'Phase one', order: 1, captureMode: 'single' }],
    });
    bin.projects.push(orphan._id);
    const ot = await projectService.tree(String(orphan._id));
    is('a project with no template returns null for it', ot.template, null);
    is('its phases carry no plan rather than an empty one', ot.phases[0].plan, null);
    is('and it has nothing to count down to', ot.launch, null);
    truthy('its phases still carry a fields ARRAY, never undefined',
      Array.isArray(ot.phases[0].fields) && ot.phases[0].fields.length === 0,
      `fields is ${JSON.stringify(ot.phases[0].fields)} — the drawer would crash mapping it`);
  }

  /* ── sign-off is a different axis ───────────────────────────────────── */
  console.log('\n── Sign-off does not move the state ──');
  {
    const t = await mkTask('p1');
    await set(t._id, TASK_STATUS.COMPLETE);
    await taskService.submitForApproval(String(t._id), actor);
    const after = await Task.findById(t._id).lean();
    is('submitting leaves the state complete', after.status, TASK_STATUS.COMPLETE);
    is('and moves the approval axis', after.approvalState, 'waiting_department');
    truthy('the template approval rule survived the rename',
      after.approval && typeof after.approval === 'object',
      `approval is ${JSON.stringify(after.approval)} — the object was overwritten`);
  }
} finally {
  await Task.deleteMany({ project: project._id });
  await Project.deleteMany({ _id: { $in: bin.projects } });
  await Template.deleteMany({ _id: { $in: bin.templates } });
  await disconnect();
}

process.exit(finish('THREE-STATE TASKS'));
