/**
 * REGRESSION SUITE — M2 Phase 2 + 3 stage gates
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 2 verification — Phase 2 (Site Evaluation) + Phase 3 (Commercial
 * Finalization) server-side gates, against the real MongoDB.
 *
 * Every scenario is built on its own throwaway project so no live data is
 * touched, and each fixture is torn down immediately after.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, step, denies, finish } from '../helpers/assert.js';
const allows = step;

// --- connect (Node's SRV resolver is blocked here; use direct hosts) -------
const conn = await connect();
console.log(`Connected: ${conn.name}
`);

const B = '../../src/modules/pms';
const { projectService } = await import(`${B}/projects/project.service.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);

// A throwaway template carrying realistic p2 + p3 shapes.
const P2_TYPES = ['feasibility', 'financial', 'technical', 'operational']
  .map((k) => ({ key: k, name: k, masterDataSchema: [] }));
const P3_TYPES = [
  { key: 'loi', name: 'LOI', masterDataSchema: [] },
  { key: 'lease', name: 'Lease Agreement', masterDataSchema: [] },
  { key: 'legal', name: 'Legal Verification', masterDataSchema: [] },
  { key: 'deposit', name: 'Deposit Management', masterDataSchema: [] },
  // sub-keyed => OPTIONAL, must not block completion
  { key: 'noc', name: 'NOC Management', subKeyField: 'noc_type', masterDataSchema: [{ key: 'noc_type', options: ['Fire', 'Health'] }] },
];
const tpl = await Template.create({
  name: 'ZZ_M2_TPL', code: `ZZM2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p1', name: 'Property Identification', order: 1, captureMode: 'collection' },
    { key: 'p2', name: 'Site Evaluation', order: 2, captureMode: 'collection', assessmentTypes: P2_TYPES },
    { key: 'p3', name: 'Commercial Finalization', order: 3, captureMode: 'collection', assessmentTypes: P3_TYPES },
  ],
});
const trash = { projects: [], templates: [tpl._id] };

async function makeProject(label) {
  const p = await Project.create({
    name: `ZZ_M2_${label}`, code: `ZZM2P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date(),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p1', name: 'Property Identification', captureMode: 'collection' },
      { key: 'p2', name: 'Site Evaluation', captureMode: 'collection' },
      { key: 'p3', name: 'Commercial Finalization', captureMode: 'collection' },
    ],
  });
  trash.projects.push(p._id);
  return p;
}
const mkProperty = (proj, over = {}) => Record.create({
  project: proj._id, stageKey: 'p1', seq: 1, title: 'ZZ probe property',
  values: { city: 'Probe' }, status: 'shortlisted', ...over,
});
const mkAssessment = (proj, stageKey, type, parent, status, over = {}) => Record.create({
  project: proj._id, stageKey, assessmentType: type, parentRecordId: parent._id,
  seq: Math.floor(Math.random() * 1e6), title: type, values: {}, status, ...over,
});

/* ===================================================================
 * PHASE 2 — Site Evaluation
 * =================================================================== */
console.log('PHASE 2  Site Evaluation server-side gate');

{ // 2a. A lone draft assessment must NOT complete the phase (the old hole).
  const p = await makeProject('P2_DRAFT');
  const prop = await mkProperty(p);
  await mkAssessment(p, 'p2', 'feasibility', prop, 'draft');
  await denies('  2a draft-only assessment cannot complete p2',
    () => projectService.completeStage(p._id, 'p2', null, { role: 'md' }), 'NO_APPROVED_PROPERTY');
}

{ // 2b. All 4 filed but property never decided -> still blocked.
  const p = await makeProject('P2_NODECIDE');
  const prop = await mkProperty(p, { decidedAt: undefined });
  for (const t of P2_TYPES) await mkAssessment(p, 'p2', t.key, prop, 'approved');
  await denies('  2b all assessments filed but property not decided',
    () => projectService.completeStage(p._id, 'p2', null, { role: 'md' }), 'NO_APPROVED_PROPERTY');
}

{ // 2c. Only 3 of 4 assessments filed, decided after -> blocked (mandatory assessments).
  const p = await makeProject('P2_PARTIAL');
  const prop = await mkProperty(p);
  for (const t of P2_TYPES.slice(0, 3)) await mkAssessment(p, 'p2', t.key, prop, 'approved');
  await Record.updateOne({ _id: prop._id }, { decidedAt: new Date(Date.now() + 60000) });
  await denies('  2c missing one mandatory assessment',
    () => projectService.completeStage(p._id, 'p2', null, { role: 'md' }), 'NO_APPROVED_PROPERTY');
}

{ // 2d. Decision taken BEFORE the last assessment -> that's the p1 shortlist, not a p2 approval.
  const p = await makeProject('P2_STALE');
  const prop = await mkProperty(p);
  await Record.updateOne({ _id: prop._id }, { decidedAt: new Date(Date.now() - 86400000) });
  for (const t of P2_TYPES) await mkAssessment(p, 'p2', t.key, prop, 'approved');
  await denies('  2d stale (pre-evaluation) decision rejected',
    () => projectService.completeStage(p._id, 'p2', null, { role: 'md' }), 'NO_APPROVED_PROPERTY');
}

{ // 2e. Happy path: all filed, decided afterwards -> completes, and PERSISTS.
  const p = await makeProject('P2_OK');
  const prop = await mkProperty(p);
  for (const t of P2_TYPES) await mkAssessment(p, 'p2', t.key, prop, 'approved');
  await Record.updateOne({ _id: prop._id }, { decidedAt: new Date(Date.now() + 60000) });
  await allows('  2e valid p2 completes (not over-blocked)',
    () => projectService.completeStage(p._id, 'p2', null, { role: 'md' }));
  const fresh = await Project.findById(p._id).select('stages');
  const st = fresh.stages.find((s) => s.key === 'p2');
  if (st.status === 'completed' && st.completedManually === true) ok('  2e completion PERSISTED to MongoDB', `status=${st.status}`);
  else no('  2e completion did not persist', `status=${st?.status}`);
}

/* ===================================================================
 * PHASE 3 — Commercial Finalization
 * =================================================================== */
console.log('\nPHASE 3  Commercial Finalization server-side gate');

/** Build a project whose property has already cleared p2. */
async function projectClearedP2(label) {
  const p = await makeProject(label);
  const prop = await mkProperty(p);
  for (const t of P2_TYPES) await mkAssessment(p, 'p2', t.key, prop, 'approved');
  await Record.updateOne({ _id: prop._id }, { decidedAt: new Date(Date.now() + 60000) });
  return { p, prop: await Record.findById(prop._id) };
}

{ // 3a. The exact old hole: one record exists, but no module approved.
  const { p, prop } = await projectClearedP2('P3_ONEREC');
  await mkAssessment(p, 'p3', 'loi', prop, 'submitted');
  await denies('  3a single submitted record cannot complete p3',
    () => projectService.completeStage(p._id, 'p3', null, { role: 'md' }), 'MANDATORY_MODULES_PENDING');
}

{ // 3b. 3 of 4 mandatory approved -> blocked, and names the missing one.
  const { p, prop } = await projectClearedP2('P3_PARTIAL');
  for (const k of ['loi', 'lease', 'legal']) await mkAssessment(p, 'p3', k, prop, 'approved');
  await mkAssessment(p, 'p3', 'deposit', prop, 'submitted');
  try {
    await projectService.completeStage(p._id, 'p3', null, { role: 'md' });
    no('  3b partial mandatory modules', 'completed despite a pending module');
  } catch (e) {
    const namesMissing = /Deposit Management/.test(e.message);
    const onlyOne = Array.isArray(e.details) && e.details.length === 1;
    if (e.code === 'MANDATORY_MODULES_PENDING' && namesMissing && onlyOne) {
      ok('  3b blocked and names exactly the pending module', e.message.slice(0, 60));
    } else no('  3b wrong error shape', `code=${e.code} details=${JSON.stringify(e.details)}`);
  }
}

{ // 3c. All 4 mandatory approved, NOC (sub-keyed) untouched -> must still complete.
  const { p, prop } = await projectClearedP2('P3_OPTIONAL');
  for (const k of ['loi', 'lease', 'legal', 'deposit']) await mkAssessment(p, 'p3', k, prop, 'approved');
  await allows('  3c optional sub-keyed NOC does not block completion',
    () => projectService.completeStage(p._id, 'p3', null, { role: 'md' }));
  const st = (await Project.findById(p._id).select('stages')).stages.find((s) => s.key === 'p3');
  if (st.status === 'completed') ok('  3c completion PERSISTED to MongoDB'); else no('  3c did not persist');
}

{ // 3d. Mandatory approved but for a DIFFERENT property -> must not count.
  const { p, prop } = await projectClearedP2('P3_WRONGPARENT');
  const other = await Record.create({ project: p._id, stageKey: 'p1', seq: 2, title: 'other', values: {}, status: 'shortlisted' });
  for (const k of ['loi', 'lease', 'legal', 'deposit']) await mkAssessment(p, 'p3', k, other, 'approved');
  await denies('  3d approvals on another property do not count',
    () => projectService.completeStage(p._id, 'p3', null, { role: 'md' }), 'MANDATORY_MODULES_PENDING');
  void prop;
}

{ // 3e. No property cleared p2 at all -> distinct, honest error.
  const p = await makeProject('P3_NOPROP');
  await mkProperty(p);
  await denies('  3e no p2-approved property yields NO_APPROVED_PROPERTY',
    () => projectService.completeStage(p._id, 'p3', null, { role: 'md' }), 'NO_APPROVED_PROPERTY');
}

/* ===================================================================
 * Regression — other stages unaffected
 * =================================================================== */
console.log('\nREGRESSION  neighbouring stages still behave');
{
  const p = await makeProject('REG_P1');
  await denies('  p1 still blocked with zero records',
    () => projectService.completeStage(p._id, 'p1', null, { role: 'md' }), 'NO_RECORDS');
  await mkProperty(p);
  await allows('  p1 completes once a record exists (rule unchanged)',
    () => projectService.completeStage(p._id, 'p1', null, { role: 'md' }));
}
{ // Idempotency: completing an already-completed stage must not re-run the gate.
  const { p, prop } = await projectClearedP2('REG_IDEM');
  for (const k of ['loi', 'lease', 'legal', 'deposit']) await mkAssessment(p, 'p3', k, prop, 'approved');
  await projectService.completeStage(p._id, 'p3', null, { role: 'md' });
  await Record.deleteMany({ project: p._id, stageKey: 'p3' }); // gate would now fail...
  await allows('  already-completed p3 stays idempotent', // ...but it must not be re-evaluated
    () => projectService.completeStage(p._id, 'p3', null, { role: 'md' }));
}

/* ===================================================================
 * Teardown
 * =================================================================== */
console.log('\nTEARDOWN');
for (const id of trash.projects) {
  await Promise.all([
    Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id }),
  ]);
}
await Template.deleteMany({ _id: { $in: trash.templates } });
const left = await Project.countDocuments({ code: /^ZZM2P-/ })
  + await Template.countDocuments({ code: /^ZZM2-/ })
  + await Record.countDocuments({ title: /^ZZ probe/ });
if (left === 0) ok('  zero test residue'); else no('  residue left behind', `${left} docs`);

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

