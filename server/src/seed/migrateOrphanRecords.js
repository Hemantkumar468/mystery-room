/* eslint-disable no-console */
/**
 * MIGRATION — delete Records and Tasks whose parent Project no longer exists.
 *
 * Before the delete cascade was fixed (audit H13), `projectService.remove()`
 * deleted the Project and its Tasks but left every Record behind. Those rows
 * still carry a `project` ObjectId pointing at a document that is gone, so
 * any aggregate that counts Records without joining through Project silently
 * includes dead data — and always will, since nothing else ever cleans them.
 *
 * The cascade is fixed going forward; this clears the backlog it left.
 *
 * DRY RUN BY DEFAULT — prints exactly what it would delete and writes nothing.
 *
 *   node src/seed/migrateOrphanRecords.js            # dry run
 *   node src/seed/migrateOrphanRecords.js --apply    # actually delete
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';

const APPLY = process.argv.includes('--apply');

async function run() {
  const liveIds = new Set(
    (await Project.find({}).select('_id').lean()).map((p) => String(p._id)),
  );
  console.log(`${liveIds.size} live project(s).\n`);

  const [records, tasks] = await Promise.all([
    Record.find({}).select('project stageKey').lean(),
    Task.find({}).select('project stageKey').lean(),
  ]);

  const orphanRecords = records.filter((r) => !liveIds.has(String(r.project)));
  const orphanTasks = tasks.filter((t) => !liveIds.has(String(t.project)));

  const byStage = (rows) => rows.reduce((acc, r) => {
    acc[r.stageKey || '(none)'] = (acc[r.stageKey || '(none)'] || 0) + 1;
    return acc;
  }, {});

  console.log(`Records : ${records.length} total, ${orphanRecords.length} orphaned`);
  if (orphanRecords.length) console.log(`          by stage: ${JSON.stringify(byStage(orphanRecords))}`);
  console.log(`Tasks   : ${tasks.length} total, ${orphanTasks.length} orphaned`);
  if (orphanTasks.length) console.log(`          by stage: ${JSON.stringify(byStage(orphanTasks))}`);

  // Distinct dead project ids, so the operator can see how many deletions
  // this is really cleaning up after.
  const deadProjects = new Set([
    ...orphanRecords.map((r) => String(r.project)),
    ...orphanTasks.map((t) => String(t.project)),
  ]);
  console.log(`\nBelonging to ${deadProjects.size} deleted project(s).`);

  if (!orphanRecords.length && !orphanTasks.length) {
    console.log('\nNothing to clean — no orphans found.');
    return;
  }

  if (APPLY) {
    const ids = [...deadProjects];
    const [rRes, tRes] = await Promise.all([
      Record.deleteMany({ project: { $in: ids } }),
      Task.deleteMany({ project: { $in: ids } }),
    ]);
    console.log(`\nDeleted ${rRes.deletedCount} record(s) and ${tRes.deletedCount} task(s).`);

    // Re-verify rather than trusting the delete counts.
    const remaining = (await Record.find({}).select('project').lean())
      .filter((r) => !liveIds.has(String(r.project))).length;
    console.log(remaining === 0 ? 'Verified: no orphaned records remain.' : `WARNING: ${remaining} orphan(s) still present.`);
  } else {
    console.log(`\nWould delete ${orphanRecords.length} record(s) and ${orphanTasks.length} task(s).`);
    console.log('DRY RUN — nothing was written. Re-run with --apply to commit.');
  }
}

connectDatabase()
  .then(run)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(disconnectDatabase);
