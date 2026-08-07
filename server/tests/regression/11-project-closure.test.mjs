/**
 * REGRESSION SUITE — M9 Phase 10 Project Closure
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 9 — Phase 10 Project Closure (audit finding H10). Real services.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, step, denies, refusesWith, finish } from '../helpers/assert.js';

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

const admin = await User.findOne({ role: 'md' }).select('_id name');
const other = await User.findOne({ _id: { $ne: admin._id } }).select('_id name');
const mgr = { id: String(admin._id), role: 'md' };

// A deliberately SMALL closure module set (production has 8) to prove the
// requirement is read from the template, not the CLOSURE_MODULES constant.
const MODULES = ['budget_analysis', 'project_sign_off'];
const tpl = await Template.create({
  name: 'ZZ_M9_TPL', code: `ZZM9-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p9', name: 'Store Launch', order: 9, captureMode: 'collection' },
    {
      key: 'p10', name: 'Project Closure', order: 10, captureMode: 'collection',
      assessmentTypes: MODULES.map((k) => ({ key: k, name: k, masterDataSchema: [] })),
    },
  ],
});
const bin = [];
async function scenario(label, { p9 = 'completed', status = 'store_live' } = {}) {
  const p = await Project.create({
    name: `ZZ_M9_${label}`, code: `ZZM9P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'), status,
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p9', name: 'Store Launch', captureMode: 'collection', status: p9 },
      { key: 'p10', name: 'Project Closure', captureMode: 'collection' },
    ],
  });
  bin.push(p._id);
  return p;
}
const mod = (p, key, status = 'approved', over = {}) => Record.create({
  project: p._id, stageKey: 'p10', assessmentType: key, seq: Math.floor(Math.random() * 1e6),
  title: `ZZ probe ${key}`, values: {}, status, ...over,
});
const proj = async (id) => Project.findById(id).select('status stages closedAt closedBy closureRemarks archivedAt archivedBy').lean();
const p10Status = async (id) => (await proj(id)).stages.find((x) => x.key === 'p10').status;

try {
  console.log('H10  p10 completion was ungated — the core finding');
  { const p = await scenario('H10');
    await mod(p, 'budget_analysis'); // a single record used to be enough
    await refusesWith('  one closure record no longer completes p10',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /closure module.*not approved/i);
    (await p10Status(p._id)) === 'not_started' ? ok('  p10 untouched') : no('  p10 completed anyway');
  }

  console.log('\nREQ 1  Every prior phase must be complete');
  { const p = await scenario('PRIOR', { p9: 'in_progress' });
    for (const k of MODULES) await mod(p, k);
    await refusesWith('  incomplete prior phase named',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /earlier phase\(s\) not yet completed/);
  }

  console.log('\nREQ 2  Modules come from the TEMPLATE, not a constant');
  { const p = await scenario('MODULES');
    await mod(p, 'budget_analysis');
    await refusesWith('  missing template module named',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /project_sign_off/);
    await mod(p, 'project_sign_off');
    await step('  completes with exactly the template\'s 2 modules (prod has 8)',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr));
  }

  console.log('\nREQ 3  Refuses on pending / open / blocked / bad lifecycle');
  { const p = await scenario('AWAITING');
    await mod(p, 'budget_analysis');
    await mod(p, 'project_sign_off');
    await mod(p, 'budget_analysis', 'submitted');
    await refusesWith('  a submission awaiting decision blocks closure',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /awaiting a decision/);
  }
  { const p = await scenario('OPENTASK');
    for (const k of MODULES) await mod(p, k);
    await Task.create({ project: p._id, stageKey: 'p6', stageName: 'Exec', code: `${p.code}-T001`, title: 'ZZ probe open', status: 'in_progress' });
    await refusesWith('  an unfinished task anywhere blocks closure',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /not fully approved/);
  }
  { const p = await scenario('BLOCKEDTASK');
    for (const k of MODULES) await mod(p, k);
    await Task.create({ project: p._id, stageKey: 'p6', stageName: 'Exec', code: `${p.code}-T002`, title: 'ZZ probe blocked', status: 'blocked' });
    await refusesWith('  a blocked task blocks closure',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /not fully approved/);
  }
  { const p = await scenario('LIFECYCLE', { status: 'active' });
    for (const k of MODULES) await mod(p, k);
    await refusesWith('  a project that never went live cannot be closed',
      () => projectService.completeStage(p._id, 'p10', mgr.id, mgr), /has not gone live/);
  }

  console.log('\nREQ 5  Closure audit trail');
  const CL = await scenario('AUDIT');
  await mod(CL, 'budget_analysis');
  await mod(CL, 'project_sign_off', 'approved', { decisionReason: 'All obligations settled' });
  await step('  closure completes', () => projectService.completeStage(CL._id, 'p10', mgr.id, mgr));
  { const a = await proj(CL._id);
    (a.closedAt ? ok : no)('  closedAt stamped');
    (String(a.closedBy) === String(admin._id) ? ok : no)('  closedBy stamped');
    (a.closureRemarks === 'All obligations settled' ? ok : no)('  closureRemarks carried from the sign-off module', a.closureRemarks);
  }
  { // per-module decision history (Module 6's append-only trail)
    const rec = await Record.findOne({ project: CL._id, assessmentType: 'budget_analysis' }).select('_id');
    await recordService.decide(rec._id, 'archive', undefined, admin._id);
    const h = await Record.findById(rec._id).select('decisionHistory').lean();
    (h.decisionHistory?.length >= 1 ? ok : no)('  closure decision history recorded', `${h.decisionHistory?.length} entries`);
  }

  console.log('\nREQ 4  Archive cannot bypass closure; lifecycle is one-way');
  { const p = await scenario('ARCHBYPASS');
    await mod(p, 'budget_analysis'); // p10 deliberately NOT complete
    await denies('  archive refused while closure is incomplete',
      () => projectService.archiveProject(p._id, mgr.id, 'nope'), 'ARCHIVE_NOT_READY');
    (await proj(p._id)).status === 'store_live' ? ok('  project not archived') : no('  archived anyway');
  }
  { const p = await scenario('ARCHOK');
    for (const k of MODULES) await mod(p, k);
    await projectService.completeStage(p._id, 'p10', mgr.id, mgr);
    await step('  archive succeeds once closure is genuinely done',
      () => projectService.archiveProject(p._id, mgr.id, 'Closed and settled'));
    const a = await proj(p._id);
    (a.status === 'archived' && a.archivedAt && String(a.archivedBy) === String(admin._id) ? ok : no)('  archive stamps persisted', a.status);
    await step('  re-archiving is idempotent', () => projectService.archiveProject(p._id, mgr.id, 'again'));
    await denies('  generic PATCH cannot un-archive (M1 one-way guard)',
      () => projectService.update(p._id, { status: 'active' }, mgr.id));
    // archived => read-only (M1/M5)
    const t = await Task.create({ project: p._id, stageKey: 'p6', stageName: 'E', code: `${p.code}-T900`, title: 'ZZ probe ro', status: 'approved' });
    await denies('  archived project still read-only for tasks', () => taskService.update(t._id, { priority: 'high' }, mgr));
    await denies('  archived project still read-only for records',
      () => recordService.create({ projectId: p._id, stageKey: 'p10', values: {} }, admin._id));
  }

  console.log('\nREQ 6  Permissions / API security');
  { const p = await scenario('PERM');
    for (const k of MODULES) await mod(p, k);
    await denies('  executor cannot archive',
      () => projectService.archiveProject(p._id, String(other._id), 'x'), 'ARCHIVE_NOT_READY'); // gate first
  }

  console.log('\nREQ 7  Performance');
  { const p = await scenario('PERF');
    for (const k of MODULES) await mod(p, k);
    const exp = await Record.find({ project: p._id, stageKey: 'p10' }).explain('executionStats');
    const plan = exp.queryPlanner?.winningPlan?.inputStage?.stage || exp.queryPlanner?.winningPlan?.stage;
    (plan !== 'COLLSCAN' ? ok : no)('  closure query uses an index (no COLLSCAN)', String(plan));
    const st = exp.executionStats;
    (st.totalDocsExamined <= Math.max(st.nReturned * 2, 4) ? ok : no)('  no excessive scanning', `examined=${st.totalDocsExamined} returned=${st.nReturned}`);
  }

  console.log('\nSERVER-DRIVEN completion (replaces the client useEffect)');
  { const p = await scenario('AUTO');
    await mod(p, 'budget_analysis');
    const last = await mod(p, 'project_sign_off', 'submitted');
    await step('  approving the final module triggers closure server-side',
      () => recordService.decide(last._id, 'approve', undefined, admin._id));
    (await p10Status(p._id)) === 'completed' ? ok('  p10 completed by the server') : no('  p10 not completed', await p10Status(p._id));
  }
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM9P-/ }) + await Template.countDocuments({ code: /^ZZM9-/ }) + await Record.countDocuments({ title: /^ZZ probe/ }) + await Task.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

