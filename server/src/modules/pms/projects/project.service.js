import dayjs from 'dayjs';
import { Project } from './project.model.js';
import { Template } from '../templates/template.model.js';
import { Task } from '../tasks/task.model.js';
import { activityService } from '../activity/activity.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';
import {
  PROJECT_STATUS,
  PROJECT_HEALTH,
  STAGE_STATUS,
  TASK_STATUS,
  ACTIVITY_ACTIONS,
} from '../../../core/constants/index.js';

/** Build a city-scoped human code, e.g. MR-PUN-003. */
async function generateProjectCode(city) {
  const cityCode = city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const count = await Project.countDocuments({ city });
  return `MR-${cityCode}-${String(count + 1).padStart(3, '0')}`;
}

/**
 * Instantiate a template into concrete project stages + task documents,
 * cascading a realistic planned timeline from the project start date.
 */
async function materializeFromTemplate(template, project) {
  const stages = [];
  const taskDocs = [];
  let cursor = dayjs(project.plannedStartDate);

  const orderedStages = [...template.stages].sort((a, b) => a.order - b.order);

  orderedStages.forEach((stage, stageIdx) => {
    const stagePlannedStart = cursor.toDate();
    const stagePlannedEnd = cursor.add(stage.slaDays || 7, 'day').toDate();

    stages.push({
      key: stage.key,
      name: stage.name,
      order: stage.order ?? stageIdx,
      color: stage.color,
      slaDays: stage.slaDays,
      ownerDepartment: stage.ownerDepartment,
      status: STAGE_STATUS.NOT_STARTED,
      plannedStart: stagePlannedStart,
      plannedEnd: stagePlannedEnd,
    });

    // Cascade tasks sequentially inside the stage window.
    let taskCursor = dayjs(stagePlannedStart);
    const orderedTasks = [...(stage.tasks || [])].sort((a, b) => a.order - b.order);
    orderedTasks.forEach((task, taskIdx) => {
      const plannedStart = taskCursor.toDate();
      const plannedEnd = taskCursor.add(task.estimatedDays || 1, 'day').toDate();
      taskCursor = dayjs(plannedEnd);

      taskDocs.push({
        project: project._id,
        code: `${project.code}-T${String(taskDocs.length + 1).padStart(3, '0')}`,
        templateTaskKey: task.key,
        stageKey: stage.key,
        stageName: stage.name,
        title: task.title,
        description: task.description,
        priority: task.priority,
        department: task.department || stage.ownerDepartment,
        estimatedHours: (task.estimatedDays || 1) * 8,
        plannedStart,
        plannedEnd,
        order: task.order ?? taskIdx,
        checklist: (task.checklist || []).map((c) => ({ label: c.label, required: c.required })),
        createdBy: project.createdBy,
      });
    });

    cursor = dayjs(stagePlannedEnd);
  });

  project.stages = stages;
  project.targetEndDate = project.targetEndDate || cursor.toDate();
  project.currentStageKey = stages[0]?.key;

  await project.save();
  if (taskDocs.length) await Task.insertMany(taskDocs);
  return project;
}

export const projectService = {
  async list(query = {}) {
    const { page, limit, skip } = getPagination(query);
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.health) filter.health = query.health;
    if (query.city) filter.city = query.city;
    if (query.owner) filter.owner = query.owner;
    if (query.search) filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
    ];

    const [items, total] = await Promise.all([
      Project.find(filter)
        .sort(parseSort(query.sort))
        .skip(skip)
        .limit(limit)
        .populate('owner', 'name role avatarColor')
        .populate('members', 'name role avatarColor'),
      Project.countDocuments(filter),
    ]);
    return { items, meta: buildMeta({ page, limit, total }) };
  },

  async getById(id) {
    const project = await Project.findById(id)
      .populate('owner', 'name role avatarColor title')
      .populate('members', 'name role avatarColor title')
      .populate('template.ref', 'name code');
    if (!project) throw ApiError.notFound('Project not found');
    return project;
  },

  async create(data, userId) {
    const template = await Template.findById(data.templateId);
    if (!template) throw ApiError.notFound('Template not found');

    const code = data.code || (await generateProjectCode(data.city));
    const project = new Project({
      name: data.name,
      code,
      description: data.description,
      template: { ref: template._id, name: template.name, version: template.version },
      city: data.city,
      address: data.address,
      areaSqft: data.areaSqft,
      priority: data.priority,
      owner: data.owner,
      members: data.members || [],
      plannedStartDate: data.plannedStartDate,
      targetEndDate: data.targetEndDate,
      budget: data.budget,
      broker: data.broker,
      tags: data.tags || [],
      status: PROJECT_STATUS.PLANNING,
      createdBy: userId,
    });

    await materializeFromTemplate(template, project);
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: userId,
      message: `Project "${project.name}" created from template "${template.name}"`,
    });
    return this.getById(project._id);
  },

  async update(id, data, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    const editable = [
      'name', 'description', 'address', 'areaSqft', 'status', 'priority',
      'owner', 'members', 'targetEndDate', 'budget', 'broker', 'tags',
    ];
    for (const key of editable) if (data[key] !== undefined) project[key] = data[key];
    await project.save();
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `Project "${project.name}" updated`,
    });
    return this.getById(id);
  },

  /** Save master data captured for a stage (merged, not replaced). */
  async updateMasterData(id, stageKey, values, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    if (!project.stages.some((s) => s.key === stageKey)) {
      throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);
    }
    const merged = { ...(project.masterData || {}) };
    merged[stageKey] = { ...(merged[stageKey] || {}), ...values };
    project.masterData = merged;
    project.markModified('masterData');
    await project.save();
    await activityService.log({
      project: project._id,
      entityType: 'stage',
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `Master data updated for stage "${stageKey}"`,
      meta: { stageKey },
    });
    return this.getById(id);
  },

  /**
   * Recompute stage statuses, progress %, current stage and health from the
   * project's live tasks. Called after any task mutation.
   */
  async recompute(projectId) {
    const project = await Project.findById(projectId);
    if (!project) return null;

    const tasks = await Task.find({ project: projectId }).select(
      'stageKey status plannedEnd actualStart',
    );
    const total = tasks.length;
    const doneCount = tasks.filter((t) => t.status === TASK_STATUS.DONE).length;
    const now = new Date();
    const overdue = tasks.filter(
      (t) => t.status !== TASK_STATUS.DONE && t.plannedEnd && t.plannedEnd < now,
    ).length;

    // Per-stage rollup.
    for (const stage of project.stages) {
      const stageTasks = tasks.filter((t) => t.stageKey === stage.key);
      if (!stageTasks.length) continue;
      const allDone = stageTasks.every((t) => t.status === TASK_STATUS.DONE);
      const anyBlocked = stageTasks.some((t) => t.status === TASK_STATUS.BLOCKED);
      const anyActive = stageTasks.some((t) => t.status !== TASK_STATUS.TODO);

      if (allDone) {
        stage.status = STAGE_STATUS.COMPLETED;
        stage.completedAt = stage.completedAt || now;
        stage.startedAt = stage.startedAt || now;
      } else if (anyBlocked) {
        stage.status = STAGE_STATUS.BLOCKED;
        stage.startedAt = stage.startedAt || now;
      } else if (anyActive) {
        stage.status = STAGE_STATUS.IN_PROGRESS;
        stage.startedAt = stage.startedAt || now;
      } else {
        stage.status = STAGE_STATUS.NOT_STARTED;
      }
    }

    project.progress = total ? Math.round((doneCount / total) * 100) : 0;

    const currentStage = [...project.stages]
      .sort((a, b) => a.order - b.order)
      .find((s) => s.status !== STAGE_STATUS.COMPLETED);
    project.currentStageKey = currentStage?.key || project.stages.at(-1)?.key;

    // Lifecycle + health.
    if (project.progress === 100) {
      project.status = PROJECT_STATUS.COMPLETED;
      project.health = PROJECT_HEALTH.ON_TRACK;
      project.actualEndDate = project.actualEndDate || now;
    } else {
      if (project.status === PROJECT_STATUS.PLANNING && doneCount + overdue > 0) {
        project.status = PROJECT_STATUS.ACTIVE;
        project.actualStartDate = project.actualStartDate || now;
      }
      const pastDeadline = project.targetEndDate && project.targetEndDate < now;
      if (pastDeadline) project.health = PROJECT_HEALTH.DELAYED;
      else if (overdue > 0) project.health = PROJECT_HEALTH.AT_RISK;
      else project.health = PROJECT_HEALTH.ON_TRACK;
    }

    await project.save();
    return project;
  },

  async remove(id) {
    const project = await Project.findByIdAndDelete(id);
    if (!project) throw ApiError.notFound('Project not found');
    await Task.deleteMany({ project: id });
    return project;
  },
};

export default projectService;
