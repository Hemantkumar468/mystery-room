/* eslint-disable no-console */
/**
 * One-off (safe to delete): bring an existing client-flow project's snapshot in
 * line with the current template — remove the dropped Phase 0 (p4), add the
 * Phase 3B Project Planning stage (p20) it predates, and renumber stage order
 * to the template's.
 *
 * Snapshots deliberately never follow template edits; this script is the
 * explicit, per-project opt-in. Guard rails:
 *   - refuses to drop p4 if it holds any records (filled forms are user data);
 *   - skips p20 if the project already has it;
 *   - new task codes continue from the project's highest existing number.
 *
 *   node src/seed/zzSyncProjectPhases.mjs <projectId>
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Record } from '../modules/pms/records/record.model.js';

const id = process.argv[2];

async function main() {
  if (!id) throw new Error('Pass a project id.');
  await connectDatabase();

  const project = await Project.findById(id);
  if (!project) throw new Error('Project not found.');
  const template = await Template.findOne({ code: 'MR-PMS-CLIENT-FLOW' }).lean();
  if (!template) throw new Error('Client flow template not found.');

  const report = [];

  /* ── 1. Drop Phase 0 (p4) ────────────────────────────────────────── */
  if (project.stages.some((s) => s.key === 'p4')) {
    const recordCount = await Record.countDocuments({ project: id, stageKey: 'p4' });
    if (recordCount > 0) throw new Error(`p4 holds ${recordCount} record(s) — refusing. Handle those first.`);
    project.stages = project.stages.filter((s) => s.key !== 'p4');
    const del = await Task.deleteMany({ project: id, stageKey: 'p4' });
    report.push(`removed p4 (+${del.deletedCount} tasks)`);
  } else {
    report.push('p4 already absent');
  }

  /* ── 2. Add Phase 3B (p20) ───────────────────────────────────────── */
  const tplP20 = template.stages.find((s) => s.key === 'p20');
  if (!tplP20) throw new Error('Template has no p20 — refresh the template first.');

  if (!project.stages.some((s) => s.key === 'p20')) {
    // Schedule it where it lives: after Commercial Closure. If p3 has already
    // finished, planning starts now rather than in the past.
    const p3 = project.stages.find((s) => s.key === 'p3');
    const start = dayjs(p3?.completedAt || p3?.plannedEnd || new Date());
    const end = start.add(tplP20.slaDays || 3, 'day');

    project.stages.push({
      key: tplP20.key,
      name: tplP20.name,
      color: tplP20.color,
      slaDays: tplP20.slaDays,
      ownerDepartment: tplP20.ownerDepartment,
      whatWhoWhenHow: tplP20.whatWhoWhenHow || [],
      parallelGroup: tplP20.parallelGroup,
      gate: tplP20.gate,
      exitCriteria: tplP20.exitCriteria,
      captureMode: tplP20.captureMode || 'single',
      recordNoun: tplP20.recordNoun || 'Record',
      status: 'not_started',
      plannedStart: start.toDate(),
      plannedEnd: end.toDate(),
    });

    // Its three tasks, coded after the project's current highest task number
    // so codes stay unique within the project.
    const existing = await Task.find({ project: id }).select('code').lean();
    let maxN = 0;
    for (const t of existing) {
      const m = /-T(\d+)$/.exec(t.code || '');
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    const docs = [];
    let cursor = start;
    for (const [i, task] of [...(tplP20.tasks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).entries()) {
      const plannedStart = cursor.toDate();
      const plannedEnd = cursor.add(task.estimatedDays || 1, 'day').toDate();
      cursor = dayjs(plannedEnd);
      maxN += 1;
      docs.push({
        project: project._id,
        code: `${project.code}-T${String(maxN).padStart(3, '0')}`,
        templateTaskKey: task.key,
        stageKey: 'p20',
        stageName: tplP20.name,
        title: task.title,
        description: task.description,
        brief: task.brief,
        formKey: task.formKey,
        priority: task.priority,
        department: task.department || tplP20.ownerDepartment,
        assignees: task.assignees || [],
        primaryAssignee: task.primaryAssignee || null,
        backupAssignee: task.backupAssignee || null,
        estimatedHours: (task.estimatedDays || 1) * 8,
        plannedStart,
        plannedEnd,
        order: task.order ?? i,
        checklist: (task.checklist || []).map((c) => ({ label: c.label, required: c.required })),
        createdBy: project.createdBy,
      });
    }
    if (docs.length) await Task.insertMany(docs);
    report.push(`added p20 (+${docs.length} tasks, ${docs.map((d) => d.code).join(', ')})`);
  } else {
    report.push('p20 already present');
  }

  /* ── 3. Renumber to the template's order ─────────────────────────── */
  const orderOf = Object.fromEntries(template.stages.map((s) => [s.key, s.order]));
  for (const s of project.stages) {
    if (orderOf[s.key] !== undefined) s.order = orderOf[s.key];
  }
  project.stages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Current stage = first not-completed in the new order (the removed p4 may
  // have been pointed at; the inserted p20 may now genuinely be next).
  const current = project.stages.find((s) => s.status !== 'completed');
  project.currentStageKey = current?.key || project.stages[0]?.key || null;

  project.markModified('stages');
  await project.save();

  console.log(`"${project.name}":`);
  for (const r of report) console.log('  -', r);
  console.log('  - stages now:', project.stages.map((s) => s.key).join(' '));
  console.log('  - currentStageKey:', project.currentStageKey);
}

main()
  .catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
