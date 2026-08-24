/**
 * One-off repair: give every open, ownerless task a real doer.
 *
 * The audit (2026-08-24) found 780 of 1,315 open tasks reachable by NOBODY's
 * My Tasks — `assignee` and `assigneeRefs` both empty. Two causes, same
 * symptom:
 *
 *   1. Nine DUO roster ids in storeLaunchTemplate.js named employees that do
 *      not exist (`emp-hr-001` among them — every hiring task was invisible).
 *   2. Tasks created before auto-assignment existed carry a `primaryAssignee`
 *      roster id that was never resolved to an account.
 *
 * Resolution order per task, mirroring project.service.js#buildTaskDoc:
 *   a. the task's own roster ids (`assignees[]`, `primaryAssignee`) through
 *      User.employeeId;
 *   b. else the department's CURRENT duo (the fixed table below) — primary
 *      becomes the doer, backup a watcher.
 * Names that resolve to nobody are still dropped rather than guessed, and a
 * task that already has any assignee/assigneeRefs is never touched.
 *
 * SAFE BY DEFAULT: dry run, prints the plan. Pass --apply to write.
 *
 *   node src/seed/backfillTaskAssignees.js            # report only
 *   node src/seed/backfillTaskAssignees.js --apply    # write
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { User } from '../modules/auth/auth.model.js';

const APPLY = process.argv.includes('--apply');

/** Department → [primary, backup] roster ids. MUST mirror storeLaunchTemplate.js#DUO. */
const DUO = {
  expansion: ['emp-exp-001', 'MR-05'],
  legal: ['emp-leg-001'],
  projects: ['emp-prj-002', 'MR-04'],
  hr: ['MR-11'],
  marketing: ['emp-mkt-001', 'MR-12'],
  finance: ['emp-fin-001'],
  operations: ['emp-ops-001', 'MR-07'],
  construction: ['emp-con-001', 'MR-09'],
  interior: ['emp-int-001', 'emp-int-002'],
  procurement: ['emp-proc-001', 'emp-proc-002'],
  automation: ['emp-aut-001', 'emp-aut-002'],
  it: ['emp-it-001', 'MR-10'],
};

async function run() {
  await mongoose.connect(config.db.uri);

  const users = await User.find({ employeeId: { $exists: true, $nin: [null, ''] } })
    .select('employeeId name').lean();
  const byRoster = new Map(users.map((u) => [u.employeeId, u]));

  const orphans = await Task.find({
    status: { $ne: 'done' },
    $and: [
      { $or: [{ assignee: null }, { assignee: { $exists: false } }] },
      { $or: [{ assigneeRefs: { $size: 0 } }, { assigneeRefs: { $exists: false } }] },
    ],
  }).select('code title department stageKey primaryAssignee backupAssignee assignees backupAssignees').lean();

  console.log(`\n${orphans.length} open task(s) currently in nobody's My Tasks.\n`);

  let fixed = 0; let unfixable = 0;
  const perDept = new Map();
  const ops = [];

  for (const t of orphans) {
    // a. the task's own roster ids first…
    let doers = [...new Set([...(t.assignees || []), t.primaryAssignee].filter(Boolean))]
      .map((r) => byRoster.get(r)).filter(Boolean);
    let buddies = [...new Set([...(t.backupAssignees || []), t.backupAssignee].filter(Boolean))]
      .map((r) => byRoster.get(r)).filter(Boolean);

    // b. …else the department's current duo.
    if (!doers.length) {
      const [p, b] = DUO[t.department] || [];
      doers = [byRoster.get(p)].filter(Boolean);
      buddies = [byRoster.get(b)].filter(Boolean);
    }
    if (!doers.length) { unfixable += 1; continue; }

    const doerIds = doers.map((u) => u._id);
    const buddyIds = buddies.map((u) => u._id).filter((id) => !doerIds.some((d) => String(d) === String(id)));
    perDept.set(t.department, (perDept.get(t.department) || 0) + 1);
    fixed += 1;

    ops.push({
      updateOne: {
        filter: { _id: t._id },
        update: {
          $set: {
            assignee: doerIds[0],
            assigneeRefs: doerIds,
            ...(buddyIds.length ? { watchers: buddyIds } : {}),
          },
        },
      },
    });
  }

  console.log('Per department:');
  for (const [d, n] of [...perDept.entries()].sort((a, b) => b[1] - a[1])) {
    const duo = DUO[d] || [];
    const owner = byRoster.get(duo[0]);
    console.log(`  ${String(d || '?').padEnd(14)} ${String(n).padStart(4)} task(s)  → mostly ${owner ? owner.name : '(task-level ids)'}`);
  }
  if (unfixable) console.log(`\n${unfixable} task(s) have no resolvable doer at all (no roster id, unknown department) — left untouched.`);

  if (!APPLY) {
    console.log(`\nDRY RUN — would assign ${fixed} task(s). Re-run with --apply to write.`);
  } else if (ops.length) {
    const res = await Task.bulkWrite(ops);
    console.log(`\nAssigned ${res.modifiedCount} task(s).`);
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
