/* eslint-disable no-console */
/**
 * One-time backfill: the Store Launch Go-Live Checklist (p9) redesign moved
 * from Record-based module forms (assessmentTypes — untouched, still usable
 * by the old page) to per-item `Task` documents (stageKey: 'p9', one per
 * checklist line, grouped by `taskCategory` — see storeLaunchTemplate.js's
 * new p9 `tasks` blueprint). Projects created before this change have no such
 * Tasks yet; this script backfills them. Direct clone of
 * migrateP8TasksFromTemplate.js's structure, `p8` -> `p9` throughout.
 *
 * Only touches projects that:
 *   - have a `p9` stage, and
 *   - that stage isn't already `completed` (a project already Live is left
 *     alone — nothing to backfill), and
 *   - have zero existing Task documents with stageKey 'p9' AND a
 *     `taskCategory` set (so re-running this script is a no-op for an
 *     already-backfilled project). Every project materialized before this
 *     redesign has the old 2-task blueprint (`templateTaskKey` `p9_t1`/`p9_t2`,
 *     no `taskCategory`) — those are dead rows, removed right before
 *     inserting the new per-item Tasks.
 *
 * Cascades each new task's planned start/end inside the project's own p9
 * stage window, exactly like project.service.js's materializeFromTemplate().
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP9TasksFromTemplate.js            # preview only
 *   node src/seed/migrateP9TasksFromTemplate.js --apply     # actually backfill
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p9');
const orderedBlueprintTasks = [...(sourceStage.tasks || [])].sort((a, b) => a.order - b.order);

async function buildTaskDocsFor(project, p9Stage) {
  const existingCount = await Task.countDocuments({ project: project._id });
  const taskDocs = [];
  let taskCursor = dayjs(p9Stage.plannedStart || project.plannedStartDate || new Date());

  orderedBlueprintTasks.forEach((task, taskIdx) => {
    const plannedStart = taskCursor.toDate();
    const plannedEnd = taskCursor.add(task.estimatedDays || 1, 'day').toDate();
    taskCursor = dayjs(plannedEnd);

    taskDocs.push({
      project: project._id,
      code: `${project.code}-T${String(existingCount + taskDocs.length + 1).padStart(3, '0')}`,
      templateTaskKey: task.key,
      stageKey: 'p9',
      stageName: p9Stage.name,
      title: task.title,
      description: task.description,
      priority: task.priority,
      department: task.department || p9Stage.ownerDepartment,
      taskCategory: task.taskCategory,
      assignees: task.assignees || [],
      primaryAssignee: task.primaryAssignee || null,
      backupAssignee: task.backupAssignee || null,
      reassignNeeded: task.primaryAssigneeUnavailable === true && !!task.primaryAssignee,
      estimatedHours: (task.estimatedDays || 1) * 8,
      plannedStart,
      plannedEnd,
      order: task.order ?? taskIdx,
      checklist: (task.checklist || []).map((c) => ({ label: c.label, required: c.required })),
      createdBy: project.createdBy,
    });
  });

  return taskDocs;
}

async function migrate() {
  const projects = await Project.find({ 'stages.key': 'p9' });
  let backfilled = 0;
  let skippedCompleted = 0;
  let skippedAlreadyMigrated = 0;
  let legacyTasksRemoved = 0;

  for (const project of projects) {
    const p9Stage = project.stages.find((s) => s.key === 'p9');
    if (!p9Stage) continue;

    if (p9Stage.status === 'completed') {
      skippedCompleted += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const migratedCount = await Task.countDocuments({ project: project._id, stageKey: 'p9', taskCategory: { $exists: true, $ne: null } });
    if (migratedCount > 0) {
      skippedAlreadyMigrated += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const legacyCount = await Task.countDocuments({ project: project._id, stageKey: 'p9', taskCategory: { $in: [null, undefined] } });

    // eslint-disable-next-line no-await-in-loop
    const taskDocs = await buildTaskDocsFor(project, p9Stage);
    console.log(`\nProject "${project.name}" (${project.code}): would remove ${legacyCount} legacy p9 task(s), insert ${taskDocs.length} new p9 tasks`);
    backfilled += 1;
    legacyTasksRemoved += legacyCount;

    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      if (legacyCount) await Task.deleteMany({ project: project._id, stageKey: 'p9', taskCategory: { $in: [null, undefined] } });
      // eslint-disable-next-line no-await-in-loop
      if (taskDocs.length) await Task.insertMany(taskDocs);
    }
  }

  console.log(`\nProjects with a p9 stage: ${projects.length}`);
  console.log(`  • Skipped (p9 already completed / Store Live): ${skippedCompleted}`);
  console.log(`  • Skipped (already migrated to the new blueprint): ${skippedAlreadyMigrated}`);
  console.log(`  • ${APPLY ? 'Backfilled' : 'Would backfill'}: ${backfilled} (${APPLY ? 'removed' : 'would remove'} ${legacyTasksRemoved} legacy task(s) total)`);
  return backfilled;
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING backfill ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  await migrate();
}

main()
  .catch((err) => {
    console.error('✖ Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
