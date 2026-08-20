import mongoose from 'mongoose';
import { Task } from '../tasks/task.model.js';
import { Project } from '../projects/project.model.js';
import { User } from '../../auth/auth.model.js';
import { DEPARTMENT_VALUES, PRIORITY_VALUES, TASK_STATUS } from '../../../core/constants/index.js';

const toId = (v) => new mongoose.Types.ObjectId(v);
const DAY_MS = 86_400_000;

/**
 * Gantt timeline.
 *
 * One endpoint feeds both scopes the client document asks for in §9.2 — the
 * portfolio view (every project on one timeline) and the single-project view
 * (its phases, optionally exploded to tasks). It is a server concern rather
 * than a client one because the portfolio view otherwise means fetching every
 * task of every project just to draw bars.
 *
 * Rows come back flat with a `parentId`, not nested. A Gantt draws one row per
 * line whatever the nesting, and a flat list is what both the renderer and the
 * CSV export want; the client rebuilds the tree from `parentId` when it needs
 * to collapse a group.
 *
 * ── On "actual" dates ─────────────────────────────────────────
 * A project stage stores `startedAt`/`completedAt`, not actualStart/actualEnd
 * (those live on tasks). A phase that has started but not finished therefore
 * has an open-ended actual bar; the client draws it to today rather than not
 * at all, since an in-flight phase with no visible bar is the one case a Gantt
 * must not have.
 */

/** Planned-vs-actual verdict for one row, in the words the MD reads. */
function timingOf({ plannedEnd, actualStart, actualEnd, status, now }) {
  const done = Boolean(actualEnd);
  const started = Boolean(actualStart);

  if (done && plannedEnd) {
    const diff = Math.round((new Date(actualEnd) - new Date(plannedEnd)) / DAY_MS);
    if (diff > 0) return { state: 'late', days: diff, label: `Finished ${diff}d late` };
    if (diff < 0) return { state: 'early', days: diff, label: `Finished ${-diff}d early` };
    return { state: 'ontime', days: 0, label: 'Finished on time' };
  }
  if (done) return { state: 'done', days: null, label: 'Completed' };

  if (plannedEnd) {
    const daysLeft = Math.round((new Date(plannedEnd) - now) / DAY_MS);
    if (daysLeft < 0) return { state: 'overdue', days: daysLeft, label: `Overdue by ${-daysLeft}d` };
    if (daysLeft === 0) return { state: 'due', days: 0, label: 'Due today' };
    // "At risk" means started and running tight. Not started but tight is still
    // on track — it has not consumed any of its window yet.
    const state = daysLeft <= 2 && started ? 'atrisk' : 'ontrack';
    return { state, days: daysLeft, label: `${daysLeft}d left` };
  }
  return { state: status === TASK_STATUS.DONE ? 'done' : 'nodate', days: null, label: 'No date set' };
}

/** Widen `range` to cover the given dates. */
function extend(range, ...dates) {
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (Number.isNaN(t)) continue;
    if (range.start === null || t < range.start) range.start = t;
    if (range.end === null || t > range.end) range.end = t;
  }
}

/** Smallest/largest of a stage field across a project's stages. */
const minOf = (stages, field) => stages.reduce(
  (min, s) => (s[field] && (!min || s[field] < min) ? s[field] : min),
  null,
);
const maxOf = (stages, field) => stages.reduce(
  (max, s) => (s[field] && (!max || s[field] > max) ? s[field] : max),
  null,
);

export const ganttService = {
  /**
   * @param scope.project  restrict to one project (required for `level: 'task'`)
   * @param scope.level    'phase' (default) or 'task'
   * @param scope.filters  { city, status, health, department, owner, priority,
   *                         stageKey, taskStatus, search }
   */
  async timeline(scope = {}) {
    const now = new Date();
    const f = scope.filters || {};
    const level = scope.level === 'task' && scope.project ? 'task' : 'phase';

    const projectFilter = {};
    if (scope.project) projectFilter._id = toId(scope.project);
    if (f.city) projectFilter.city = f.city;
    if (f.status) projectFilter.status = f.status;
    if (f.health) projectFilter.health = f.health;

    const projects = await Project.find(projectFilter)
      .select('name code city state status health progress stages owner')
      .populate('owner', 'name avatarColor')
      .sort({ createdAt: 1 });

    const range = { start: null, end: null };
    const rows = [];

    for (const p of projects) {
      const stages = [...(p.stages || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      const projectRowId = `project:${p._id}`;

      // A project header row earns its place only in the portfolio view. Inside
      // one project the phases are the top level, and a wrapper above them is a
      // line that says nothing the page title has not already said.
      if (!scope.project) {
        const pStart = minOf(stages, 'plannedStart');
        const pEnd = maxOf(stages, 'plannedEnd');
        const aStart = minOf(stages, 'startedAt');
        const allDone = stages.length > 0 && stages.every((s) => s.status === 'completed');
        const aEnd = allDone ? maxOf(stages, 'completedAt') : null;

        extend(range, pStart, pEnd, aStart, aEnd);
        rows.push({
          id: projectRowId,
          type: 'project',
          parentId: null,
          projectId: String(p._id),
          projectName: p.name,
          label: p.name,
          sublabel: [p.code, p.city].filter(Boolean).join(' · '),
          plannedStart: pStart,
          plannedEnd: pEnd,
          actualStart: aStart,
          actualEnd: aEnd,
          status: p.status,
          health: p.health,
          progress: p.progress ?? 0,
          owner: p.owner
            ? { id: String(p.owner._id), name: p.owner.name, avatarColor: p.owner.avatarColor }
            : null,
          timing: timingOf({ plannedEnd: pEnd, actualStart: aStart, actualEnd: aEnd, status: p.status, now }),
        });
      }

      for (const s of stages) {
        if (f.stageKey && s.key !== f.stageKey) continue;
        if (f.department && s.ownerDepartment !== f.department) continue;

        const aEnd = s.status === 'completed' ? s.completedAt : null;
        extend(range, s.plannedStart, s.plannedEnd, s.startedAt, aEnd);

        rows.push({
          id: `phase:${p._id}:${s.key}`,
          type: 'phase',
          parentId: scope.project ? null : projectRowId,
          projectId: String(p._id),
          projectName: p.name,
          stageKey: s.key,
          label: s.name,
          sublabel: s.ownerDepartment || '',
          plannedStart: s.plannedStart,
          plannedEnd: s.plannedEnd,
          actualStart: s.startedAt,
          actualEnd: aEnd,
          status: s.status,
          progress: s.progress ?? null,
          department: s.ownerDepartment || null,
          color: s.color || null,
          parallelGroup: s.parallelGroup || null,
          timing: timingOf({ plannedEnd: s.plannedEnd, actualStart: s.startedAt, actualEnd: aEnd, status: s.status, now }),
        });
      }
    }

    // Task rows are offered for a single project only. Every task of every
    // project on one canvas is thousands of rows nobody can read, and it is not
    // what a portfolio timeline is for.
    if (level === 'task') {
      const taskFilter = { project: toId(scope.project) };
      if (f.department) taskFilter.department = f.department;
      if (f.priority) taskFilter.priority = f.priority;
      if (f.owner) taskFilter.assignee = toId(f.owner);
      if (f.stageKey) taskFilter.stageKey = f.stageKey;
      if (f.taskStatus) taskFilter.status = f.taskStatus;
      if (f.search) {
        taskFilter.$or = [
          { title: new RegExp(f.search, 'i') },
          { code: new RegExp(f.search, 'i') },
        ];
      }

      const tasks = await Task.find(taskFilter)
        .select('title code stageKey department priority status plannedStart plannedEnd actualStart actualEnd assignee dependencies checklist')
        .populate('assignee', 'name avatarColor')
        .sort({ plannedStart: 1, createdAt: 1 });

      for (const t of tasks) {
        extend(range, t.plannedStart, t.plannedEnd, t.actualStart, t.actualEnd);
        const total = t.checklist?.length || 0;
        const doneItems = (t.checklist || []).filter((c) => c.done).length;

        rows.push({
          id: `task:${t._id}`,
          type: 'task',
          parentId: `phase:${scope.project}:${t.stageKey}`,
          projectId: String(scope.project),
          taskId: String(t._id),
          code: t.code,
          stageKey: t.stageKey,
          label: t.title,
          sublabel: t.code,
          plannedStart: t.plannedStart,
          plannedEnd: t.plannedEnd,
          actualStart: t.actualStart,
          actualEnd: t.actualEnd,
          status: t.status,
          priority: t.priority,
          department: t.department || null,
          progress: total
            ? Math.round((doneItems / total) * 100)
            : (t.status === TASK_STATUS.DONE ? 100 : 0),
          owner: t.assignee
            ? { id: String(t.assignee._id), name: t.assignee.name, avatarColor: t.assignee.avatarColor }
            : null,
          dependencies: (t.dependencies || []).map((d) => `task:${d}`),
          timing: timingOf({ plannedEnd: t.plannedEnd, actualStart: t.actualStart, actualEnd: t.actualEnd, status: t.status, now }),
        });
      }
    }

    return {
      generatedAt: now,
      scope: scope.project ? 'project' : 'portfolio',
      level,
      // A window containing no dated rows still needs an axis to draw, so it
      // falls back to a month around today rather than returning nulls that
      // every caller would have to guard separately.
      range: {
        start: range.start ? new Date(range.start) : new Date(now.getTime() - 15 * DAY_MS),
        end: range.end ? new Date(range.end) : new Date(now.getTime() + 15 * DAY_MS),
      },
      rows,
      facets: await this.facets(scope.project),
    };
  },

  /**
   * Filter options built from what is actually present rather than from the
   * enums — a department with no work in it is a filter that can only ever
   * return an empty chart.
   */
  async facets(projectId) {
    const projectFilter = projectId ? { _id: toId(projectId) } : {};
    const taskFilter = projectId ? { project: toId(projectId) } : {};

    const [projects, cities, departments, priorities, assigneeIds, statuses] = await Promise.all([
      Project.find(projectFilter).select('name code city stages').sort({ name: 1 }),
      Project.distinct('city', projectFilter),
      Task.distinct('department', taskFilter),
      Task.distinct('priority', taskFilter),
      Task.distinct('assignee', { ...taskFilter, assignee: { $ne: null } }),
      Task.distinct('status', taskFilter),
    ]);

    const owners = await User.find({ _id: { $in: assigneeIds } })
      .select('name avatarColor')
      .sort({ name: 1 });

    // Phases come from the projects in scope, deduped by key — a portfolio can
    // hold projects built on different templates.
    const phaseMap = new Map();
    for (const p of projects) {
      for (const s of p.stages || []) if (!phaseMap.has(s.key)) phaseMap.set(s.key, s.name);
    }

    return {
      projects: projects.map((p) => ({
        id: String(p._id), name: p.name, code: p.code, city: p.city,
      })),
      cities: cities.filter(Boolean).sort(),
      departments: DEPARTMENT_VALUES.filter((d) => departments.includes(d)),
      priorities: PRIORITY_VALUES.filter((p) => priorities.includes(p)),
      taskStatuses: statuses.filter(Boolean).sort(),
      owners: owners.map((u) => ({ id: String(u._id), name: u.name, avatarColor: u.avatarColor })),
      phases: [...phaseMap].map(([key, name]) => ({ key, name })),
    };
  },
};

export default ganttService;
