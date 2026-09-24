/* eslint-disable no-console */
/**
 * Scratch verification (safe to delete): proves the autoAssignTasks cascade
 * produces the plan the client expects, WITHOUT touching the database.
 *
 * Replays materializeFromTemplate + cascadeTasksFromTemplate's arithmetic on a
 * plain object, so it can run offline and can never write.
 */
import dayjs from 'dayjs';
import { clientFlowTemplate } from './clientFlowTemplate.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

function materialize(template, startDate) {
  const stages = [];
  let cursor = dayjs(startDate);
  let groupKey = null;
  let groupStart = null;

  for (const stage of [...template.stages].sort((a, b) => a.order - b.order)) {
    const cont = Boolean(stage.parallelGroup) && stage.parallelGroup === groupKey;
    const start = cont ? groupStart : cursor;
    const end = start.add(stage.slaDays || 7, 'day');
    stages.push({ key: stage.key, name: stage.name, plannedStart: start.toDate() });
    if (cont) cursor = end.isAfter(cursor) ? end : cursor;
    else { groupKey = stage.parallelGroup || null; groupStart = start; cursor = end; }
  }
  return stages;
}

function cascade(template, stages, code) {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const tasks = [];
  for (const stage of [...template.stages].sort((a, b) => a.order - b.order)) {
    if (stage.manualTasksOnly) continue;
    const live = byKey.get(stage.key);
    if (!live) continue;
    let cursor = dayjs(live.plannedStart);
    for (const [i, task] of [...(stage.tasks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).entries()) {
      const plannedStart = cursor.toDate();
      const plannedEnd = cursor.add(task.estimatedDays || 1, 'day').toDate();
      cursor = dayjs(plannedEnd);
      tasks.push({
        code: `${code}-T${String(tasks.length + 1).padStart(3, '0')}`,
        stageKey: stage.key,
        stageName: stage.name,
        title: task.title,
        department: task.department || stage.ownerDepartment,
        primaryAssignee: task.primaryAssignee || null,
        backupAssignee: task.backupAssignee || null,
        reassignNeeded: task.primaryAssigneeUnavailable === true && Boolean(task.primaryAssignee),
        checklist: task.checklist || [],
        plannedStart,
        plannedEnd,
        order: task.order ?? i,
      });
    }
  }
  return tasks;
}

const stages = materialize(clientFlowTemplate, '2026-09-01');
const tasks = cascade(clientFlowTemplate, stages, 'MR-PUN-001');

console.log(`autoAssignTasks: ${clientFlowTemplate.autoAssignTasks}  (legacy template: ${storeLaunchTemplate.autoAssignTasks ?? false})`);
console.log(`\n${tasks.length} tasks generated from one "New Project" form.\n`);

const noOwner = tasks.filter((t) => !t.primaryAssignee);
const noBuddy = tasks.filter((t) => !t.backupAssignee);
const noDept = tasks.filter((t) => !t.department);
const noDates = tasks.filter((t) => !t.plannedStart || !t.plannedEnd);
const flagged = tasks.filter((t) => t.reassignNeeded);
const withChecklist = tasks.filter((t) => t.checklist.length);

console.log(`  owner (who) set ........ ${tasks.length - noOwner.length}/${tasks.length}`);
console.log(`  buddy set .............. ${tasks.length - noBuddy.length}/${tasks.length}`);
console.log(`  department set ......... ${tasks.length - noDept.length}/${tasks.length}`);
console.log(`  planned dates set ...... ${tasks.length - noDates.length}/${tasks.length}`);
console.log(`  has a checklist ........ ${withChecklist.length}/${tasks.length}`);
console.log(`  primary unavailable → buddy surfaced: ${flagged.length}`);

const codes = new Set(tasks.map((t) => t.code));
console.log(`  unique task codes ...... ${codes.size}/${tasks.length}`);

console.log('\nper phase:');
for (const s of stages) {
  const n = tasks.filter((t) => t.stageKey === s.key).length;
  console.log(`  ${String(n).padStart(3)}  ${s.name}`);
}

console.log('\nsample — what a doer would see in My Tasks:');
for (const t of tasks.slice(0, 4)) {
  console.log(`  ${t.code}  ${t.title}`);
  console.log(`        who: ${t.primaryAssignee} (buddy ${t.backupAssignee})  dept: ${t.department}`);
  console.log(`        when: ${dayjs(t.plannedStart).format('DD MMM')} → ${dayjs(t.plannedEnd).format('DD MMM')}  checklist: ${t.checklist.length} items`);
}

const problems = noOwner.length + noDept.length + noDates.length + (codes.size !== tasks.length ? 1 : 0);
console.log(problems ? `\n${problems} PROBLEM(S)` : '\nevery task has who, department, dates and a unique code');
