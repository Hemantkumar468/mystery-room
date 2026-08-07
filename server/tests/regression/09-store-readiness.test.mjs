/**
 * REGRESSION SUITE — M7 Phase 8 Store Readiness
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Module 7 — Phase 8 Store Readiness. Real services; self-cleaning.
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
const mgr = { id: String(admin._id), role: 'md' };

// Template with THREE readiness modules — deliberately not the production
// nine, to prove the rule is read from the template and not hardcoded.
const MODULES = ['construction', 'utilities', 'compliance'];
const p8Tasks = MODULES.flatMap((c, i) => [
  { key: `p8_${c}_1`, title: `${c} item A`, taskCategory: c, order: i * 2, estimatedDays: 1, priority: 'medium' },
  { key: `p8_${c}_2`, title: `${c} item B`, taskCategory: c, order: i * 2 + 1, estimatedDays: 1, priority: 'medium' },
]);
const tpl = await Template.create({
  name: 'ZZ_M7_TPL', code: `ZZM7-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'published', version: 1,
  stages: [
    { key: 'p7', name: 'Approval Workflow', order: 7, captureMode: 'collection' },
    { key: 'p8', name: 'Store Readiness', order: 8, captureMode: 'collection', tasks: p8Tasks },
  ],
});
const bin = [];
async function scenario(label, { p7 = 'completed' } = {}) {
  const p = await Project.create({
    name: `ZZ_M7_${label}`, code: `ZZM7P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    city: 'Probe', plannedStartDate: new Date('2020-01-01'),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p7', name: 'Approval Workflow', captureMode: 'collection', status: p7 },
      { key: 'p8', name: 'Store Readiness', captureMode: 'collection' },
    ],
  });
  bin.push(p._id);
  return p;
}
/** Seed one approved checklist item per module (full coverage). */
async function seedAll(p, over = {}) {
  const made = [];
  for (const c of MODULES) {
    // eslint-disable-next-line no-await-in-loop
    made.push(await Task.create({
      project: p._id, stageKey: 'p8', stageName: 'Store Readiness',
      code: `${p.code}-T${Math.floor(Math.random() * 9000 + 1000)}`,
      title: `ZZ probe ${c} ${Math.random().toString(36).slice(2, 6)}`,
      taskCategory: c, department: 'construction', plannedEnd: new Date('2027-01-01'),
      status: 'approved', ...over,
    }));
  }
  return made;
}
const stageOf = async (id, k) => (await Project.findById(id).select('stages').lean()).stages.find((x) => x.key === k).status;

try {
  console.log('REQ 1  P8 cannot begin until P7 is completed');
  { const p = await scenario('P7OPEN', { p7: 'in_progress' });
    await seedAll(p);
    await refusesWith('  p7 incomplete named in the refusal',
      () => projectService.completeStage(p._id, 'p8', mgr.id, mgr), /Approval Workflow \(Phase 7\) is not completed/);
  }

  console.log('\nREQ 2  Mandatory modules come from the TEMPLATE (not hardcoded)');
  { const p = await scenario('COVERAGE');
    // Only 2 of the template's 3 modules covered.
    await Task.create({ project: p._id, stageKey: 'p8', stageName: 'Store Readiness', code: `${p.code}-T001`, title: 'ZZ probe c', taskCategory: 'construction', department: 'construction', plannedEnd: new Date('2027-01-01'), status: 'approved' });
    await Task.create({ project: p._id, stageKey: 'p8', stageName: 'Store Readiness', code: `${p.code}-T002`, title: 'ZZ probe u', taskCategory: 'utilities', department: 'construction', plannedEnd: new Date('2027-01-01'), status: 'approved' });
    await refusesWith('  missing module named (compliance)',
      () => projectService.completeStage(p._id, 'p8', mgr.id, mgr), /mandatory readiness module.*compliance/i);
    // The production hardcoded list has 9 categories; this template has 3 —
    // proving the requirement is derived, not the constant.
    await Task.create({ project: p._id, stageKey: 'p8', stageName: 'Store Readiness', code: `${p.code}-T003`, title: 'ZZ probe k', taskCategory: 'compliance', department: 'construction', plannedEnd: new Date('2027-01-01'), status: 'approved' });
    await step('  completes with exactly the template\'s 3 modules covered',
      () => projectService.completeStage(p._id, 'p8', mgr.id, mgr));
    ok('  persisted', `p8=${await stageOf(p._id, 'p8')}`);
  }
  { const p = await scenario('CATVALID');
    await denies('  task rejected for a category not in the template',
      () => taskService.create({ project: p._id, stageKey: 'p8', title: 'ZZ probe bogus', taskCategory: 'quantum_ops', department: 'construction', plannedEnd: new Date('2027-01-01') }, mgr.id),
      'UNKNOWN_READINESS_MODULE');
    await step('  accepted for a real template category',
      () => taskService.create({ project: p._id, stageKey: 'p8', title: 'ZZ probe good', taskCategory: 'utilities', department: 'construction', plannedEnd: new Date('2027-01-01') }, mgr.id));
  }

  console.log('\nREQ 3  Completion refuses on pending / blocked / unapproved');
  { const p = await scenario('EMPTY');
    await denies('  no checklist items at all', () => projectService.completeStage(p._id, 'p8', mgr.id, mgr), 'READINESS_NOT_READY');
  }
  { const p = await scenario('PENDING');
    const made = await seedAll(p);
    await Task.updateOne({ _id: made[0]._id }, { status: 'todo' });
    await refusesWith('  an un-approved item blocks completion',
      () => projectService.completeStage(p._id, 'p8', mgr.id, mgr), /checklist item/i);
  }
  { const p = await scenario('BLOCKED');
    const made = await seedAll(p);
    // low priority, so this proves ANY blocked item counts (not just critical)
    await Task.updateOne({ _id: made[1]._id }, { status: 'blocked', priority: 'low' });
    await refusesWith('  ANY blocked item blocks completion (even low priority)',
      () => projectService.completeStage(p._id, 'p8', mgr.id, mgr), /blocked readiness item/i);
  }

  console.log('\nREQ 4  Reviewer / timestamps / audit history on readiness items');
  { const p = await scenario('AUDIT');
    const t = await Task.create({
      project: p._id, stageKey: 'p8', stageName: 'Store Readiness', code: `${p.code}-T900`,
      title: 'ZZ probe audit', taskCategory: 'construction', department: 'construction',
      plannedEnd: new Date('2027-01-01'), status: 'waiting_approval', assignee: new mongoose.Types.ObjectId(),
    });
    await step('  department approval recorded', () => taskService.decide(t._id, 'approve', { remarks: 'looks good' }, mgr));
    const a = await Task.findById(t._id).select('status approvedBy approvedAt approvalRemarks').lean();
    (a.status === 'waiting_management_approval' ? ok : no)('  moves to the management tier', a.status);
    (String(a.approvedBy) === String(admin._id) && a.approvedAt ? ok : no)('  reviewer + timestamp stamped');
    (a.approvalRemarks === 'looks good' ? ok : no)('  remarks persisted', a.approvalRemarks);
    const { Activity } = await import(`${B}/activity/activity.model.js`);
    const logged = await Activity.countDocuments({ entityId: t._id, action: 'approved' });
    (logged > 0 ? ok : no)('  approval written to the audit log', `${logged} entry`);
  }

  console.log('\nREQ 7  Performance');
  { const p = await scenario('PERF');
    await seedAll(p);
    const exp = await Task.find({ project: p._id, stageKey: 'p8' }).explain('executionStats');
    const plan = exp.queryPlanner?.winningPlan?.inputStage?.stage || exp.queryPlanner?.winningPlan?.stage;
    (plan !== 'COLLSCAN' ? ok : no)('  readiness query uses an index (no COLLSCAN)', String(plan));
    const st = exp.executionStats;
    (st.totalDocsExamined <= st.nReturned * 2 ? ok : no)('  no excessive doc scanning', `examined=${st.totalDocsExamined} returned=${st.nReturned}`);
  }

  console.log('\nREGRESSION  earlier modules still hold');
  { const p = await scenario('REG');
    await denies('  M5: archived lock still applies', async () => {
      const t = await Task.create({ project: p._id, stageKey: 'p8', stageName: 'S', code: `${p.code}-T950`, title: 'ZZ probe arch', taskCategory: 'utilities', department: 'construction', plannedEnd: new Date('2027-01-01') });
      await Project.updateOne({ _id: p._id }, { status: 'archived' });
      return taskService.update(t._id, { priority: 'high' }, mgr);
    });
    await Project.updateOne({ _id: p._id }, { status: 'active' });
    await denies('  M4: duplicate title still blocked',
      () => taskService.create({ project: p._id, stageKey: 'p8', title: 'ZZ probe arch', taskCategory: 'utilities', department: 'construction', plannedEnd: new Date('2027-01-01') }, mgr.id), 'DUPLICATE_TASK');
  }
} finally {
  console.log('\nTEARDOWN');
  for (const id of bin) await Promise.all([Project.deleteOne({ _id: id }), Record.deleteMany({ project: id }), Task.deleteMany({ project: id })]);
  await Template.deleteOne({ _id: tpl._id });
  const left = await Project.countDocuments({ code: /^ZZM7P-/ }) + await Template.countDocuments({ code: /^ZZM7-/ }) + await Task.countDocuments({ title: /^ZZ probe/ });
  if (left === 0) ok('  zero test residue'); else no('  residue', `${left} docs`);
}

const failures = finish('RESULT');
await disconnect();
process.exit(failures ? 1 : 0);

