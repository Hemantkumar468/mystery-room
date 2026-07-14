import { Record } from './record.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { activityService } from '../activity/activity.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { RECORD_STATUS, ACTIVITY_ACTIONS } from '../../../core/constants/index.js';
import {
  uploadBuffer,
  destroyAsset,
  isCloudinaryConfigured,
} from '../../../config/cloudinary.js';

const DECISION_MAP = {
  shortlist: RECORD_STATUS.SHORTLISTED,
  reject: RECORD_STATUS.REJECTED,
  approve: RECORD_STATUS.APPROVED,
  lock: RECORD_STATUS.LOCKED,
};

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** Compact reference for activity messages, e.g. `#3 "Title"`. */
const labelOf = (r) => (r.seq ? `#${r.seq} "${r.title}"` : `"${r.title}"`);

/**
 * Load the stage + its master-data schema (which lives on the template). When
 * `assessmentType` is given, the schema instead comes from that entry in the
 * stage's `assessmentTypes` (e.g. Site Evaluation's Feasibility/Financial/
 * Technical/Operational forms) — one stage, several independent schemas.
 */
async function loadStageContext(projectId, stageKey, assessmentType) {
  const project = await Project.findById(projectId).select('stages template');
  if (!project) throw ApiError.notFound('Project not found');
  const stage = project.stages.find((s) => s.key === stageKey);
  if (!stage) throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);

  const templateId = project.template?.ref;
  const template = templateId ? await Template.findById(templateId).select('stages') : null;
  const templateStage = template?.stages?.find((s) => s.key === stageKey);

  const allAssessmentTypes = templateStage?.assessmentTypes || [];
  if (assessmentType) {
    const type = allAssessmentTypes.find((a) => a.key === assessmentType);
    if (!type) {
      throw ApiError.badRequest(`Unknown assessment type "${assessmentType}" for stage "${stageKey}"`);
    }
    return {
      project,
      stage,
      schema: type.masterDataSchema || [],
      assessmentName: type.name,
      assessmentTypes: allAssessmentTypes,
    };
  }

  const schema = templateStage?.masterDataSchema || [];
  return { project, stage, schema, assessmentName: undefined, assessmentTypes: allAssessmentTypes };
}

/**
 * After an assessment record (e.g. Site Evaluation's Feasibility form) is
 * submitted, check whether every assessment type for its stage now has a
 * submitted record against the same parent (e.g. property) — if so, that
 * parent's evaluation is fully done, so log one extra summary event.
 */
async function maybeLogSiteEvaluationCompleted(record, assessmentTypes, userId) {
  const keys = (assessmentTypes || []).map((t) => t.key);
  if (!keys.length) return;

  const submittedSiblings = await Record.find({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    status: RECORD_STATUS.SUBMITTED,
  }).select('assessmentType');
  const submittedKeys = new Set(submittedSiblings.map((r) => r.assessmentType));
  if (!keys.every((k) => submittedKeys.has(k))) return;

  const parent = await Record.findById(record.parentRecordId).select('title seq');
  await activityService.log({
    project: record.project,
    entityType: 'record',
    entityId: record.parentRecordId,
    action: ACTIVITY_ACTIONS.COMPLETED,
    actor: userId,
    message: `Site Evaluation completed for ${parent ? labelOf(parent) : 'the property'}`,
    meta: { stageKey: record.stageKey, recordId: String(record.parentRecordId) },
  });
}

/** Row title = the first required text-ish value, falling back to common keys. */
function deriveTitle(values = {}, schema = []) {
  const titleField = schema.find((f) => f.required && (f.type === 'text' || !f.type));
  const fromSchema = titleField ? values[titleField.key] : undefined;
  return fromSchema || values.property_name || values.name || values.title || 'Untitled';
}

/** Enforce required fields when a record is submitted (drafts skip this). */
function assertRequired(values = {}, schema = []) {
  const missing = schema
    .filter((f) => f.required && isEmpty(values[f.key]))
    .map((f) => ({ field: f.key, message: `${f.label} is required` }));
  if (missing.length) {
    throw ApiError.badRequest('Please complete all required fields before submitting', {
      details: missing,
      code: 'REQUIRED_FIELDS_MISSING',
    });
  }
}

async function logRecord(record, action, actor, message) {
  await activityService.log({
    project: record.project,
    entityType: 'record',
    entityId: record._id,
    action,
    actor,
    message,
    meta: { stageKey: record.stageKey, recordId: String(record._id) },
  });
}

export const recordService = {
  async list(query = {}) {
    const filter = {};
    if (query.projectId) filter.project = query.projectId;
    if (query.stageKey) filter.stageKey = query.stageKey;
    if (query.status) filter.status = query.status;
    if (query.parentRecordId) filter.parentRecordId = query.parentRecordId;
    if (query.assessmentType) filter.assessmentType = query.assessmentType;
    return Record.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name role avatarColor')
      .populate('updatedBy', 'name role avatarColor')
      .populate('submittedBy', 'name role avatarColor')
      .populate('approvedBy', 'name role avatarColor')
      .populate('rejectedBy', 'name role avatarColor')
      .populate('shortlistedBy', 'name role avatarColor')
      .populate('decidedBy', 'name role avatarColor');
  },

  async getById(id) {
    const record = await Record.findById(id)
      .populate('createdBy', 'name role avatarColor')
      .populate('updatedBy', 'name role avatarColor')
      .populate('submittedBy', 'name role avatarColor')
      .populate('approvedBy', 'name role avatarColor')
      .populate('rejectedBy', 'name role avatarColor')
      .populate('shortlistedBy', 'name role avatarColor')
      .populate('decidedBy', 'name role avatarColor');
    if (!record) throw ApiError.notFound('Record not found');
    return record;
  },

  async create(data, userId) {
    const { stage, schema, assessmentName, assessmentTypes } = await loadStageContext(
      data.projectId,
      data.stageKey,
      data.assessmentType,
    );
    const status = data.status || RECORD_STATUS.SUBMITTED;
    const values = data.values || {};
    if (status === RECORD_STATUS.SUBMITTED) assertRequired(values, schema);

    const submitted = status === RECORD_STATUS.SUBMITTED;
    // Stable sequential number, scoped to this project's stage. Continues from the
    // highest existing seq so deletions never renumber surviving records.
    const last = await Record.findOne({ project: data.projectId, stageKey: data.stageKey })
      .sort({ seq: -1 })
      .select('seq');
    const seq = (last?.seq || 0) + 1;

    const record = await Record.create({
      project: data.projectId,
      stageKey: data.stageKey,
      assessmentType: data.assessmentType,
      parentRecordId: data.parentRecordId,
      seq,
      title: assessmentName || deriveTitle(values, schema),
      values,
      status,
      attachments: data.attachments || [],
      submittedAt: submitted ? new Date() : undefined,
      submittedBy: submitted ? userId : undefined,
      createdBy: userId,
      updatedBy: userId,
    });

    const noun = stage.recordNoun || 'Record';
    const message = data.assessmentType
      ? `${assessmentName} ${submitted ? 'completed' : 'started'}`
      : `${noun} ${labelOf(record)} ${submitted ? 'submitted' : 'saved as draft'}`;
    await logRecord(record, ACTIVITY_ACTIONS.CREATED, userId, message);

    if (submitted && record.assessmentType && record.parentRecordId) {
      await maybeLogSiteEvaluationCompleted(record, assessmentTypes, userId);
    }
    return this.getById(record._id);
  },

  async update(id, data, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    const { stage, schema, assessmentName, assessmentTypes } = await loadStageContext(
      record.project,
      record.stageKey,
      record.assessmentType,
    );

    const nextValues = data.values !== undefined ? data.values : record.values;
    const nextStatus = data.status || record.status;
    const submitting =
      nextStatus === RECORD_STATUS.SUBMITTED && record.status !== RECORD_STATUS.SUBMITTED;
    if (nextStatus === RECORD_STATUS.SUBMITTED) assertRequired(nextValues, schema);

    if (data.values !== undefined) {
      record.values = nextValues;
      record.markModified('values');
      // Assessment records keep their fixed title (the assessment's name,
      // e.g. "Feasibility Assessment") — deriveTitle only makes sense for
      // flat schemas like Property Identification's.
      if (!record.assessmentType) record.title = deriveTitle(nextValues, schema);
    }
    if (data.attachments !== undefined) record.attachments = data.attachments;
    if (data.status) record.status = nextStatus;
    if (submitting) {
      record.submittedAt = record.submittedAt || new Date();
      record.submittedBy = userId;
    }
    record.updatedBy = userId;
    await record.save();

    const noun = stage.recordNoun || 'Record';
    const message = record.assessmentType
      ? `${assessmentName} ${submitting ? 'completed' : 'updated'}`
      : submitting
        ? `${noun} ${labelOf(record)} submitted`
        : `${noun} ${labelOf(record)} updated`;
    await logRecord(record, submitting ? ACTIVITY_ACTIONS.STATUS_CHANGED : ACTIVITY_ACTIONS.UPDATED, userId, message);

    if (submitting && record.assessmentType && record.parentRecordId) {
      await maybeLogSiteEvaluationCompleted(record, assessmentTypes, userId);
    }
    return this.getById(id);
  },

  async decide(id, decision, reason, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    const status = DECISION_MAP[decision];
    if (!status) throw ApiError.badRequest(`Unknown decision "${decision}"`);
    if (decision === 'reject' && !reason?.trim()) {
      throw ApiError.badRequest('A reason is required when rejecting a record');
    }

    const now = new Date();
    record.status = status;
    record.decidedBy = userId;
    record.decidedAt = now;
    record.decisionReason = decision === 'reject' ? reason.trim() : undefined;

    // Each decision type has its own dedicated audit stamp; only one applies at
    // a time, so making a new decision clears whatever a prior one left behind.
    record.approvedBy = undefined;
    record.approvedAt = undefined;
    record.rejectedBy = undefined;
    record.rejectedAt = undefined;
    record.rejectReason = undefined;
    record.shortlistedBy = undefined;
    record.shortlistedAt = undefined;

    if (decision === 'approve') {
      record.approvedBy = userId;
      record.approvedAt = now;
    } else if (decision === 'reject') {
      record.rejectedBy = userId;
      record.rejectedAt = now;
      record.rejectReason = reason.trim();
    } else if (decision === 'shortlist') {
      record.shortlistedBy = userId;
      record.shortlistedAt = now;
    }
    await record.save();

    await logRecord(
      record,
      ACTIVITY_ACTIONS.STATUS_CHANGED,
      userId,
      `${labelOf(record)} — ${status}${record.rejectReason ? ` (${record.rejectReason})` : ''}`,
    );
    return this.getById(id);
  },

  async undoDecision(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    record.status = RECORD_STATUS.SUBMITTED;
    record.decidedBy = undefined;
    record.decidedAt = undefined;
    record.decisionReason = undefined;
    record.approvedBy = undefined;
    record.approvedAt = undefined;
    record.rejectedBy = undefined;
    record.rejectedAt = undefined;
    record.rejectReason = undefined;
    record.shortlistedBy = undefined;
    record.shortlistedAt = undefined;
    await record.save();
    await logRecord(
      record,
      ACTIVITY_ACTIONS.STATUS_CHANGED,
      userId,
      `${labelOf(record)} — decision reverted to submitted`,
    );
    return this.getById(id);
  },

  /**
   * Log that a doer opened a record's dedicated workspace (e.g. a shortlisted
   * property's Site Evaluation page) — purely an activity-timeline entry, no
   * state change. The frontend only calls this once per record (the first
   * time it's opened with no assessments started yet), so it doesn't spam
   * the timeline on every revisit.
   */
  async markOpened(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await logRecord(record, ACTIVITY_ACTIONS.VIEWED, userId, `${labelOf(record)} opened`);
    return record;
  },

  async remove(id, userId) {
    const record = await Record.findByIdAndDelete(id);
    if (!record) throw ApiError.notFound('Record not found');
    await logRecord(record, ACTIVITY_ACTIONS.DELETED, userId, `${labelOf(record)} deleted`);
    return record;
  },

  /**
   * Upload a media file to Cloudinary without attaching it to a record yet — the
   * create form uploads before the record exists and keeps the returned ref in
   * `values`. Reuses the shared Cloudinary helper (no new upload implementation).
   */
  async uploadMedia(file) {
    if (!file) throw ApiError.badRequest('No file provided');
    if (!isCloudinaryConfigured) {
      throw new ApiError(503, 'File uploads are not configured', {
        code: 'CLOUDINARY_NOT_CONFIGURED',
      });
    }
    const result = await uploadBuffer(file.buffer, { folder: 'mysteryrooms/records' });
    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      originalName: file.originalname,
      mimetype: file.mimetype,
      bytes: result.bytes,
      duration: result.duration, // audio/video only — undefined otherwise
    };
  },

  /** Delete an uploaded media asset (used when removing before/after save). */
  async destroyMedia(publicId, resourceType) {
    if (!publicId) throw ApiError.badRequest('publicId is required');
    await destroyAsset(publicId, resourceType || 'image');
    return { publicId };
  },
};

export default recordService;
