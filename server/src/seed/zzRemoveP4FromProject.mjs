/* eslint-disable no-console */
/**
 * One-off (safe to delete): remove the Phase 0 / p4 stage from a single
 * project's snapshot, after the phase was dropped from the template.
 *
 * A project snapshots its template at creation, so dropping a phase from the
 * template deliberately does NOT touch existing projects — this script is the
 * explicit, per-project version of that decision. It only runs against ids
 * passed on the command line, and refuses if the stage holds any records.
 *
 *   node src/seed/zzRemoveP4FromProject.mjs <projectId>
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Record } from '../modules/pms/records/record.model.js';

const id = process.argv[2];

async function main() {
  if (!id) throw new Error('Pass a project id.');
  await connectDatabase();

  const p = await Project.findById(id);
  if (!p) throw new Error('Project not found.');

  const p4 = p.stages.find((s) => s.key === 'p4');
  if (!p4) { console.log(`"${p.name}": no p4 stage — nothing to do.`); return; }

  // Filled-in records are user data; deleting them needs a human decision,
  // not a cleanup script's.
  const recordCount = await Record.countDocuments({ project: id, stageKey: 'p4' });
  if (recordCount > 0) {
    throw new Error(`p4 holds ${recordCount} record(s) — refusing to remove it. Handle those first.`);
  }

  const before = p.stages.length;
  p.stages = p.stages.filter((s) => s.key !== 'p4');

  // The removed stage may be the current one — hand off to the first remaining
  // stage in order so nothing points at a phase that no longer exists.
  if (p.currentStageKey === 'p4') {
    const first = [...p.stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    p.currentStageKey = first?.key || null;
  }
  p.markModified('stages');
  await p.save();

  const del = await Task.deleteMany({ project: id, stageKey: 'p4' });

  const check = await Project.findById(id).select('stages.key currentStageKey');
  console.log(`"${p.name}": stages ${before} -> ${check.stages.length}, currentStageKey: ${check.currentStageKey}, tasks removed: ${del.deletedCount}`);
  console.log('p4 still present:', check.stages.some((s) => s.key === 'p4'));
}

main()
  .catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
