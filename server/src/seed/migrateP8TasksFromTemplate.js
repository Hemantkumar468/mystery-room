/* eslint-disable no-console */
/**
 * One-time backfill: the Store Readiness Checklist (p8) redesign moved from
 * Record-based module forms (assessmentTypes — untouched, still readable via
 * the preserved records/StoreReadinessRecordPipeline.jsx) to per-item `Task`
 * documents (stageKey: 'p8', one per checklist line, grouped by `taskCategory`
 * — see storeLaunchTemplate.js's new p8 `tasks` blueprint). Projects created
 * before this change have no such Tasks yet; this script backfills them.
 *
 * Only touches projects that:
 *   - have a `p8` stage, and
 *   - that stage isn't already `completed` (a project that already finished
 *     Phase 8 the old, Record-based way is left alone — nothing to backfill), and
 *   - have zero existing Task documents with stageKey 'p8' AND a `taskCategory`
 *     set (so re-running this script is a no-op for an already-backfilled
 *     project). `taskCategory` is the marker for "new blueprint" — every
 *     project materialized before this redesign already has a *different*
 *     set of p8 Task documents: the old 10-task blueprint (`templateTaskKey`
 *     like `p8_t1..p8_t10`), silently created by materializeFromTemplate()
 *     at project-creation time even though no UI ever surfaced them (the old
 *     Store Readiness page was entirely Record-based). Those are dead rows —
 *     this script deletes them for a project right before inserting its new
 *     per-item Tasks, so the redesigned dashboard's counts aren't polluted by
 *     10 uncategorized ghost tasks per project.
 *
 * Cascades each new task's planned start/end inside the project's own p8
 * stage window, exactly like project.service.js's materializeFromTemplate()
 * does at project-creation time — this is the same logic, just applied after
 * the fact to a single stage on already-existing projects.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateP8TasksFromTemplate.js            # preview only
 *   node src/seed/migrateP8TasksFromTemplate.js --apply     # actually backfill
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');
const sourceStage = storeLaunchTemplate.stages.find((s) => s.key === 'p8');
const orderedBlueprintTasks = [...(sourceStage.tasks || [])].sort((a, b) => a.order - b.order);

async function buildTaskDocsFor(project, p8Stage) {
  const existingCount = await Task.countDocuments({ project: project._id });
  const taskDocs = [];
  let taskCursor = dayjs(p8Stage.plannedStart || project.plannedStartDate || new Date());

  orderedBlueprintTasks.forEach((task, taskIdx) => {
    const plannedStart = taskCursor.toDate();
    const plannedEnd = taskCursor.add(task.estimatedDays || 1, 'day').toDate();
    taskCursor = dayjs(plannedEnd);

    taskDocs.push({
      project: project._id,
      code: `${project.code}-T${String(existingCount + taskDocs.length + 1).padStart(3, '0')}`,
      templateTaskKey: task.key,
      stageKey: 'p8',
      stageName: p8Stage.name,
      title: task.title,
      description: task.description,
      priority: task.priority,
      department: task.department || p8Stage.ownerDepartment,
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
  const projects = await Project.find({ 'stages.key': 'p8' });
  let backfilled = 0;
  let skippedCompleted = 0;
  let skippedAlreadyMigrated = 0;
  let legacyTasksRemoved = 0;

  for (const project of projects) {
    const p8Stage = project.stages.find((s) => s.key === 'p8');
    if (!p8Stage) continue;

    if (p8Stage.status === 'completed') {
      skippedCompleted += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const migratedCount = await Task.countDocuments({ project: project._id, stageKey: 'p8', taskCategory: { $exists: true, $ne: null } });
    if (migratedCount > 0) {
      skippedAlreadyMigrated += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const legacyCount = await Task.countDocuments({ project: project._id, stageKey: 'p8', taskCategory: { $in: [null, undefined] } });

    // eslint-disable-next-line no-await-in-loop
    const taskDocs = await buildTaskDocsFor(project, p8Stage);
    console.log(`\nProject "${project.name}" (${project.code}): would remove ${legacyCount} legacy p8 task(s), insert ${taskDocs.length} new p8 tasks`);
    backfilled += 1;
    legacyTasksRemoved += legacyCount;

    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      if (legacyCount) await Task.deleteMany({ project: project._id, stageKey: 'p8', taskCategory: { $in: [null, undefined] } });
      // eslint-disable-next-line no-await-in-loop
      if (taskDocs.length) await Task.insertMany(taskDocs);
    }
  }

  console.log(`\nProjects with a p8 stage: ${projects.length}`);
  console.log(`  • Skipped (p8 already completed): ${skippedCompleted}`);
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
