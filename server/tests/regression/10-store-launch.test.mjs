/**
 * REGRESSION SUITE — M8 Phase 9 Store Launch
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 8 — Phase 9 Store Launch (Go-Live). Real services; self-cleaning.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, step, denies, refusesWith, finish } from '../helpers/assert.js';

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
const other = await User.findOne({ _id: { $ne: admin._id } }).select('_id name');
const mgr = { id: String(admin._id), role: 'md' };
const ANCHOR = 'p9_golive_final';

// Deliberately a 2-module template (production has 12) to prove the rule is
// read from the template, not from the hardcoded LAUNCH_CATEGORY_ORDER.
const MODULES = ['operations', 'pos'];
const p9Blueprint = [
  ...MODULES.map((c, i) => ({ key: `p9_${c}_1`, title: `${c} item`, taskCategory: c, order: i, estimatedDays: 1, priority: 'medium' })),
  { key: ANCHOR, title: 'Final Go-Live Approval', taskCategory: 'operations', order: 9, estimatedDays: 1, priority: 'critical' },
];
const tpl = await Template.create({
  name: 'ZZ_M8_TPL', code: `ZZM8-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p8', name: 'Store Readiness', order: 8, captureMode: 'collection' },
    { key: 'p9', name: 'Store Launch', order: 9, captureMode: 'collection', tasks: p9Blueprint },
  ],
});
const bin = [];
/** Project whose every stage is complete except p9 (unless overridden). */
async function scenario(label, { p8 = 'completed' } = {}) {
  const p = await Project.create({
    name: `ZZ_M8_${label}`, code: `ZZM8P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'), status: 'active',
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p8', name: 'Store Readiness', captureMode: 'collection', status: p8 },
      { key: 'p9', name: 'Store Launch', captureMode: 'collection' },
    ],
  });
  bin.push(p._id);
  return p;
}
const mk = (p, over = {}) => Task.create({
  project: p._id, stageKey: 'p9', stageName: 'Store Launch',
  code: `${p.code}-T${Math.floor(Math.random() * 9000 + 1000)}`,
  title: `ZZ probe ${Math.random().toString(36).slice(2, 7)}`,
  department: 'operations', plannedEnd: new Date('2027-01-01'), status: 'approved', ...over,
});
/** Full, launch-ready checklist: every module covered + anchor approved. */
async function seedReady(p) {
  for (const c of MODULES) await mk(p, { taskCategory: c });
  return mk(p, { taskCategory: 'operations', templateTaskKey: ANCHOR, title: 'ZZ probe golive' });
}
const projStatus = async (id) => (await Project.findById(id).select('status storeLiveAt storeLiveBy').lean());

try {
  console.log('REQ 1  P9 cannot begin until every prior phase is complete');
  { const p = await scenario('P8OPEN', { p8: 'in_progress' });
    await seedReady(p);
    await refusesWith('  incomplete prior phase named', () => projectService.completeStage(p._id, 'p9', mgr.id, mgr), /earlier phase\(s\) not yet completed/);
    (await projStatus(p._id)).status === 'active' ? ok('  project NOT taken live') : no('  project went live anyway');
  }

  console.log('\nREQ 2  Mandatory launch modules come from the TEMPLATE');
  { const p = await scenario('COVERAGE');
    await mk(p, { taskCategory: 'operations' });
    await mk(p, { taskCategory: 'operations', templateTaskKey: ANCHOR, title: 'ZZ probe golive' });
    await refusesWith('  missing module named (pos)', () => projectService.completeStage(p._id, 'p9', mgr.id, mgr), /launch module.*pos/i);
  }

  console.log('\nREQ 3  Final Go-Live Approval enforced SERVER-side (was client-only)');
  { const p = await scenario('ANCHOR_MISSING');
    for (const c of MODULES) await mk(p, { taskCategory: c });
    await refusesWith('  anchor never allocated -> refused',
      () => projectService.completeStage(p._id, 'p9', mgr.id, mgr), /Final Go-Live Approval item has not been allocated/);
  }
  { const p = await scenario('ANCHOR_UNAPPROVED');
    for (const c of MODULES) await mk(p, { taskCategory: c });
    await mk(p, { taskCategory: 'operations', templateTaskKey: ANCHOR, title: 'ZZ probe golive', status: 'waiting_management_approval' });
    await refusesWith('  anchor not yet approved -> refused',
      () => projectService.completeStage(p._id, 'p9', mgr.id, mgr), /Final Go-Live Approval has not been given/);
    (await projStatus(p._id)).status === 'active' ? ok('  store NOT live without the go-live sign-off') : no('  store went live without sign-off');
  }

  console.log('\nREQ 4  Blocked / unapproved items stop a launch');
  { const p = await scenario('BLOCKED');
    const t = await mk(p, { taskCategory: 'operations' });
    await mk(p, { taskCategory: 'pos' });
    await mk(p, { taskCategory: 'operations', templateTaskKey: ANCHOR, title: 'ZZ probe golive' });
    await Task.updateOne({ _id: t._id }, { status: 'blocked', priority: 'low' });
    await refusesWith('  ANY blocked item blocks launch (even low priority)',
      () => projectService.completeStage(p._id, 'p9', mgr.id, mgr), /blocked checklist item/i);
  }

  console.log('\nREQ 5  Typed signature enforced on Go-Live approvals');
  { const p = await scenario('SIG');
    const t = await mk(p, { taskCategory: 'operations', status: 'waiting_approval', assignee: other._id });
    await denies('  approve without a signature refused', () => taskService.decide(t._id, 'approve', {}, mgr));
    await step('  approve with a signature accepted', () => taskService.decide(t._id, 'approve', { signature: admin.name }, mgr));
    const saved = await Task.findById(t._id).select('approvalSignature status').lean();
    (saved.approvalSignature === admin.name ? ok : no)('  signature persisted', saved.approvalSignature);
  }

  console.log('\nREQ 6  Permissions — launch is manager/admin only');
  { const p = await scenario('ROLE');
    await seedReady(p);
    await denies('  executor cannot take the store live',
      () => projectService.completeStage(p._id, 'p9', String(other._id), { id: String(other._id), role: 'employee' }));
    (await projStatus(p._id)).status === 'active' ? ok('  still not live') : no('  went live via executor');
  }

  console.log('\nREQ 7  Happy path — the one-way door');
  const LIVE = await scenario('GOLIVE');
  await seedReady(LIVE);
  await step('  launch succeeds when genuinely ready', () => projectService.completeStage(LIVE._id, 'p9', mgr.id, mgr));
  const live = await projStatus(LIVE._id);
  (live.status === 'store_live' ? ok : no)('  project.status = store_live', live.status);
  (live.storeLiveAt && String(live.storeLiveBy) === String(admin._id) ? ok : no)('  storeLiveAt/By stamped');
  await step('  re-completing is idempotent', () => projectService.completeStage(LIVE._id, 'p9', mgr.id, mgr));
  const still = await projStatus(LIVE._id);
  (String(still.storeLiveAt) === String(live.storeLiveAt) ? ok : no)('  storeLiveAt NOT overwritten by re-completion');
  await denies('  generic PATCH cannot move a live project back (M1 guard)',
    () => projectService.update(LIVE._id, { status: 'active' }, mgr.id));

  console.log('\nREQ 8  Performance');
  { const exp = await Task.find({ project: LIVE._id, stageKey: 'p9' }).explain('executionStats');
    const plan = exp.queryPlanner?.winningPlan?.inputStage?.stage || exp.queryPlanner?.winningPlan?.stage;
    (plan !== 'COLLSCAN' ? ok : no)('  launch query uses an index (no COLLSCAN)', String(plan));
    const st = exp.executionStats;
    (st.totalDocsExamined <= Math.max(st.nReturned * 2, 4) ? ok : no)('  no excessive scanning', `examined=${st.totalDocsExamined} returned=${st.nReturned}`);
  }

  console.log('\nREGRESSION  earlier modules still hold');
  await denies('  M4: duplicate title still blocked',
    () => taskService.create({ project: LIVE._id, stageKey: 'p9', title: 'ZZ probe golive', taskCategory: 'operations', department: 'operations', plannedEnd: new Date('2027-01-01') }, mgr.id), 'DUPLICATE_TASK');
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM8P-/ }) + await Template.countDocuments({ code: /^ZZM8-/ }) + await Task.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

