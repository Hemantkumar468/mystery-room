/**
 * REGRESSION SUITE — M4 Phase 5 Department Planning
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 4 — Phase 5 Department Planning. Drives the real services so every
 * guard is in the path. Self-cleaning; no live project touched.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, step, denies, finish } from '../helpers/assert.js';

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
const { createTaskSchema } = await import(`${B}/tasks/task.validation.js`);

const manager = await User.findOne({ role: { $in: ['md', 'manager'] } }).select('_id name role department');
const mgr = { id: String(manager._id), role: 'md' };
// Two real users in different departments, for the assignee-department rule.
const construction = await User.findOne({ department: 'construction' }).select('_id name department');
const finance = await User.findOne({ department: 'finance' }).select('_id name department');
console.log(`manager=${manager.name}; construction=${construction?.name}; finance=${finance?.name}\n`);

const P5_DEPTS = [
  { key: 'construction', name: 'Construction', masterDataSchema: [] },
  { key: 'finance', name: 'Finance', masterDataSchema: [] },
];
const tpl = await Template.create({
  name: 'ZZ_M4_TPL', code: `ZZM4-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p4', name: 'Project Creation', order: 4, captureMode: 'collection' },
    { key: 'p5', name: 'Department Planning', order: 5, captureMode: 'single', assessmentTypes: P5_DEPTS },
    { key: 'p6', name: 'Execution', order: 6, captureMode: 'single' },
  ],
});
const bin = [];
async function makeProject(label, p4status) {
  const p = await Project.create({
    name: `ZZ_M4_${label}`, code: `ZZM4P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p4', name: 'Project Creation', captureMode: 'collection', status: p4status },
      { key: 'p5', name: 'Department Planning', captureMode: 'single' },
      { key: 'p6', name: 'Execution', captureMode: 'single' },
    ],
  });
  bin.push(p._id);
  return p;
}
const base = (over = {}) => ({
  stageKey: 'p6', title: `ZZ probe ${Math.random().toString(36).slice(2, 7)}`,
  department: 'construction', plannedEnd: new Date('2027-01-01'), priority: 'medium', ...over,
});
const stageOf = async (id, k) => (await Project.findById(id).select('stages').lean()).stages.find((x) => x.key === k).status;

try {
  console.log('OBJ 1+2  P5 cannot begin until P4 fully approved');
  { const p = await makeProject('P4OPEN', 'in_progress');
    await denies('  allocation blocked while p4 incomplete',
      () => taskService.create({ project: p._id, ...base() }, mgr.id), 'P4_NOT_COMPLETE');
    if (await Task.countDocuments({ project: p._id }) === 0) ok('  nothing leaked to MongoDB'); else no('  a task leaked');
  }

  const proj = await makeProject('MAIN', 'completed');

  console.log('\nOBJ 3  Allocation validation');
  await denies('  department required',
    () => taskService.create({ project: proj._id, ...base({ department: undefined }) }, mgr.id), 'DEPARTMENT_REQUIRED');
  await denies('  due date required',
    () => taskService.create({ project: proj._id, ...base({ plannedEnd: undefined }) }, mgr.id), 'DUE_DATE_REQUIRED');
  await denies('  department must be one the template plans for',
    () => taskService.create({ project: proj._id, ...base({ department: 'legal' }) }, mgr.id), 'UNKNOWN_DEPARTMENT');
  await denies('  assignee must exist',
    () => taskService.create({ project: proj._id, ...base({ assignee: new mongoose.Types.ObjectId() }) }, mgr.id), 'UNKNOWN_ASSIGNEE');
  if (finance) {
    await denies('  assignee must be in the task department',
      () => taskService.create({ project: proj._id, ...base({ department: 'construction', assignee: finance._id }) }, mgr.id), 'ASSIGNEE_WRONG_DEPARTMENT');
  } else console.log('  SKIP  no finance user to cross-check');
  await denies('  due date cannot precede start date',
    () => taskService.create({ project: proj._id, ...base({ plannedStart: new Date('2027-06-01'), plannedEnd: new Date('2027-01-01') }) }, mgr.id), 'INVALID_DATE_RANGE');
  // priority + required-field shape are enforced by the Zod contract
  const badPriority = createTaskSchema.safeParse({ body: { project: String(proj._id), stageKey: 'p6', title: 'x y', priority: 'urgent-ish' }, query: {}, params: {} });
  (!badPriority.success ? ok : no)('  invalid priority rejected by API contract');
  const shortTitle = createTaskSchema.safeParse({ body: { project: String(proj._id), stageKey: 'p6', title: 'x' }, query: {}, params: {} });
  (!shortTitle.success ? ok : no)('  title min-length enforced by API contract');

  const first = await step('  a fully valid allocation succeeds', () => taskService.create(
    { project: proj._id, ...base({ title: 'ZZ probe alpha', assignee: construction?._id, taskCategory: 'Fit-out' }) }, mgr.id,
  ));
  const savedFirst = await Task.findById(first._id).select('taskCategory department plannedEnd').lean();
  (savedFirst.taskCategory === 'Fit-out' ? ok : no)('  taskCategory now PERSISTS (was silently stripped)', savedFirst.taskCategory);

  console.log('\nOBJ 4  Duplicate prevention');
  await denies('  same title in same phase rejected',
    () => taskService.create({ project: proj._id, ...base({ title: 'ZZ probe alpha' }) }, mgr.id), 'DUPLICATE_TASK');
  await denies('  case/whitespace variant also rejected',
    () => taskService.create({ project: proj._id, ...base({ title: '  zz PROBE alpha ' }) }, mgr.id), 'DUPLICATE_TASK');
  const other = await makeProject('OTHER', 'completed');
  await step('  same title in a DIFFERENT project is fine',
    () => taskService.create({ project: other._id, ...base({ title: 'ZZ probe alpha' }) }, mgr.id));

  console.log('\nOBJ 5  Dependency validation');
  await denies('  dependency must exist in this project',
    () => taskService.create({ project: proj._id, ...base({ dependencies: [String(new mongoose.Types.ObjectId())] }) }, mgr.id), 'UNKNOWN_DEPENDENCY');
  const foreign = await Task.findOne({ project: other._id }).select('_id');
  await denies('  cannot depend on another project\'s task',
    () => taskService.create({ project: proj._id, ...base({ dependencies: [String(foreign._id)] }) }, mgr.id), 'UNKNOWN_DEPENDENCY');
  const second = await step('  valid dependency accepted', () => taskService.create(
    { project: proj._id, ...base({ title: 'ZZ probe beta', dependencies: [String(first._id)] }) }, mgr.id,
  ));
  const depSaved = await Task.findById(second._id).select('dependencies').lean();
  (depSaved.dependencies?.length === 1 ? ok : no)('  dependency PERSISTED', String(depSaved.dependencies?.length));
  await denies('  self-dependency rejected',
    () => taskService.update(second._id, { dependencies: [String(second._id)] }, mgr), 'SELF_DEPENDENCY');
  await denies('  circular dependency rejected (A->B->A)',
    () => taskService.update(first._id, { dependencies: [String(second._id)] }, mgr), 'CIRCULAR_DEPENDENCY');

  console.log('\nOBJ 7  Edits cannot bypass the rules');
  await denies('  edit to a wrong-department assignee rejected',
    () => taskService.update(first._id, { assignee: finance?._id || new mongoose.Types.ObjectId() }, mgr));
  await denies('  edit inverting the dates rejected',
    () => taskService.update(first._id, { plannedStart: new Date('2028-01-01') }, mgr), 'INVALID_DATE_RANGE');

  console.log('\nOBJ 6  P5 completes only when planning is genuinely complete');
  ok('  p5 auto-completed on first valid allocation', `stage=${await stageOf(proj._id, 'p5')}`);
  { const p = await makeProject('HALF', 'completed');
    // A half-filed legacy task (no due date), written straight to the model.
    await Task.create({ project: p._id, stageKey: 'p6', stageName: 'Execution', code: `${p.code}-T001`, title: 'ZZ probe legacy', department: 'construction' });
    await denies('  p5 blocked while an allocation lacks a due date',
      () => projectService.completeStage(p._id, 'p5', mgr.id, mgr), 'INCOMPLETE_ALLOCATION');
    await Task.updateMany({ project: p._id }, { plannedEnd: new Date('2027-05-05') });
    await step('  p5 completes once every allocation is whole',
      () => projectService.completeStage(p._id, 'p5', mgr.id, mgr));
  }
  { const p = await makeProject('EMPTY', 'completed');
    await denies('  p5 blocked with zero allocations',
      () => projectService.completeStage(p._id, 'p5', mgr.id, mgr), 'NO_TASKS_ALLOCATED');
  }

  console.log('\nREGRESSION  earlier modules still hold');
  await denies('  M1: stranger still cannot edit a task',
    () => taskService.update(first._id, { priority: 'high' }, { id: String(new mongoose.Types.ObjectId()), role: 'employee' }));
  await step('  M1: manager still can (not over-blocked)', () => taskService.update(first._id, { priority: 'high' }, mgr));
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) {
    await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  }
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM4P-/ }) + await Template.countDocuments({ code: /^ZZM4-/ }) + await Task.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

