import { Record } from './record.model.js';
import { Project } from '../projects/project.model.js';
import { activityService } from '../activity/activity.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import {
  ACTIVITY_ACTIONS,
  RECORD_STATUS,
  RECORD_DECISION,
  STAGE_CAPTURE_MODE,
} from '../../../core/constants/index.js';

/** Pick a sensible row title from the dynamic answers. */
function deriveTitle(values = {}) {
  const preferred = values.property_name || values.name || values.title;
  if (preferred) return String(preferred);
  const firstText = Object.values(values).find(
    (v) => typeof v === 'string' && v.trim() !== '',
  );
  return firstText ? String(firstText) : 'Untitled record';
}

/** Load the project and assert the stage exists and accepts collection rows. */
async function assertCollectionStage(projectId, stageKey) {
  const project = await Project.findById(projectId).select('stages name');
  if (!project) throw ApiError.notFound('Project not found');
  const stage = project.stages.find((s) => s.key === stageKey);
  if (!stage) throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);
  if (stage.captureMode !== STAGE_CAPTURE_MODE.COLLECTION) {
    throw ApiError.badRequest(`Stage "${stageKey}" does not capture multiple records`);
  }
  return { project, stage };
}

export const recordService = {
  async list({ projectId, stageKey, status }) {
    const filter = { project: projectId };
    if (stageKey) filter.stageKey = stageKey;
    if (status) filter.status = status;
    return Record.find(filter)
      .sort({ createdAt: 1 })
      .populate('createdBy', 'name role avatarColor')
      .populate('decidedBy', 'name role avatarColor');
  },

  async getById(id) {
    const record = await Record.findById(id)
      .populate('createdBy', 'name role avatarColor title')
      .populate('decidedBy', 'name role avatarColor title');
    if (!record) throw ApiError.notFound('Record not found');
    return record;
  },

  async create(data, userId) {
    const { stage } = await assertCollectionStage(data.projectId, data.stageKey);

    const record = await Record.create({
      project: data.projectId,
      stageKey: data.stageKey,
      title: data.title || deriveTitle(data.values),
      values: data.values || {},
      status: data.status || RECORD_STATUS.SUBMITTED,
      attachments: data.attachments || [],
      createdBy: userId,
    });

    await activityService.log({
      project: data.projectId,
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: userId,
      message: `${stage.recordNoun || 'Record'} "${record.title}" added to "${stage.name}"`,
      meta: { stageKey: data.stageKey },
    });

    return this.getById(record._id);
  },

  async update(id, data, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');

    if (data.values !== undefined) {
      record.values = data.values;
      record.markModified('values');
    }
    if (data.attachments !== undefined) record.attachments = data.attachments;
    if (data.status !== undefined) record.status = data.status;
    record.title = data.title || deriveTitle(record.values);

    await record.save();
    await activityService.log({
      project: record.project,
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `Record "${record.title}" updated`,
      meta: { stageKey: record.stageKey },
    });
    return this.getById(record._id);
  },

  /** Apply a manager decision (shortlist/reject/approve/lock) — the funnel gate. */
  async decide(id, decision, reason, userId) {
    const nextStatus = RECORD_DECISION[decision];
    if (!nextStatus) throw ApiError.badRequest(`Unknown decision "${decision}"`);

    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');

    record.status = nextStatus;
    record.decidedBy = userId;
    record.decidedAt = new Date();
    record.decisionReason = reason || undefined;
    await record.save();

    await activityService.log({
      project: record.project,
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.STATUS_CHANGED,
      actor: userId,
      message: `Record "${record.title}" marked ${nextStatus}${reason ? ` — ${reason}` : ''}`,
      meta: { stageKey: record.stageKey, decision, status: nextStatus },
    });
    return this.getById(record._id);
  },

  /** Revert a decision back to `submitted`. */
  async undoDecision(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');

    record.status = RECORD_STATUS.SUBMITTED;
    record.decidedBy = undefined;
    record.decidedAt = undefined;
    record.decisionReason = undefined;
    await record.save();

    await activityService.log({
      project: record.project,
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.STATUS_CHANGED,
      actor: userId,
      message: `Decision on record "${record.title}" reverted to submitted`,
      meta: { stageKey: record.stageKey },
    });
    return this.getById(record._id);
  },

  async remove(id, userId) {
    const record = await Record.findByIdAndDelete(id);
    if (!record) throw ApiError.notFound('Record not found');
    await activityService.log({
      project: record.project,
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.DELETED,
      actor: userId,
      message: `Record "${record.title}" removed`,
      meta: { stageKey: record.stageKey },
    });
    return record;
  },
};

export default recordService;
