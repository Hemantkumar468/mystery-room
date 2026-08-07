/**
 * REGRESSION SUITE — End-to-end Phase 1 -> 2 -> 3 workflow
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * End-to-end Phase 1 -> 2 -> 3 workflow, driven entirely through the real
 * services (recordService / projectService) exactly as the API layer calls
 * them — no direct model writes, so every Module 1 + Module 2 guard is in
 * the path. Self-cleaning.
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
const { Project } = await import(`${B}/projects/project.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { User } = await import(`../../src/modules/auth/auth.model.js`);

const manager = await User.findOne({ role: { $in: ['md', 'manager'] } }).select('_id name');
const doer = await User.findOne({}).select('_id name');
console.log(`Acting as manager=${manager?.name}\n`);

const P2 = ['feasibility', 'financial', 'technical', 'operational'].map((k) => ({ key: k, name: k, masterDataSchema: [] }));
const P3 = [
  { key: 'loi', name: 'LOI', masterDataSchema: [] },
  { key: 'lease', name: 'Lease Agreement', masterDataSchema: [] },
  { key: 'legal', name: 'Legal Verification', masterDataSchema: [] },
  { key: 'deposit', name: 'Deposit Management', masterDataSchema: [] },
  { key: 'noc', name: 'NOC Management', subKeyField: 'noc_type', masterDataSchema: [{ key: 'noc_type', options: ['Fire', 'Health'] }] },
];
const tpl = await Template.create({
  name: 'ZZ_E2E_TPL', code: `ZZE2E-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p1', name: 'Property Identification', order: 1, captureMode: 'collection', masterDataSchema: [] },
    { key: 'p2', name: 'Site Evaluation', order: 2, captureMode: 'collection', assessmentTypes: P2 },
    { key: 'p3', name: 'Commercial Finalization', order: 3, captureMode: 'collection', assessmentTypes: P3 },
  ],
});
const proj = await Project.create({
  name: 'ZZ_E2E', code: `ZZE2EP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  city: 'Probe', plannedStartDate: new Date(),
  template: { ref: tpl._id, name: tpl.name, version: 1 },
  stages: [
    { key: 'p1', name: 'Property Identification', captureMode: 'collection' },
    { key: 'p2', name: 'Site Evaluation', captureMode: 'collection' },
    { key: 'p3', name: 'Commercial Finalization', captureMode: 'collection' },
  ],
});
const stageOf = async (k) => (await Project.findById(proj._id).select('stages').lean()).stages.find((s) => s.key === k).status;

try {
  console.log('PHASE 1 -> 2');
  const prop = await step('  create property record', () => recordService.create(
    { projectId: proj._id, stageKey: 'p1', values: { city: 'Probe', locality: 'X' }, status: 'submitted' }, doer._id,
  ));
  await step('  p1 shortlist (submitted -> shortlisted)', () => recordService.decide(prop._id, 'shortlist', undefined, manager._id));
  await step('  complete p1', () => projectService.completeStage(proj._id, 'p1', manager._id, { role: 'manager' }));

  await denies('  p2 blocked before any assessment', () => projectService.completeStage(proj._id, 'p2', manager._id, { role: 'manager' }), 'NO_APPROVED_PROPERTY');

  console.log('\nPHASE 2  file + approve all four assessments');
  for (const t of P2) {
    const rec = await recordService.create(
      { projectId: proj._id, stageKey: 'p2', assessmentType: t.key, parentRecordId: prop._id, values: {}, status: 'submitted' }, doer._id,
    );
    await recordService.decide(rec._id, 'approve', undefined, manager._id);
  }
  ok('  all 4 assessments filed and approved');
  await denies('  p2 still blocked until the property itself is approved',
    () => projectService.completeStage(proj._id, 'p2', manager._id, { role: 'manager' }), 'NO_APPROVED_PROPERTY');

  // THE key step: Site Evaluation's Approve button re-issues decide('shortlist').
  await step('  Site Evaluation "Approve" (shortlisted -> shortlist again)',
    () => recordService.decide(prop._id, 'shortlist', undefined, manager._id, 'Approved at site evaluation'));
  await step('  complete p2', () => projectService.completeStage(proj._id, 'p2', manager._id, { role: 'manager' }));
  ok('  p2 persisted', `status=${await stageOf('p2')}`);

  console.log('\nPHASE 3  commercial modules');
  await denies('  p3 blocked with no modules', () => projectService.completeStage(proj._id, 'p3', manager._id, { role: 'manager' }), 'MANDATORY_MODULES_PENDING');
  for (const k of ['loi', 'lease', 'legal']) {
    const rec = await recordService.create({ projectId: proj._id, stageKey: 'p3', assessmentType: k, parentRecordId: prop._id, values: {}, status: 'submitted' }, doer._id);
    await recordService.decide(rec._id, 'approve', undefined, manager._id);
  }
  await denies('  p3 blocked with 3/4 mandatory approved', () => projectService.completeStage(proj._id, 'p3', manager._id, { role: 'manager' }), 'MANDATORY_MODULES_PENDING');

  const dep = await recordService.create({ projectId: proj._id, stageKey: 'p3', assessmentType: 'deposit', parentRecordId: prop._id, values: {}, status: 'submitted' }, doer._id);
  await denies('  submitted-but-not-approved deposit still blocks', () => projectService.completeStage(proj._id, 'p3', manager._id, { role: 'manager' }), 'MANDATORY_MODULES_PENDING');
  await step('  approve deposit', () => recordService.decide(dep._id, 'approve', undefined, manager._id));
  await step('  complete p3 (NOC left untouched — optional)', () => projectService.completeStage(proj._id, 'p3', manager._id, { role: 'manager' }));
  ok('  p3 persisted', `status=${await stageOf('p3')}`);

  console.log('\nMODULE 1 GUARDS still active inside this real flow');
  await denies('  approved assessment cannot be edited', () => recordService.update(dep._id, { values: { x: 1 } }, manager._id));
  await denies('  approved -> under_review rejected', () => recordService.decide(dep._id, 'under_review', undefined, manager._id));
  await step('  undoDecision reopens it (sanctioned path)', () => recordService.undoDecision(dep._id, manager._id));
  await step('  and then it IS editable again', () => recordService.update(dep._id, { values: { x: 1 } }, manager._id));
} finally {
  console.log('\nTEARDOWN');
  await Promise.all([
    Project.deleteOne({ _id: proj._id }), Record.deleteMany({ project: proj._id }),
    Task.deleteMany({ project: proj._id }), Template.deleteOne({ _id: tpl._id }),
  ]);
  const left = await Project.countDocuments({ code: /^ZZE2EP-/ }) + await Template.countDocuments({ code: /^ZZE2E-/ }) + await Record.countDocuments({ project: proj._id });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left}`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

