/* eslint-disable no-console */
/**
 * One-time cleanup: `materializeFromTemplate()` used to bulk-insert every
 * task from every phase of a project's template the moment the project was
 * created (see project.service.js's doc comment on that function) — real
 * Task documents nobody had actually allocated, sitting in every phase
 * (including ones months away) from day one. That auto-creation has been
 * removed; this script removes the ghost rows it already left behind on
 * projects created before this change.
 *
 * A task is treated as an untouched auto-seeded ghost when ALL of:
 *   - `templateTaskKey` is set — only ever written by the old materialize
 *     logic or (going forward) a real user deliberately picking a Phase 9
 *     "Task Purpose" in AllocateTaskModal. Since that picker didn't exist
 *     before this deploy, every `templateTaskKey` in the database *today*
 *     came from the old auto-seed path — this script is meant to be run
 *     once, right after deploying, before that picker has seen real use.
 *   - `status` is still the model default `'todo'` — nobody has touched it.
 *   - `assignee` (the real User reference a manual Allocate Task submission
 *     sets) was never set — auto-seeded tasks only ever got the roster
 *     `primaryAssignee`/`backupAssignee` strings, never a real `assignee`.
 *
 * A task that was auto-seeded but a real user has since worked on (status
 * changed, or picked up as an assignee) is deliberately left alone — once a
 * human has interacted with it, deleting it would destroy real activity, not
 * clean up a ghost.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and deletes nothing. Pass --apply to
 * actually delete. Prints every matched task (project, code, title) so
 * whoever runs --apply can review the exact list first.
 *
 *   node src/seed/removeAutoSeededTasks.js            # preview only
 *   node src/seed/removeAutoSeededTasks.js --apply     # actually delete
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { projectService } from '../modules/pms/projects/project.service.js';
import { TASK_STATUS } from '../core/constants/index.js';

const APPLY = process.argv.includes('--apply');

const GHOST_FILTER = {
  templateTaskKey: { $exists: true, $ne: null },
  status: TASK_STATUS.TODO,
  assignee: { $in: [null, undefined] },
};

async function migrate() {
  const ghosts = await Task.find(GHOST_FILTER).select('project code title stageKey templateTaskKey').sort({ project: 1, code: 1 });
  if (!ghosts.length) {
    console.log('No untouched auto-seeded tasks found — nothing to do.');
    return 0;
  }

  const projectIds = [...new Set(ghosts.map((t) => String(t.project)))];
  const projects = await Project.find({ _id: { $in: projectIds } }).select('name code');
  const projectById = new Map(projects.map((p) => [String(p._id), p]));

  const byProject = new Map();
  for (const t of ghosts) {
    const key = String(t.project);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }

  for (const [projectId, tasks] of byProject) {
    const project = projectById.get(projectId);
    console.log(`\n${project ? `${project.name} (${project.code})` : projectId}: ${tasks.length} ghost task(s)`);
    for (const t of tasks) {
      console.log(`  - [${t.stageKey}] ${t.code}  ${t.title}  (templateTaskKey: ${t.templateTaskKey})`);
    }
  }

  console.log(`\nTotal: ${ghosts.length} ghost task(s) across ${byProject.size} project(s).`);

  if (APPLY) {
    const ids = ghosts.map((t) => t._id);
    await Task.deleteMany({ _id: { $in: ids } });
    console.log(`Deleted ${ids.length} task(s).`);
    // Stage/project progress rollups may reference the now-deleted tasks —
    // recompute so counts stay consistent, same as after any real task change.
    for (const projectId of projectIds) {
      // eslint-disable-next-line no-await-in-loop
      await projectService.recompute(projectId);
    }
    console.log(`Recomputed progress for ${projectIds.length} project(s).`);
  }

  return ghosts.length;
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING cleanup ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  await migrate();
}

main()
  .catch((err) => {
    console.error('✖ Cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
