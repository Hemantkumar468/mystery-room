/**
 * REGRESSION SUITE — M6 Phase 7 Approval Workflow
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 6 — Phase 7 Approval Workflow. Real services; self-cleaning.
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
const { User } = await import('../../src/modules/auth/auth.model.js');

const admin = await User.findOne({ role: 'md' }).select('_id name');
const other = await User.findOne({ _id: { $ne: admin._id } }).select('_id name');
const mgr = { id: String(admin._id), role: 'md' };
console.log(`admin=${admin.name}  other=${other.name}\n`);

const P2T = ['feasibility', 'financial', 'technical', 'operational'].map((k) => ({ key: k, name: k, masterDataSchema: [] }));
// The real six-gate sequence, in order.
const GATES = [
  ['department_review', 'Department Review'], ['functional_review', 'Functional Review'],
  ['finance_approval', 'Finance Approval'], ['legal_review', 'Legal Review'],
  ['management_approval', 'Management Approval'], ['final_approval', 'Final Approval'],
].map(([key, name]) => ({ key, name, masterDataSchema: [] }));

const tpl = await Template.create({
  name: 'ZZ_M6_TPL', code: `ZZM6-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p1', name: 'Property Identification', order: 1, captureMode: 'collection' },
    { key: 'p2', name: 'Site Evaluation', order: 2, captureMode: 'collection', assessmentTypes: P2T },
    { key: 'p6', name: 'Execution', order: 6, captureMode: 'single' },
    { key: 'p7', name: 'Approval Workflow', order: 7, captureMode: 'collection', assessmentTypes: GATES },
  ],
});
const bin = [];
async function scenario(label, { p6 = 'completed', taskStatus = 'approved' } = {}) {
  const p = await Project.create({
    name: `ZZ_M6_${label}`, code: `ZZM6P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p1', name: 'P1', captureMode: 'collection', status: 'completed' },
      { key: 'p2', name: 'P2', captureMode: 'collection', status: 'completed' },
      { key: 'p6', name: 'Execution', captureMode: 'single', status: p6 },
      { key: 'p7', name: 'Approval Workflow', captureMode: 'collection' },
    ],
  });
  bin.push(p._id);
  // A property that has cleared Site Evaluation (p7's pipeline subject).
  const prop = await Record.create({ project: p._id, stageKey: 'p1', seq: 1, title: 'ZZ probe property', values: {}, status: 'shortlisted' });
  for (const t of P2T) await Record.create({ project: p._id, stageKey: 'p2', assessmentType: t.key, parentRecordId: prop._id, seq: 1, title: t.name, values: {}, status: 'approved' });
  await Record.updateOne({ _id: prop._id }, { decidedAt: new Date(Date.now() + 60000) });
  await Task.create({ project: p._id, stageKey: 'p6', stageName: 'Execution', code: `${p.code}-T001`, title: 'ZZ probe task', department: 'construction', plannedEnd: new Date('2027-01-01'), status: taskStatus });
  return { p, prop: await Record.findById(prop._id) };
}
const gate = (p, prop, key, status = 'submitted', over = {}) => Record.create({
  project: p._id, stageKey: 'p7', assessmentType: key, parentRecordId: prop._id,
  seq: Math.floor(Math.random() * 1e6), title: key, values: {}, status, ...over,
});

try {
  console.log('REQ 1  P7 cannot begin until P6 is completed');
  { const { p } = await scenario('P6OPEN', { p6: 'in_progress' });
    try { await projectService.completeStage(p._id, 'p7', mgr.id, mgr); no('  should refuse'); }
    catch (e) { (/Execution \(Phase 6\) is not completed/.test(e.message) ? ok : no)('  p6 incomplete named in the refusal', e.message.slice(0, 66)); }
  }
  { const { p } = await scenario('TASKOPEN', { taskStatus: 'waiting_management_approval' });
    try { await projectService.completeStage(p._id, 'p7', mgr.id, mgr); no('  should refuse'); }
    catch (e) { (/1 task/.test(e.message) ? ok : no)('  un-approved execution task blocks p7', e.message.slice(0, 66)); }
  }

  console.log('\nREQ 2+3  Tier order, duplicate, self, out-of-order');
  const { p: P, prop } = await scenario('MAIN');
  const g1 = await gate(P, prop, 'department_review');
  const g3 = await gate(P, prop, 'finance_approval');
  const g6 = await gate(P, prop, 'final_approval');

  await denies('  cannot approve Final Approval first (skips 5 tiers)',
    () => recordService.decide(g6._id, 'approve', undefined, mgr.id), 'APPROVAL_OUT_OF_ORDER');
  await denies('  cannot approve tier 3 before tiers 1-2',
    () => recordService.decide(g3._id, 'approve', undefined, mgr.id), 'APPROVAL_OUT_OF_ORDER');
  await step('  tier 1 (Department Review) approves fine', () => recordService.decide(g1._id, 'approve', undefined, mgr.id));
  await denies('  duplicate/repeat approval of tier 1 rejected',
    () => recordService.decide(g1._id, 'approve', undefined, mgr.id), 'ILLEGAL_RECORD_TRANSITION');
  await denies('  tier 3 still blocked (tier 2 outstanding)',
    () => recordService.decide(g3._id, 'approve', undefined, mgr.id), 'APPROVAL_OUT_OF_ORDER');
  const g2 = await gate(P, prop, 'functional_review');
  await step('  tier 2 approves', () => recordService.decide(g2._id, 'approve', undefined, mgr.id));
  await step('  tier 3 now unblocked', () => recordService.decide(g3._id, 'approve', undefined, mgr.id));
  // self-approval
  const gSelf = await gate(P, prop, 'legal_review', 'submitted', { submittedBy: admin._id });
  await denies('  submitter cannot approve their own request',
    () => recordService.decide(gSelf._id, 'approve', undefined, mgr.id), 'SELF_APPROVAL');
  await step('  a different reviewer can', () => recordService.decide(gSelf._id, 'approve', undefined, other._id));
  // rejection is allowed at any tier, out of order
  const gRej = await gate(P, prop, 'final_approval');
  await step('  rejection allowed out of order (always permitted)',
    () => recordService.decide(gRej._id, 'reject', 'not ready', mgr.id));

  console.log('\nREQ 4  Reviewer / timestamp / remarks / decision history');
  const hist = await Record.findById(gSelf._id).select('decisionHistory approvedBy approvedAt').lean();
  (hist.decisionHistory?.length === 1 ? ok : no)('  decision appended to history', `${hist.decisionHistory?.length} entry`);
  const h0 = hist.decisionHistory[0];
  (String(h0.by) === String(other._id) ? ok : no)('  history records the real reviewer');
  (h0.at && h0.fromStatus === 'submitted' && h0.toStatus === 'approved' ? ok : no)('  history records timestamp + from/to status');
  (String(hist.approvedBy) === String(other._id) && hist.approvedAt ? ok : no)('  approvedBy/approvedAt stamped');
  const rejHist = await Record.findById(gRej._id).select('decisionHistory').lean();
  (rejHist.decisionHistory[0].reason === 'not ready' ? ok : no)('  rejection reason preserved in history');
  await denies('  reject still requires a reason', () => recordService.decide(g6._id, 'reject', '   ', mgr.id));

  console.log('\nREQ 5  Proceed to Phase 8 gate');
  try { await projectService.completeStage(P._id, 'p7', mgr.id, mgr); no('  should refuse — pipeline incomplete'); }
  catch (e) { (/approval module/.test(e.message) ? ok : no)('  refuses while approval modules are pending', e.message.slice(0, 72)); }
  // finish every gate properly
  await recordService.decide(gRej._id, 'archive', undefined, mgr.id); // clear the rejected one
  const g5 = await gate(P, prop, 'management_approval');
  await step('  tier 5 approves', () => recordService.decide(g5._id, 'approve', undefined, mgr.id));
  const g6b = await gate(P, prop, 'final_approval');
  await step('  tier 6 approves (all predecessors cleared)', () => recordService.decide(g6b._id, 'approve', undefined, mgr.id));
  await step('  p7 completes once every gate is approved', () => projectService.completeStage(P._id, 'p7', mgr.id, mgr));
  const st = (await Project.findById(P._id).select('stages').lean()).stages.find((x) => x.key === 'p7').status;
  (st === 'completed' ? ok : no)('  completion PERSISTED to MongoDB', `status=${st}`);

  console.log('\nREQ 8  Indexes / performance');
  const idx = (await Record.collection.indexes()).map((i) => JSON.stringify(i.key));
  (idx.includes('{"project":1,"stageKey":1,"parentRecordId":1,"assessmentType":1}') ? ok : no)('  pipeline compound index present');
  const exp = await Record.find({ project: P._id, stageKey: 'p7', parentRecordId: prop._id, assessmentType: 'final_approval' }).explain('executionStats');
  const plan = exp.queryPlanner?.winningPlan?.inputStage?.stage || exp.queryPlanner?.winningPlan?.stage;
  (plan !== 'COLLSCAN' ? ok : no)('  per-module lookup uses an index (no COLLSCAN)', String(plan));

  console.log('\nREGRESSION  earlier phases unaffected');
  { const { p: q, prop: pr } = await scenario('REG');
    // p2's own approval flow must still work (no p7 rules leaking into it)
    const p2rec = await Record.findOne({ project: q._id, stageKey: 'p2' }).select('_id');
    await step('  p2 record decisions still work', () => recordService.decide(p2rec._id, 'undo' in {} ? 'approve' : 'archive', undefined, mgr.id));
    void pr;
  }
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM6P-/ }) + await Template.countDocuments({ code: /^ZZM6-/ }) + await Record.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

