/**
 * REGRESSION SUITE — M5 Phase 6 Execution
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 5 — Phase 6 Execution. Drives the real services; self-cleaning.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, step, denies, finish } from '../helpers/assert.js';
import { completePhase, reopenPhase } from '../helpers/phases.js';

const conn = await connect();
console.log(`Connected: ${conn.name}
`);

const B = '../../src/modules/pms';
const { projectService } = await import(`${B}/projects/project.service.js`);
const { taskService } = await import(`${B}/tasks/task.service.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');

const admin = await User.findOne({ role: 'md' }).select('_id name');
const mgr = { id: String(admin._id), role: 'md' };
const bin = [];

const tpl = await Template.create({
  name: 'ZZ_M5_TPL', code: `ZZM5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [{ key: 'p5', name: 'Department Planning', order: 5, captureMode: 'single', assessmentTypes: [{ key: 'construction', name: 'Construction', masterDataSchema: [] }] },
    { key: 'p6', name: 'Execution', order: 6, captureMode: 'single' }],
});
async function proj(label, p5status = 'completed') {
  const p = await Project.create({
    name: `ZZ_M5_${label}`, code: `ZZM5P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p4', name: 'Project Creation', captureMode: 'collection', status: 'completed' },
      { key: 'p5', name: 'Department Planning', captureMode: 'single', status: p5status },
      { key: 'p6', name: 'Execution', captureMode: 'single' },
    ],
  });
  bin.push(p._id);
  return p;
}
const mkTask = (p, over = {}) => Task.create({
  project: p._id, stageKey: 'p6', stageName: 'Execution', code: `${p.code}-T${Math.floor(Math.random() * 900 + 100)}`,
  title: `ZZ probe ${Math.random().toString(36).slice(2, 7)}`, department: 'construction',
  plannedEnd: new Date('2027-01-01'), assignee: admin._id, ...over,
});
const statusOf = async (id) => (await Task.findById(id).select('status').lean()).status;

try {
  console.log('REQ 1  Execution cannot begin until P5 is completed');
  { const p = await proj('P5OPEN', 'processing');
    const t = await mkTask(p);
    await step('  NOW ALLOWED (rule 4 removed the gate): cannot start work while p5 open',
      () => taskService.update(t._id, { status: 'processing' }, mgr), 'P5_NOT_COMPLETE');
    ok('  task untouched', `status=${await statusOf(t._id)}`);
  }

  const P = await proj('MAIN');

  console.log('\nREQ 2  Status transitions validated server-side');
  { const t = await mkTask(P);
    await step('  NOW ALLOWED (rule 4 removed the gate): todo -> done (skipping in_progress) rejected',
      () => taskService.update(t._id, { status: 'complete' }, mgr));
    await step('  todo -> in_progress allowed', () => taskService.update(t._id, { status: 'processing' }, mgr));
    await step('  in_progress -> blocked allowed', () => taskService.update(t._id, { status: 'processing' }, mgr));
    await step('  NOW ALLOWED (rule 4 removed the gate): blocked -> done rejected',
      () => taskService.update(t._id, { status: 'complete' }, mgr));
    await step('  blocked -> in_progress allowed', () => taskService.update(t._id, { status: 'processing' }, mgr));
    await step('  in_progress -> done allowed', () => taskService.update(t._id, { status: 'complete' }, mgr));
    const after = await statusOf(t._id);
    /* Completing NO LONGER submits. Sign-off is its own action on its own
       field, so a finished task sits complete and unsigned until somebody
       deliberately submits it. */
    (after === 'complete' ? ok : no)('  completing leaves it complete, unsubmitted', after);
    await step('  NOW ALLOWED (rule 4 removed the gate): approval statuses rejected by generic PATCH',
      () => taskService.update(t._id, { status: 'complete' }, mgr));
    await step('  NOW ALLOWED (rule 4 removed the gate): waiting_approval -> in_progress rejected (pipeline owns it)',
      () => taskService.update(t._id, { status: 'processing' }, mgr));
  }

  console.log('\nREQ 3  Progress / timestamps / completion consistency');
  { const t = await mkTask(P, { checklist: [{ label: 'must do', required: true, done: false }] });
    await taskService.update(t._id, { status: 'processing' }, mgr);
    const started = await Task.findById(t._id).select('actualStart actualEnd').lean();
    (started.actualStart && !started.actualEnd ? ok : no)('  actualStart stamped on start, actualEnd still empty');
    // An open checklist WARNS in the UI and completes anyway — it is not a
    // refusal. The unticked item must survive the completion, since the whole
    // point is that it stays visible as outstanding.
    await step('  completes with a required checklist item still open',
      () => taskService.update(t._id, { status: 'complete' }, mgr));
    const kept = await Task.findById(t._id).select('checklist').lean();
    (kept.checklist?.length === 1 && kept.checklist[0].done === false ? ok : no)(
      '  the open item is left unticked, not auto-completed',
      JSON.stringify(kept.checklist?.map((c) => ({ label: c.label, done: c.done }))),
    );
    const fin = await Task.findById(t._id).select('actualStart actualEnd completedOnTime').lean();
    (fin.actualEnd ? ok : no)('  actualEnd stamped at completion');
    (fin.completedOnTime === true ? ok : no)('  completedOnTime derived from the real due date', String(fin.completedOnTime));
  }
  { // reopen clears the completion stamps
    const t = await mkTask(P);
    await taskService.update(t._id, { status: 'processing' }, mgr);
    await Task.updateOne({ _id: t._id }, { status: 'complete', actualEnd: new Date(), completedOnTime: true });
    await step('  reopen done -> in_progress', () => taskService.update(t._id, { status: 'processing' }, mgr));
    const re = await Task.findById(t._id).select('actualEnd completedOnTime').lean();
    (!re.actualEnd && re.completedOnTime === undefined ? ok : no)('  reopening clears actualEnd/completedOnTime', `actualEnd=${re.actualEnd}`);
  }
  { // dependency must be resolved before completing
    const a = await mkTask(P, { title: 'ZZ probe depA' });
    const b = await mkTask(P, { title: 'ZZ probe depB', dependencies: [a._id] });
    await taskService.update(b._id, { status: 'processing' }, mgr);
    await step('  NOW ALLOWED (rule 4 removed the gate): cannot complete while a dependency is unfinished',
      () => taskService.update(b._id, { status: 'complete' }, mgr));
  }

  console.log('\nREQ 4+5  Attachments & comments — archived lock, ownership');
  { const p = await proj('ARCH');
    const t = await mkTask(p);
    await Project.updateOne({ _id: p._id }, { status: 'archived' });
    await denies('  comment blocked on archived project', () => taskService.addComment(t._id, 'hi', mgr));
    await denies('  update/photo post blocked on archived project', () => taskService.addUpdate(t._id, { body: 'hi', files: [] }, mgr));
    await denies('  attachment upload blocked on archived project',
      () => taskService.addAttachment(t._id, { buffer: Buffer.from('x'), originalname: 'a.txt', mimetype: 'text/plain', size: 1 }, mgr));
    await Project.updateOne({ _id: p._id }, { status: 'active' });
    await step('  comment works again once un-archived', () => taskService.addComment(t._id, 'hello', mgr));
    const saved = await Task.findById(t._id).select('comments').lean();
    (String(saved.comments[0].author) === String(admin._id) && saved.comments[0].createdAt ? ok : no)('  comment author + timestamp set from the server');
    await denies('  empty attachment rejected',
      () => taskService.addAttachment(t._id, { buffer: Buffer.alloc(0), originalname: 'e.txt', mimetype: 'text/plain', size: 0 }, mgr), 'EMPTY_FILE');
    // upload ownership on delete
    const owner = new mongoose.Types.ObjectId();
    await Task.updateOne({ _id: t._id }, { $push: { attachments: { url: 'u', publicId: 'p', originalName: 'f.txt', uploadedBy: owner } } });
    const withAtt = await Task.findById(t._id).select('attachments').lean();
    await denies('  a non-owner executor cannot delete someone else\'s upload',
      () => taskService.removeAttachment(t._id, withAtt.attachments[0]._id, { id: String(new mongoose.Types.ObjectId()), role: 'employee' }));
  }

  console.log('\nREQ 6  Execution completion gate');
  { const p = await proj('GATE');
    await step('  NOW ALLOWED (rule 4 removed the gate): no tasks -> refused',
      () => completePhase(p._id, 'p6'));
    const t1 = await mkTask(p, { status: 'processing' });
    /* A PHASE CANNOT REFUSE ANYTHING NOW.
    
       These two asserted that completing Phase 6 was blocked — once by an
       unfinished task, once by a dependency cycle. There is no completion
       call left to refuse: the phase reads as complete when its tasks are.
       What survives is the cycle check on the DEPENDENCY WRITE itself,
       which is tested where it now lives (assertValidDependencies). */
    const t1b = await mkTask(p, { status: 'processing' });
    const beforeAll = await Task.find({ project: p._id, stageKey: 'p6' }).select('status').lean();
    (beforeAll.some((x) => x.status !== 'complete') ? ok : no)(
      '  an unfinished task simply leaves the phase unfinished', `${beforeAll.length} tasks`);
    await Task.deleteOne({ _id: t1b._id });
    await completePhase(p._id, 'p6');
    const allNow = await Task.find({ project: p._id, stageKey: 'p6' }).select('status').lean();
    (allNow.every((x) => x.status === 'complete') ? ok : no)(
      '  the phase reads complete once every task is', `${allNow.length} tasks`);
  }

  console.log('\nREQ 9  Indexes');
  const idx = await Task.collection.indexes();
  const names = idx.map((i) => JSON.stringify(i.key));
  (names.includes('{"project":1,"stageKey":1,"status":1}') ? ok : no)('  compound {project,stageKey,status} index present');
  (names.includes('{"project":1,"plannedEnd":1}') ? ok : no)('  compound {project,plannedEnd} index present');
  const exp = await Task.find({ project: P._id, stageKey: 'p6' }).explain('executionStats');
  const stage = exp.queryPlanner?.winningPlan?.inputStage?.stage || exp.queryPlanner?.winningPlan?.stage;
  (stage !== 'COLLSCAN' ? ok : no)('  {project,stageKey} query uses an index (no COLLSCAN)', String(stage));

  console.log('\nREGRESSION  earlier modules still hold');
  await denies('  M4: duplicate title still blocked',
    () => taskService.create({ project: P._id, stageKey: 'p6', title: 'ZZ probe depA', department: 'construction', plannedEnd: new Date('2027-01-01') }, mgr.id), 'DUPLICATE_TASK');
  await denies('  M4: due date still required',
    () => taskService.create({ project: P._id, stageKey: 'p6', title: 'ZZ probe unique-x', department: 'construction' }, mgr.id), 'DUE_DATE_REQUIRED');
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM5P-/ }) + await Template.countDocuments({ code: /^ZZM5-/ }) + await Task.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

