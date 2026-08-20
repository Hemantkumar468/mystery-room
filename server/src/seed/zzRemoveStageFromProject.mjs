/* eslint-disable no-console */
/**
 * One-off (safe to delete): remove ONE stage from a project's snapshot after
 * that phase was dropped from the template, then bring stage names/order back
 * in line with the template.
 *
 * Guard rails, same as the earlier p4 removal:
 *   - refuses if the stage holds any records (filled forms are user data);
 *   - deletes only that stage's tasks;
 *   - repoints currentStageKey at the first not-completed stage.
 *
 *   node src/seed/zzRemoveStageFromProject.mjs <projectId> <stageKey>
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Record } from '../modules/pms/records/record.model.js';

const [id, stageKey] = process.argv.slice(2);

async function main() {
  if (!id || !stageKey) throw new Error('Usage: zzRemoveStageFromProject <projectId> <stageKey>');
  await connectDatabase();

  const project = await Project.findById(id);
  if (!project) throw new Error('Project not found.');
  const template = await Template.findOne({ code: 'MR-PMS-CLIENT-FLOW' }).lean();

  if (!project.stages.some((s) => s.key === stageKey)) {
    console.log(`"${project.name}": no ${stageKey} stage — nothing to do.`);
  } else {
    const recordCount = await Record.countDocuments({ project: id, stageKey });
    if (recordCount > 0) throw new Error(`${stageKey} holds ${recordCount} record(s) — refusing. Handle those first.`);
    project.stages = project.stages.filter((s) => s.key !== stageKey);
    const del = await Task.deleteMany({ project: id, stageKey });
    console.log(`"${project.name}": removed ${stageKey} (+${del.deletedCount} tasks)`);
  }

  // Names and order follow the template for the stages that survive, so the
  // renumbered display names ("Phase 6 — Procurement…") reach this project too.
  const tpl = Object.fromEntries((template?.stages || []).map((s) => [s.key, s]));
  for (const s of project.stages) {
    if (tpl[s.key]) {
      s.order = tpl[s.key].order;
      s.name = tpl[s.key].name;
    }
  }
  project.stages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const current = project.stages.find((s) => s.status !== 'completed');
  project.currentStageKey = current?.key || project.stages[0]?.key || null;

  project.markModified('stages');
  await project.save();

  console.log('  stages:', project.stages.map((s) => s.key).join(' '));
  console.log('  currentStageKey:', project.currentStageKey);
}

main()
  .catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
