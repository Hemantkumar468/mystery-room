/* eslint-disable no-console */
/**
 * One-time migration: nine task statuses become three, and sign-off moves to
 * its own field.
 *
 *   todo                         → pending
 *   in_progress                  → processing
 *   blocked                      → processing
 *   done                         → complete
 *   waiting_approval             → complete   + approvalState waiting_department
 *   waiting_management_approval  → complete   + approvalState waiting_management
 *   approved                     → complete   + approvalState approved
 *
 * TWO VALUES THE SPEC DID NOT MAP, decided here and called out rather than
 * quietly folded in:
 *
 *   rejected → processing + approvalState rejected
 *     A reviewer sent the work back, so it is live again and somebody owns it.
 *     `pending` would have been the other reading — "nobody has picked it up" —
 *     but a rejected task has an owner by definition. The sign-off record is
 *     kept either way, so the decision is visible and reversible.
 *
 *   review (legacy) → processing
 *     It only ever meant "with someone for a look". No rows may even hold it.
 *
 * Also done here, because the new screen is unreadable without it:
 *   • `plannedEnd` is copied into `dueAt` where `dueAt` is empty — the tree and
 *     the red clock read `dueAt`, and every existing task has only plannedEnd.
 *   • `startedAt` / `completedAt` are backfilled from `actualStart` / `actualEnd`.
 *   • every stage's `status` becomes `lifecycle` — `archived` for an archived
 *     project, `live` once the store has opened, `active` otherwise. Phase
 *     PROGRESS is not migrated because it is no longer stored: it is computed
 *     from the tasks on every read.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply.
 *
 *   node src/seed/migrateThreeStateTasks.js            # preview
 *   node src/seed/migrateThreeStateTasks.js --apply    # persist
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import {
  TASK_STATUS, TASK_APPROVAL, STAGE_LIFECYCLE, PROJECT_STATUS,
} from '../core/constants/index.js';

const APPLY = process.argv.includes('--apply');

/** status → [newStatus, newApprovalState] */
const MAP = {
  todo: [TASK_STATUS.PENDING, TASK_APPROVAL.NONE],
  in_progress: [TASK_STATUS.PROCESSING, TASK_APPROVAL.NONE],
  blocked: [TASK_STATUS.PROCESSING, TASK_APPROVAL.NONE],
  review: [TASK_STATUS.PROCESSING, TASK_APPROVAL.NONE],
  done: [TASK_STATUS.COMPLETE, TASK_APPROVAL.NONE],
  waiting_approval: [TASK_STATUS.COMPLETE, TASK_APPROVAL.WAITING_DEPARTMENT],
  waiting_management_approval: [TASK_STATUS.COMPLETE, TASK_APPROVAL.WAITING_MANAGEMENT],
  approved: [TASK_STATUS.COMPLETE, TASK_APPROVAL.APPROVED],
  rejected: [TASK_STATUS.PROCESSING, TASK_APPROVAL.REJECTED],
};

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  /* The raw driver, deliberately: Mongoose would refuse to read documents whose
     `status` is no longer in the enum, and those are precisely the rows this
     migration exists for. */
  const col = Task.collection;

  console.log('\n# Tasks');
  const counts = {};
  for (const [from, [to, approval]] of Object.entries(MAP)) {
    const n = await col.countDocuments({ status: from });
    if (!n) continue;
    counts[from] = n;
    console.log(`   ${String(n).padStart(5)}  ${from.padEnd(28)} → ${to}${approval !== TASK_APPROVAL.NONE ? `  + approvalState ${approval}` : ''}`);
    if (APPLY) {
      await col.updateMany({ status: from }, { $set: { status: to, approvalState: approval } });
    }
  }
  if (!Object.keys(counts).length) console.log('   nothing to convert — already migrated');

  const noDue = await col.countDocuments({ dueAt: { $in: [null, undefined] }, plannedEnd: { $ne: null } });
  console.log(`\n   ${String(noDue).padStart(5)}  tasks take dueAt from plannedEnd`);
  if (APPLY && noDue) {
    await col.updateMany(
      { dueAt: { $in: [null, undefined] }, plannedEnd: { $ne: null } },
      [{ $set: { dueAt: '$plannedEnd' } }],
    );
  }

  const noStamps = await col.countDocuments({ startedAt: { $in: [null, undefined] }, actualStart: { $ne: null } });
  console.log(`   ${String(noStamps).padStart(5)}  tasks take startedAt/completedAt from actualStart/actualEnd`);
  if (APPLY && noStamps) {
    await col.updateMany(
      { startedAt: { $in: [null, undefined] }, actualStart: { $ne: null } },
      [{ $set: { startedAt: '$actualStart', completedAt: '$actualEnd' } }],
    );
  }

  console.log('\n# Project stages');
  const projects = await Project.collection.find({}).toArray();
  let stagesTouched = 0;
  let projectsTouched = 0;
  for (const p of projects) {
    const lifecycle = p.status === PROJECT_STATUS.ARCHIVED ? STAGE_LIFECYCLE.ARCHIVED
      : p.status === PROJECT_STATUS.STORE_LIVE ? STAGE_LIFECYCLE.LIVE
        : STAGE_LIFECYCLE.ACTIVE;
    const stages = (p.stages || []).map((s) => {
      const { status, ...rest } = s;
      return { ...rest, lifecycle };
    });
    if (!stages.length) continue;
    stagesTouched += stages.length;
    projectsTouched += 1;
    if (APPLY) {
      await Project.collection.updateOne({ _id: p._id }, { $set: { stages } });
    }
  }
  console.log(`   ${String(stagesTouched).padStart(5)}  stages across ${projectsTouched} project(s) → lifecycle`);

  console.log(APPLY
    ? '\nDone.'
    : '\nNothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
