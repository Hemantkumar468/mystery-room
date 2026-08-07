/**
 * REGRESSION SUITE — M1 Cross-cutting: permissions, integrity, schema, orphans
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Cross-cutting fix verification — runs against the real MongoDB.
 * Deny-path tests use existing data and mutate nothing (the guard throws).
 * The cascade test creates its own throwaway project and cleans it up.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

const { Project } = await import('../../src/modules/pms/projects/project.model.js');

import { ok, no, step, denies as deniesCode, refusesWith, finish } from '../helpers/assert.js';

/** This suite asserts on the human-readable REFUSAL MESSAGE (the guards it
 * covers predate machine-readable codes), so its third argument is a message
 * fragment rather than an error code. */
const denies = (name, fn, fragment) => (fragment ? refusesWith(name, fn, new RegExp(fragment, 'i')) : deniesCode(name, fn));
const allows = step;

const conn = await connect();
console.log(`Connected: ${conn.name}
`);

const BASE = '../../src/modules/pms';
const { projectService } = await import(`${BASE}/projects/project.service.js`);
const { taskService } = await import(`${BASE}/tasks/task.service.js`);
const { recordService } = await import(`${BASE}/records/record.service.js`);
const { templateService } = await import(`${BASE}/templates/template.service.js`);
const { Task } = await import(`${BASE}/tasks/task.model.js`);
const { Record } = await import(`${BASE}/records/record.model.js`);
const { Template } = await import(`${BASE}/templates/template.model.js`);

const anyProject = await Project.findOne({ status: { $nin: ['archived'] } }).select('_id name status stages');
const anyTemplate = await Template.findOne({}).select('_id name');

// ---------------------------------------------------------------- H8 / H15
console.log('H8/H15  Terminal project status via generic PATCH');
if (anyProject) {
  await denies('  reject status=store_live', () => projectService.update(anyProject._id, { status: 'store_live' }, null), 'own flow');
  await denies('  reject status=archived', () => projectService.update(anyProject._id, { status: 'archived' }, null), 'own flow');
} else console.log('  SKIP  no non-archived project found');

// ---------------------------------------------------------------- H9
console.log('\nH9      p8/p9 stage completion is manager/admin only');
if (anyProject) {
  const exec = { id: String(anyProject._id), role: 'employee' };
  await denies('  executor blocked from p9 Launch Store', () => projectService.completeStage(anyProject._id, 'p9', exec.id, exec), 'Manager or Admin');
  await denies('  executor blocked from p8 Final Approval', () => projectService.completeStage(anyProject._id, 'p8', exec.id, exec), 'Manager or Admin');
}

// ---------------------------------------------------------------- H5
console.log('\nH5      Task PATCH ownership gate');
const anyTask = await Task.findOne({ status: { $ne: 'approved' } }).select('_id title assignee project status department');
if (anyTask) {
  const stranger = { id: new mongoose.Types.ObjectId().toString(), role: 'employee' };
  await denies('  stranger cannot tick checklist', () => taskService.update(anyTask._id, { checklist: [{ label: 'x', required: true, done: true }] }, stranger), 'doer');
  await denies('  stranger cannot reassign', () => taskService.update(anyTask._id, { assignee: stranger.id }, stranger), 'doer');
  await denies('  stranger cannot drop dependencies', () => taskService.update(anyTask._id, { dependencies: [] }, stranger), 'doer');
  await allows('  admin CAN still edit (not over-blocked)', async () => {
    const before = anyTask.priority;
    await taskService.update(anyTask._id, { priority: before }, { id: stranger.id, role: 'md' });
  });
} else console.log('  SKIP  no unapproved task found');

// ---------------------------------------------------------------- H6
console.log('\nH6      Approval separation of duties');
const waiting = await Task.findOne({ status: { $in: ['waiting_approval', 'waiting_management_approval'] } })
  .select('_id assignee approvedBy status submittedForApprovalBy department project');
if (waiting?.assignee) {
  await denies('  assignee cannot approve own task', () => taskService.decide(waiting._id, 'approve', {}, { id: String(waiting.assignee), role: 'md' }), 'own task');
} else console.log('  SKIP  no waiting task with an assignee');
// Build a controlled fixture rather than skipping — we need a task sitting at
// the management tier whose department approver is a known id.
const deptApprover = new mongoose.Types.ObjectId();
const otherMgr = new mongoose.Types.ObjectId();
// Attached to its OWN throwaway project: decide() triggers recompute(), which
// rewrites stage statuses — that must never touch a live project.
const mgmtProject = await Project.create({
  name: 'ZZ_MGMT_PROBE', code: `ZZPROBE-M${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
  city: 'Probe', plannedStartDate: new Date(),
  stages: [{ key: 'p6', name: 'Probe Exec', captureMode: 'single' }],
});
const mgmtFixture = await Task.create({
  project: mgmtProject._id, code: `${mgmtProject.code}-T001`,
  stageKey: 'p6', stageName: 'Probe Exec', title: 'ZZ probe mgmt-tier task',
  status: 'waiting_management_approval', approvedBy: deptApprover, approvedAt: new Date(),
  assignee: new mongoose.Types.ObjectId(),
});
{
  await denies('  dept approver cannot also clear mgmt tier',
    () => taskService.decide(mgmtFixture._id, 'approve', {}, { id: String(deptApprover), role: 'manager' }), 'different approver');
  await allows('  a DIFFERENT manager CAN clear mgmt tier (not over-blocked)',
    () => taskService.decide(mgmtFixture._id, 'approve', {}, { id: String(otherMgr), role: 'manager' }));
  const after = await Task.findById(mgmtFixture._id).select('status managementApprovedBy');
  if (after?.status === 'approved' && String(after.managementApprovedBy) === String(otherMgr)) {
    ok('  mgmt approval PERSISTED to MongoDB', `status=${after.status}`);
  } else no('  mgmt approval did not persist', `status=${after?.status}`);
  await Promise.all([Task.deleteMany({ project: mgmtProject._id }), Project.deleteOne({ _id: mgmtProject._id })]);
  ok('  mgmt fixture cleaned up');
}

// ---------------------------------------------------------------- H1 / H2
console.log('\nH1/H2   Record post-decision freeze + transition guard');
const decided = await Record.findOne({ status: { $in: ['shortlisted', 'approved', 'rejected'] } }).select('_id status values project');
if (decided) {
  await denies(`  cannot edit a ${decided.status} record`, () => recordService.update(decided._id, { values: { ...(decided.values || {}), _probe: 1 } }, null), 'undo that decision');
  const illegal = decided.status === 'rejected' ? 'shortlist' : 'under_review';
  await denies(`  illegal transition ${decided.status} -> ${illegal}`, () => recordService.decide(decided._id, illegal, null, null, null), "can.t be|undo the current");
} else console.log('  SKIP  no decided record found');

// ---------------------------------------------------------------- H11
// Uses its own throwaway ARCHIVED project so the guard is exercised for real
// rather than skipped — no archived project exists in this DB yet.
console.log('\nH11     Archived project is read-only server-side');
const newProject = (over = {}) => ({
  name: 'ZZ_PROBE', code: `ZZPROBE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  city: 'Probe', plannedStartDate: new Date(),
  stages: [{ key: 'p1', name: 'Probe Stage', captureMode: 'collection' }],
  ...over,
});
const arch = await Project.create(newProject({ status: 'archived' }));
const archTask = await Task.create({
  project: arch._id, code: `${arch.code}-T001`, stageKey: 'p1', stageName: 'Probe Stage',
  title: 'probe task', status: 'done', assignee: new mongoose.Types.ObjectId(),
});
const archRec = await Record.create({ project: arch._id, stageKey: 'p1', seq: 1, title: 'probe', values: {}, status: 'submitted' });
const adminActor = { id: new mongoose.Types.ObjectId().toString(), role: 'md' };
await denies('  task edit blocked', () => taskService.update(archTask._id, { priority: 'high' }, adminActor), 'archived');
await denies('  task submit-for-approval blocked', () => taskService.submitForApproval(archTask._id, adminActor), 'archived');
await denies('  record edit blocked', () => recordService.update(archRec._id, { values: { x: 1 } }, adminActor.id), 'archived');
await denies('  record decide blocked', () => recordService.decide(archRec._id, 'approve', null, adminActor.id, null), 'archived');
await denies('  record create blocked', () => recordService.create({ projectId: arch._id, stageKey: 'p1', values: {} }, adminActor.id), 'archived');
// Nothing above should have mutated anything.
const untouched = await Task.findById(archTask._id).select('priority status');
if (untouched.priority !== 'high' && untouched.status === 'done') ok('  archived task genuinely unchanged in MongoDB');
else no('  archived task was mutated despite the guard');
await Promise.all([Project.deleteOne({ _id: arch._id }), Task.deleteMany({ project: arch._id }), Record.deleteMany({ project: arch._id })]);
ok('  archived fixture cleaned up');

// ---------------------------------------------------------------- H16
console.log('\nH16     In-use template cannot be deleted');
const inUse = await Project.findOne({ 'template.ref': { $ne: null } }).select('template');
if (inUse?.template?.ref) {
  await denies('  delete blocked while projects reference it', () => templateService.remove(inUse.template.ref), 'still used by');
} else console.log('  SKIP  no project references a template');

// ---------------------------------------------------------------- H13
console.log('\nH13     Project delete cascades to Records (throwaway project)');
{
  const tmp = await Project.create(newProject({
    name: 'ZZ_CASCADE_PROBE',
    template: anyTemplate ? { ref: anyTemplate._id, name: anyTemplate.name, version: 1 } : undefined,
  }));
  await Record.create({ project: tmp._id, stageKey: 'p1', seq: 1, title: 'probe record A', values: {}, status: 'draft' });
  await Record.create({ project: tmp._id, stageKey: 'p1', seq: 2, title: 'probe record B', values: {}, status: 'submitted' });
  await Task.create({ project: tmp._id, code: `${tmp.code}-T001`, stageKey: 'p1', stageName: 'Probe Stage', title: 'probe task' });
  const before = { r: await Record.countDocuments({ project: tmp._id }), t: await Task.countDocuments({ project: tmp._id }) };
  await projectService.remove(tmp._id);
  const after = { r: await Record.countDocuments({ project: tmp._id }), t: await Task.countDocuments({ project: tmp._id }) };
  if (before.r === 2 && before.t === 1 && after.r === 0 && after.t === 0) {
    ok('  records + tasks both cascaded', `records ${before.r}->${after.r}, tasks ${before.t}->${after.t}`);
  } else no('  cascade incomplete', `records ${before.r}->${after.r}, tasks ${before.t}->${after.t}`);
  if (await Project.countDocuments({ code: tmp.code }) === 0) ok('  probe project removed'); else no('  probe project left behind');
}

// ---------------------------------------------------------------- H12
console.log('\nH12     captureMode enum validation active');
const bad = new Project({ name: 'x', code: 'X', city: 'x', stages: [{ key: 'p1', name: 'n', captureMode: 'totally-invalid' }] });
const err = bad.validateSync();
if (err && JSON.stringify(err.errors).includes('captureMode')) ok('  invalid captureMode rejected by schema');
else no('  invalid captureMode still accepted');

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

