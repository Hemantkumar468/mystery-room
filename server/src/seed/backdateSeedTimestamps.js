/* eslint-disable no-console */
/**
 * One-off repair for seedEnterpriseDemo.js's backdating: Record/Activity
 * schemas use `{ timestamps: true }`, and Mongoose silently strips
 * `createdAt` from any `Model.updateOne({...}, {$set:{createdAt}})` (it
 * treats createdAt as set-once) while force-overwriting `updatedAt` to the
 * real current time regardless of what was passed in. The original seed run
 * called exactly that pattern, so every Record/Activity it created ended up
 * stamped with the real wall-clock moment the script ran instead of a
 * realistic historical date — even though `Project.stages[].plannedStart/
 * plannedEnd/completedAt` (a different field, untouched by this bug) came out
 * correct, which is why the Stage Plan panel already looked right.
 *
 * This script re-derives realistic per-record/activity dates from each
 * project's own (already-correct) stage windows and writes them via the raw
 * MongoDB collection (`Model.collection.updateOne`, bypassing Mongoose's
 * timestamps middleware entirely — the only way to actually move createdAt).
 *
 * Also fixes one specific artifact: an earlier one-off patch
 * (projectService.completeStage for p1) stamped `stages.p1.completedAt` at
 * the real time it ran (today), landing chronologically after p2-p9 in the
 * Stage Plan. This script realigns it to p1's own plannedEnd.
 *
 * SAFE BY DEFAULT: dry run, writes nothing. Pass --apply to persist.
 *   node src/seed/backdateSeedTimestamps.js
 *   node src/seed/backdateSeedTimestamps.js --apply
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { Activity } from '../modules/pms/activity/activity.model.js';

const CODE_PREFIX = 'SEED-';
const APPLY = process.argv.includes('--apply');
const NOW = new Date();
const CONCURRENCY = 8;

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function addDays(date, days) {
  return dayjs(date).add(days, 'day').toDate();
}
function clampDate(d, lo, hi) {
  if (d.getTime() < lo.getTime()) return lo;
  if (d.getTime() > hi.getTime()) return hi;
  return d;
}

function scheduleActivitySync(recordId, createdDate, decidedDate, activitiesByEntity, activityOps) {
  const matches = activitiesByEntity.get(String(recordId));
  if (!matches || !matches.length) return;
  activityOps.push({ updateOne: { filter: { _id: matches[0]._id }, update: { $set: { createdAt: createdDate } } } });
  if (matches.length > 1) {
    const d = decidedDate || addDays(createdDate, 1);
    activityOps.push({ updateOne: { filter: { _id: matches[1]._id }, update: { $set: { createdAt: d } } } });
  }
}

async function backdateProject(project) {
  const stageMap = {};
  for (const s of project.stages || []) stageMap[s.key] = s;

  const recordOps = [];
  const activityOps = [];
  const projectOps = [];

  // Fix the p1-completedAt-stamped-today artifact from the earlier one-off patch.
  const p1Stage = stageMap.p1;
  if (p1Stage && p1Stage.status === 'completed') {
    const fixedP1Completed = p1Stage.plannedEnd || p1Stage.plannedStart || project.plannedStartDate;
    projectOps.push({
      updateOne: {
        filter: { _id: project._id, 'stages.key': 'p1' },
        update: { $set: { 'stages.$.completedAt': fixedP1Completed } },
      },
    });
    stageMap.p1 = { ...p1Stage, completedAt: fixedP1Completed };
  }

  const [records, activities] = await Promise.all([
    Record.find({ project: project._id }).sort({ createdAt: 1 }).lean(),
    Activity.find({ project: project._id }).sort({ createdAt: 1 }).lean(),
  ]);

  const activitiesByEntity = new Map();
  for (const a of activities) {
    if (!a.entityId) continue;
    const key = String(a.entityId);
    if (!activitiesByEntity.has(key)) activitiesByEntity.set(key, []);
    activitiesByEntity.get(key).push(a);
  }

  // Sync stage-completion marker activities (both the record.service.js
  // decision-gate one, entityType 'record', and project.service.js's
  // completeStage one, entityType 'stage') to their stage's real completedAt.
  for (const act of activities) {
    const sKey = act.meta?.stageKey;
    if (act.action === 'completed' && sKey && stageMap[sKey]?.completedAt) {
      activityOps.push({ updateOne: { filter: { _id: act._id }, update: { $set: { createdAt: stageMap[sKey].completedAt } } } });
    }
  }

  const p1Record = records.find((r) => r.stageKey === 'p1');
  if (p1Record) {
    const winStart = p1Stage?.plannedStart || project.plannedStartDate;
    const winEnd = p1Stage?.completedAt || p1Stage?.plannedEnd || addDays(winStart, 10);
    const created = clampDate(addDays(winStart, rand(0, 2)), winStart, winEnd);
    const set = { createdAt: created, updatedAt: created };
    if (p1Record.submittedAt) set.submittedAt = created;
    recordOps.push({ updateOne: { filter: { _id: p1Record._id }, update: { $set: set } } });

    let decided = null;
    if (p1Record.shortlistedAt || p1Record.decidedAt) {
      decided = clampDate(addDays(created, rand(1, 4)), created, winEnd);
      const dset = { decidedAt: decided, updatedAt: decided };
      if (p1Record.shortlistedAt) dset.shortlistedAt = decided;
      recordOps.push({ updateOne: { filter: { _id: p1Record._id }, update: { $set: dset } } });
    }
    scheduleActivitySync(p1Record._id, created, decided, activitiesByEntity, activityOps);
  }

  const byStage = {};
  for (const r of records) {
    if (r.stageKey === 'p1') continue;
    (byStage[r.stageKey] = byStage[r.stageKey] || []).push(r);
  }

  for (const stageKey of Object.keys(byStage)) {
    const stage = stageMap[stageKey];
    if (!stage) continue;
    const winStart = stage.plannedStart || project.plannedStartDate;
    const winEndRaw = stage.completedAt || stage.plannedEnd || addDays(winStart, 10);
    const cappedEnd = stage.status === 'completed' ? winEndRaw : (NOW.getTime() < winEndRaw.getTime() ? NOW : winEndRaw);
    const winEnd = clampDate(cappedEnd, winStart, cappedEnd.getTime() < winStart.getTime() ? winStart : cappedEnd);
    const group = byStage[stageKey];
    const n = group.length;

    group.forEach((r, i) => {
      const frac = (i + 1) / (n + 1);
      const span = Math.max(0, winEnd.getTime() - winStart.getTime());
      const base = new Date(winStart.getTime() + span * frac * 0.7);
      const created = clampDate(addDays(base, rand(-1, 1)), winStart, winEnd);
      const set = { createdAt: created, updatedAt: created };
      if (r.submittedAt) set.submittedAt = created;
      recordOps.push({ updateOne: { filter: { _id: r._id }, update: { $set: set } } });

      let decided = null;
      if (r.decidedAt) {
        decided = clampDate(addDays(created, rand(1, 5)), created, winEnd);
        const dset = { decidedAt: decided, updatedAt: decided };
        if (r.approvedAt) dset.approvedAt = decided;
        if (r.rejectedAt) dset.rejectedAt = decided;
        recordOps.push({ updateOne: { filter: { _id: r._id }, update: { $set: dset } } });
      }
      scheduleActivitySync(r._id, created, decided, activitiesByEntity, activityOps);
    });
  }

  if (APPLY) {
    if (recordOps.length) await Record.collection.bulkWrite(recordOps, { ordered: false });
    if (activityOps.length) await Activity.collection.bulkWrite(activityOps, { ordered: false });
    if (projectOps.length) await Project.collection.bulkWrite(projectOps, { ordered: false });
  }

  return { records: recordOps.length, activities: activityOps.length, projectStages: projectOps.length };
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING backdate repair ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const projects = await Project.find({ code: new RegExp(`^${CODE_PREFIX}`) }).lean();
  console.log(`Found ${projects.length} seeded project(s).`);

  let totalRecordOps = 0;
  let totalActivityOps = 0;
  let totalStageFixes = 0;
  let done = 0;

  for (let i = 0; i < projects.length; i += CONCURRENCY) {
    const batch = projects.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      batch.map((p) =>
        backdateProject(p)
          .then((r) => {
            done += 1;
            totalRecordOps += r.records;
            totalActivityOps += r.activities;
            totalStageFixes += r.projectStages;
            console.log(`${String(done).padStart(3)}/${projects.length}  ${p.code.padEnd(14)} records:${r.records} activities:${r.activities}`);
            return r;
          })
          .catch((err) => {
            done += 1;
            console.error(`${String(done).padStart(3)}/${projects.length}  FAILED (${p.code}): ${err.message}`);
            return null;
          }),
      ),
    );
    void results;
  }

  console.log(`\n${APPLY ? '✅ Applied' : '🔎 Would apply'} — Record ops: ${totalRecordOps}, Activity ops: ${totalActivityOps}, p1-stage fixes: ${totalStageFixes}`);
}

main()
  .catch((err) => {
    console.error('✖ Backdate repair failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
