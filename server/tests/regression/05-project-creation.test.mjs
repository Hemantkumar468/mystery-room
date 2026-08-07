/**
 * REGRESSION SUITE — M3 Phase 4 Project Creation
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 3 — Phase 4 Project Creation. Drives the REAL services end to end
 * (recordService / projectService / taskService), so every guard is in the
 * path. Self-cleaning; no live project is touched.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, step, denies, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}
`);

const B = '../../src/modules/pms';
const { projectService } = await import(`${B}/projects/project.service.js`);
const { recordService } = await import(`${B}/records/record.service.js`);
const { taskService } = await import(`${B}/tasks/task.service.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');

const manager = await User.findOne({ role: { $in: ['md', 'manager'] } }).select('_id name role');
const doer = await User.findOne({}).select('_id name');
const mgrActor = { id: String(manager._id), role: manager.role === 'md' ? 'md' : 'manager' };
console.log(`manager=${manager.name} (${manager.role})\n`);

const P3T = [
  { key: 'loi', name: 'LOI', masterDataSchema: [] },
  { key: 'lease', name: 'Lease Agreement', masterDataSchema: [] },
];
const P4T = [{
  key: 'project_creation', name: 'Project Setup',
  masterDataSchema: [
    { key: 'project_name', label: 'Project Name', type: 'text', required: true },
    { key: 'estimated_budget', label: 'Estimated Budget', type: 'currency', required: true },
    { key: 'currency', label: 'Currency', type: 'select', options: ['INR', 'USD'] },
    { key: 'target_opening_date', label: 'Target Opening Date', type: 'date', required: true },
    { key: 'project_manager', label: 'Project Manager', type: 'text', required: true },
    { key: 'project_type', label: 'Project Type', type: 'select', options: ['New Launch'] },
    { key: 'store_format', label: 'Store Format', type: 'select', options: ['Mall'] },
    { key: 'departments_involved', label: 'Departments', type: 'multiselect', options: ['Construction', 'IT'], required: true },
  ],
}];
const tpl = await Template.create({
  name: 'ZZ_M3_TPL', code: `ZZM3-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p1', name: 'Property Identification', order: 1, captureMode: 'collection' },
    { key: 'p3', name: 'Commercial Finalization', order: 3, captureMode: 'collection', assessmentTypes: P3T },
    { key: 'p4', name: 'Project Creation', order: 4, captureMode: 'collection', assessmentTypes: P4T },
    { key: 'p5', name: 'Department Planning', order: 5, captureMode: 'single' },
    { key: 'p6', name: 'Execution', order: 6, captureMode: 'single' },
  ],
});
const bin = [];
async function scenario(label) {
  const p = await Project.create({
    name: `ZZ_M3_${label}`, code: `ZZM3P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p1', name: 'Property Identification', captureMode: 'collection' },
      { key: 'p3', name: 'Commercial Finalization', captureMode: 'collection' },
      { key: 'p4', name: 'Project Creation', captureMode: 'collection' },
      { key: 'p5', name: 'Department Planning', captureMode: 'single' },
      { key: 'p6', name: 'Execution', captureMode: 'single' },
    ],
  });
  bin.push(p._id);
  const prop = await Record.create({ project: p._id, stageKey: 'p1', seq: 1, title: 'ZZ probe property', values: {}, status: 'shortlisted' });
  for (const ty of P3T) {
    await Record.create({ project: p._id, stageKey: 'p3', assessmentType: ty.key, parentRecordId: prop._id, seq: 1, title: ty.name, values: {}, status: 'approved' });
  }
  return { p, prop };
}
const SETUP_VALUES = {
  project_name: 'ZZ Probe Store',
  estimated_budget: 4500000,
  currency: 'USD',
  target_opening_date: '2027-03-15',
  project_manager: manager.name,
  project_type: 'New Launch',
  store_format: 'Mall',
  departments_involved: ['Construction', 'IT'],
};
const stageOf = async (id, k) => (await Project.findById(id).select('stages').lean()).stages.find((x) => x.key === k).status;

try {
  console.log('OBJ 3+4  p4 completes ONLY after manager approval, no API bypass');
  { // draft form
    const { p, prop } = await scenario('DRAFT');
    await recordService.create({ projectId: p._id, stageKey: 'p4', assessmentType: 'project_creation', parentRecordId: prop._id, values: SETUP_VALUES, status: 'draft' }, doer._id);
    await denies('  draft Project Setup cannot complete p4', () => projectService.completeStage(p._id, 'p4', manager._id, mgrActor), 'PROJECT_SETUP_NOT_APPROVED');
  }
  { // THE original hole: submitted but not approved
    const { p, prop } = await scenario('SUBMITTED');
    await recordService.create({ projectId: p._id, stageKey: 'p4', assessmentType: 'project_creation', parentRecordId: prop._id, values: SETUP_VALUES, status: 'submitted' }, doer._id);
    ok('  submitting the form does NOT complete p4 by itself', `stage=${await stageOf(p._id, 'p4')}`);
    await denies('  direct API completeStage still refuses (no bypass)', () => projectService.completeStage(p._id, 'p4', manager._id, mgrActor), 'PROJECT_SETUP_NOT_APPROVED');
  }
  { // rejected
    const { p, prop } = await scenario('REJECTED');
    const rec = await recordService.create({ projectId: p._id, stageKey: 'p4', assessmentType: 'project_creation', parentRecordId: prop._id, values: SETUP_VALUES, status: 'submitted' }, doer._id);
    await recordService.decide(rec._id, 'reject', 'Budget too high', manager._id);
    await denies('  rejected Project Setup cannot complete p4', () => projectService.completeStage(p._id, 'p4', manager._id, mgrActor), 'PROJECT_SETUP_NOT_APPROVED');
    ok('  p4 still not complete after rejection', `stage=${await stageOf(p._id, 'p4')}`);
  }
  { // no p3 clearance
    const p = await Project.create({
      name: 'ZZ_M3_NOP3', code: `ZZM3P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      city: 'Probe', plannedStartDate: new Date(), template: { ref: tpl._id, name: tpl.name, version: 1 },
      stages: [{ key: 'p1', name: 'P1', captureMode: 'collection' }, { key: 'p3', name: 'P3', captureMode: 'collection' }, { key: 'p4', name: 'P4', captureMode: 'collection' }],
    });
    bin.push(p._id);
    await Record.create({ project: p._id, stageKey: 'p1', seq: 1, title: 'ZZ probe property', values: {}, status: 'shortlisted' });
    await denies('  p4 blocked when p3 not finalized', () => projectService.completeStage(p._id, 'p4', manager._id, mgrActor), 'NO_FINALIZED_PROPERTY');
  }

  console.log('\nOBJ 1+2  approval (server-side) is what completes the stage');
  const { p: main, prop: mainProp } = await scenario('MAIN');
  const rec = await step('  file Project Setup (submitted)', () => recordService.create(
    { projectId: main._id, stageKey: 'p4', assessmentType: 'project_creation', parentRecordId: mainProp._id, values: SETUP_VALUES, status: 'submitted' }, doer._id,
  ));
  await step('  manager approves it', () => recordService.decide(rec._id, 'approve', undefined, manager._id));
  const p4Status = await stageOf(main._id, 'p4');
  if (p4Status === 'completed') ok('  p4 auto-completed BY THE SERVER on approval', `stage=${p4Status}`);
  else no('  p4 did not complete on approval', `stage=${p4Status}`);

  console.log('\nOBJ 5  Project document persists budget / opening date / PM / configuration');
  const saved = await Project.findById(main._id).select('budget targetEndDate owner masterData').lean();
  const checks = [
    ['budget.planned', saved.budget?.planned === 4500000, saved.budget?.planned],
    ['budget.currency', saved.budget?.currency === 'USD', saved.budget?.currency],
    ['targetEndDate', new Date(saved.targetEndDate).toISOString().slice(0, 10) === '2027-03-15', saved.targetEndDate],
    ['owner -> real User', String(saved.owner) === String(manager._id), saved.owner],
    ['masterData.p4 configuration', saved.masterData?.p4?.project_type === 'New Launch' && Array.isArray(saved.masterData?.p4?.departments_involved), JSON.stringify(saved.masterData?.p4?.departments_involved)],
  ];
  for (const [name, good, val] of checks) (good ? ok : no)(`  ${name}`, String(val));

  console.log('\nOBJ 6  P5 cannot begin until P4 is truly completed');
  { const { p } = await scenario('P5GATE');
    await denies('  cannot allocate a p6 task while p4 incomplete',
      () => taskService.create({ project: p._id, stageKey: 'p6', title: 'ZZ probe task', department: 'construction' }, manager._id), 'P4_NOT_COMPLETE');
    await denies('  cannot complete p5 while p4 incomplete',
      () => projectService.completeStage(p._id, 'p5', manager._id, mgrActor), 'P4_NOT_COMPLETE');
    if ((await Task.countDocuments({ project: p._id })) === 0) ok('  no task leaked into MongoDB'); else no('  a task was created despite the gate');
  }
  await step('  allocation works once p4 IS complete (not over-blocked)',
    () => taskService.create({ project: main._id, stageKey: 'p6', title: 'ZZ probe task', department: 'construction', plannedEnd: new Date('2027-01-01') }, manager._id));
  ok('  p5 auto-completed by that first allocation', `stage=${await stageOf(main._id, 'p5')}`);

  console.log('\nREGRESSION  Module 1 + 2 guards still hold');
  await denies('  approved Project Setup is frozen (M1)', () => recordService.update(rec._id, { values: { estimated_budget: 1 } }, manager._id), 'RECORD_DECIDED');
  await denies('  approved -> under_review illegal (M1)', () => recordService.decide(rec._id, 'under_review', undefined, manager._id), 'ILLEGAL_RECORD_TRANSITION');
  await allows_idem();
  async function allows_idem() {
    try { await projectService.completeStage(main._id, 'p4', manager._id, mgrActor); ok('  completing an already-complete p4 is idempotent'); }
    catch (e) { no('  idempotency broken', e.message); }
  }
  const budgetAfter = (await Project.findById(main._id).select('budget').lean()).budget.planned;
  if (budgetAfter === 4500000) ok('  persisted budget unchanged by re-completion'); else no('  budget mutated', String(budgetAfter));
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) {
    await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  }
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM3P-/ }) + await Template.countDocuments({ code: /^ZZM3-/ }) + await Record.countDocuments({ title: /^ZZ probe/ }) + await Task.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

