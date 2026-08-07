import { Record } from './record.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { activityService } from '../activity/activity.service.js';
import { projectService } from '../projects/project.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import {
  RECORD_STATUS, ACTIVITY_ACTIONS, PROJECT_STATUS, can, PRE_LAUNCH_STAGE_KEYS,
} from '../../../core/constants/index.js';
import {
  uploadBuffer,
  destroyAsset,
  isS3Configured,
} from '../../../config/s3.js';

/** Phase 4's single master form — mirrors MASTER_KEY in ProjectCreationPage.jsx. */
const P4_MASTER_KEY = 'project_creation';

/** Phase 7 — Approval Workflow. */
const P7_STAGE_KEY = 'p7';

/**
 * Phase 7's assessmentTypes are an ORDERED gate sequence (Department Review →
 * Functional Review → Finance Approval → Legal Review → Management Approval →
 * Final Approval), unlike every other stage's unordered form set. Approving
 * one tier therefore requires every earlier tier to already be Approved for
 * the same property — no skipping ahead to Final Approval, and no approving
 * out of order. Rejection is always allowed at any tier.
 *
 * The order comes from the template itself, so adding or reordering a gate
 * needs no code change here.
 */
async function assertApprovalTierOrder(record, decision) {
  if (decision !== 'approve') return;
  if (!record.assessmentType || !record.parentRecordId) return;

  const { assessmentTypes } = await loadStageContext(record.project, record.stageKey);
  const order = assessmentTypes.map((t) => t.key);
  const idx = order.indexOf(record.assessmentType);
  if (idx <= 0) return; // unknown type, or the first gate — nothing precedes it

  const earlier = order.slice(0, idx);
  const approved = await Record.find({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    assessmentType: { $in: earlier },
    status: RECORD_STATUS.APPROVED,
  }).select('assessmentType');

  const cleared = new Set(approved.map((r) => r.assessmentType));
  const pending = earlier.filter((k) => !cleared.has(k));
  if (pending.length) {
    const nameOf = (k) => assessmentTypes.find((t) => t.key === k)?.name || k;
    throw ApiError.badRequest(
      `${nameOf(record.assessmentType)} can’t be approved yet — ${pending.map(nameOf).join(', ')} ${pending.length === 1 ? 'is' : 'are'} still outstanding.`,
      { code: 'APPROVAL_OUT_OF_ORDER', details: pending },
    );
  }
}

const DECISION_MAP = {
  draft: RECORD_STATUS.DRAFT,
  under_review: RECORD_STATUS.SUBMITTED,
  shortlist: RECORD_STATUS.SHORTLISTED,
  evaluation_in_progress: RECORD_STATUS.EVALUATION_IN_PROGRESS,
  reject: RECORD_STATUS.REJECTED,
  approve: RECORD_STATUS.APPROVED,
  archive: RECORD_STATUS.ARCHIVED,
  lock: RECORD_STATUS.LOCKED,
};

/** Mirrors recordUi.js's RECORD_STATUS_META labels — kept small and local so the audit/activity message reads naturally instead of a raw enum value. */
const STATUS_LABELS = {
  [RECORD_STATUS.DRAFT]: 'Draft',
  [RECORD_STATUS.SUBMITTED]: 'Under Review',
  [RECORD_STATUS.SHORTLISTED]: 'Shortlisted',
  [RECORD_STATUS.EVALUATION_IN_PROGRESS]: 'Evaluation In Progress',
  [RECORD_STATUS.REJECTED]: 'Rejected',
  [RECORD_STATUS.APPROVED]: 'Approved',
  [RECORD_STATUS.ARCHIVED]: 'Archived',
  [RECORD_STATUS.LOCKED]: 'Locked',
};

/**
 * Stages whose "all workflows done" event fires on manager approval of every
 * assessment type, and whose assessment types allow unlimited resubmissions
 * per workflow (see maybeLogDecisionGatedStageCompleted / submissionNoFor) —
 * a stage joining this list needs no new completion-logging code, just its
 * own assessmentTypes in the template. Currently every assessment-type stage
 * (Site Evaluation, Commercial Finalization, Project Creation, Department
 * Planning, Approval Workflow, Store Readiness Checklist, Store Launch) is
 * decision-gated.
 */
const DECISION_GATED_STAGES = new Set(['p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9', 'p10']);

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Statuses that represent a decision already taken by a reviewer. A record
 * sitting in one of these was reviewed on the strength of its values, and
 * every downstream consumer (the scoring engine, Phase 2/3 approvals, stage
 * completion gates) trusts that those values are what was actually reviewed
 * — so they're frozen until the decision is explicitly undone.
 */
const DECIDED_STATUSES = new Set([
  RECORD_STATUS.SHORTLISTED,
  RECORD_STATUS.APPROVED,
  RECORD_STATUS.REJECTED,
  RECORD_STATUS.ARCHIVED,
  RECORD_STATUS.LOCKED,
]);

/**
 * Which decisions are legal from a record's current status. The UI already
 * only offers Shortlist/Reject on a `submitted` record — this is the
 * server-side half of that rule, so a direct API call can't re-shortlist a
 * rejected record, decide an already-locked one, or apply a p2/p3-only
 * decision to a record that never entered review. `undoDecision()` remains
 * the one sanctioned way back to `submitted`.
 */
const LEGAL_DECISIONS_BY_STATUS = {
  [RECORD_STATUS.DRAFT]: ['draft', 'under_review'],
  [RECORD_STATUS.SUBMITTED]: [
    'draft', 'under_review', 'shortlist', 'evaluation_in_progress',
    'reject', 'approve', 'archive', 'lock',
  ],
  [RECORD_STATUS.EVALUATION_IN_PROGRESS]: ['shortlist', 'reject', 'approve', 'archive', 'lock'],
  // 'shortlist' from SHORTLISTED is NOT a no-op: Site Evaluation's own
  // Approve button re-issues decide('shortlist') on a property that Phase 1
  // already shortlisted — that second decision (and its fresh `decidedAt`)
  // is precisely what marks the property approved at Phase 2. See
  // isPropertyApprovedAtP2 in project.service.js.
  [RECORD_STATUS.SHORTLISTED]: ['shortlist', 'evaluation_in_progress', 'reject', 'approve', 'archive', 'lock'],
  [RECORD_STATUS.APPROVED]: ['archive', 'lock'],
  [RECORD_STATUS.REJECTED]: ['archive'],
  [RECORD_STATUS.ARCHIVED]: [],
  [RECORD_STATUS.LOCKED]: [],
};

/**
 * Phase 10's Archive Project makes the whole project read-only — enforced
 * here (not only in the UI) so an archived project's records can't be
 * created, edited or decided through a direct API call. `stageKey`, when
 * passed, additionally enforces the Store Launch Lock: a pre-launch-phase
 * record (p1-p8) becomes read-only the moment project.status hits
 * STORE_LIVE, matching the Confirm Launch modal's own "Phases 1-8 become
 * read-only" promise — previously only a UI claim, never enforced here.
 * p9/p10 are deliberately exempt — see PRE_LAUNCH_STAGE_KEYS.
 */
async function assertProjectNotArchived(projectId, stageKey) {
  const project = await Project.findById(projectId).select('status');
  if (project?.status === PROJECT_STATUS.ARCHIVED) {
    throw ApiError.badRequest('This project is archived and read-only.');
  }
  if (
    stageKey
    && PRE_LAUNCH_STAGE_KEYS.includes(stageKey)
    && project?.status === PROJECT_STATUS.STORE_LIVE
  ) {
    throw ApiError.badRequest(
      'The store has gone live — earlier-phase work is now read-only history and can no longer be edited.',
      { code: 'PROJECT_LIVE_READ_ONLY' },
    );
  }
}

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

  // Fail loudly rather than falling through with an empty schema: an empty
  // schema makes assertRequired() a silent no-op, so a missing/deleted
  // template would let records be submitted and approved with no field
  // validation at all and no error surfaced anywhere.
  if (templateId && !template) {
    throw ApiError.badRequest(
      'This project’s template no longer exists, so its forms can’t be validated. Restore the template before filing records.',
    );
  }

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
 * 1-based submission number for an assessment-type record, scoped to its own
 * (project, stage, parent, assessmentType) — counts how many sibling records
 * were created before it. Every assessment type across every stage supports
 * unlimited resubmissions, so this is what activity messages ("Feasibility
 * Assessment Submission #2 …") use to identify which submission changed;
 * it's recomputed from creation order rather than stored, so it never
 * drifts even if an earlier submission is later deleted.
 */
async function submissionNoFor(record) {
  if (!record.assessmentType || !record.parentRecordId) return null;
  const earlierCount = await Record.countDocuments({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    assessmentType: record.assessmentType,
    createdAt: { $lt: record.createdAt },
  });
  return earlierCount + 1;
}

/**
 * For a DECISION_GATED_STAGES stage: once every workflow in the stage's
 * (template-driven) assessmentTypes has at least one Approved record against
 * the same parent, log one summary event — "at least one", not "the latest",
 * because these stages allow multiple resubmissions per workflow (a later
 * draft/rejected resubmission after approval doesn't undo an already-earned
 * Approved). Guards against a duplicate log if a later re-approval
 * re-triggers the same all-approved state.
 */
async function maybeLogDecisionGatedStageCompleted(record, stage, assessmentTypes, userId) {
  const keys = (assessmentTypes || []).map((t) => t.key);
  if (!keys.length) return;

  const approvedSiblings = await Record.find({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    status: RECORD_STATUS.APPROVED,
  }).select('assessmentType');
  const approvedKeys = new Set(approvedSiblings.map((r) => r.assessmentType));
  if (!keys.every((k) => approvedKeys.has(k))) return;

  const parent = await Record.findById(record.parentRecordId).select('title seq');
  const message = `${stage.name} completed for ${parent ? labelOf(parent) : 'the property'}`;

  const alreadyLogged = await Record.db.model('Activity').findOne({ project: record.project, message });
  if (alreadyLogged) return;

  await activityService.log({
    project: record.project,
    entityType: 'record',
    entityId: record.parentRecordId,
    action: ACTIVITY_ACTIONS.COMPLETED,
    actor: userId,
    message,
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
    meta: {
      stageKey: record.stageKey,
      recordId: String(record._id),
      parentRecordId: record.parentRecordId ? String(record.parentRecordId) : undefined
    },
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
      .populate('project', 'name code')
      .populate('createdBy', 'name role avatarColor title')
      .populate('updatedBy', 'name role avatarColor title')
      .populate('submittedBy', 'name role avatarColor title')
      .populate('approvedBy', 'name role avatarColor title')
      .populate('rejectedBy', 'name role avatarColor title')
      .populate('shortlistedBy', 'name role avatarColor title')
      .populate('decidedBy', 'name role avatarColor title')
      .populate('comments.author', 'name role avatarColor title');
  },

  async getById(id) {
    const record = await Record.findById(id)
      .populate('createdBy', 'name role avatarColor title')
      .populate('updatedBy', 'name role avatarColor title')
      .populate('submittedBy', 'name role avatarColor title')
      .populate('approvedBy', 'name role avatarColor title')
      .populate('rejectedBy', 'name role avatarColor title')
      .populate('shortlistedBy', 'name role avatarColor title')
      .populate('decidedBy', 'name role avatarColor title')
      .populate('comments.author', 'name role avatarColor title');
    if (!record) throw ApiError.notFound('Record not found');
    return record;
  },

  async create(data, userId) {
    await assertProjectNotArchived(data.projectId, data.stageKey);
    const { stage, schema, assessmentName } = await loadStageContext(
      data.projectId,
      data.stageKey,
      data.assessmentType,
    );
    const status = data.status || RECORD_STATUS.SUBMITTED;
    const values = data.values || {};
    if (status === RECORD_STATUS.SUBMITTED) assertRequired(values, schema);

    const submitted = status === RECORD_STATUS.SUBMITTED;

    // Stable sequential number, scoped to this project's stage. Continues from
    // the highest existing seq so deletions never renumber surviving records.
    //
    // Read-then-write is inherently racy: two submissions filed at the same
    // moment both read the same highest seq and both claim it, so the
    // "Property No." users cite can end up shared by two records. The loop
    // below re-reads and retries on a duplicate-key rejection, which is what
    // makes it safe once the unique {project, stageKey, seq} index exists —
    // see seed/migrateRecordSeqUniqueness.js, which repairs the existing
    // duplicates and creates that index. Until it has been run the retry is
    // simply inert, and behaviour is exactly as before.
    const MAX_ATTEMPTS = 5;
    let record = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const last = await Record.findOne({ project: data.projectId, stageKey: data.stageKey })
        .sort({ seq: -1 })
        .select('seq');
      const seq = (last?.seq || 0) + 1;
      try {
        record = await Record.create({
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
        break;
      } catch (err) {
        const isDuplicateSeq = err?.code === 11000 && JSON.stringify(err.keyPattern || {}).includes('seq');
        if (!isDuplicateSeq || attempt === MAX_ATTEMPTS) throw err;
        logger.warn(`Record seq ${seq} was taken concurrently — retrying (${attempt}/${MAX_ATTEMPTS})`);
      }
    }

    const noun = stage.recordNoun || 'Record';
    const message = data.assessmentType
      ? `New ${assessmentName.toLowerCase()} submitted.`
      : `${noun} ${labelOf(record)} ${submitted ? 'submitted' : 'saved as draft'}`;
    await logRecord(record, ACTIVITY_ACTIONS.CREATED, userId, message);

    // A new assessment-type record's completion event (if any) fires on
    // approval, not here (see maybeLogDecisionGatedStageCompleted in
    // decide()) — creating/submitting a workflow isn't itself the
    // completion signal.
    return this.getById(record._id);
  },

  async update(id, data, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);

    // A reviewed record's values are frozen — changing them after a decision
    // would silently invalidate that decision (and everything downstream that
    // trusts it) with no re-review. Undo the decision first to reopen it.
    const changesContent = data.values !== undefined || data.attachments !== undefined;
    if (changesContent && DECIDED_STATUSES.has(record.status)) {
      throw ApiError.badRequest(
        `This record was already ${STATUS_LABELS[record.status]?.toLowerCase() || record.status} — undo that decision before editing it.`,
        { code: 'RECORD_DECIDED' },
      );
    }

    const { stage, schema, assessmentName } = await loadStageContext(
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
      ? `${assessmentName} updated.`
      : submitting
        ? `${noun} ${labelOf(record)} submitted`
        : `${noun} ${labelOf(record)} updated`;
    await logRecord(record, submitting ? ACTIVITY_ACTIONS.STATUS_CHANGED : ACTIVITY_ACTIONS.UPDATED, userId, message);

    return this.getById(id);
  },

  async decide(id, decision, reason, userId, remarks, actor) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    const status = DECISION_MAP[decision];
    if (!status) throw ApiError.badRequest(`Unknown decision "${decision}"`);
    await assertProjectNotArchived(record.project, record.stageKey);

    // Only decisions that are legal from the record's *current* status —
    // without this, a direct API call could re-shortlist a rejected record or
    // decide an already-locked one, breaking the one-way review workflow the
    // scoring engine and stage gates assume is authoritative.
    const legal = LEGAL_DECISIONS_BY_STATUS[record.status] ?? [];
    if (!legal.includes(decision)) {
      throw ApiError.badRequest(
        `A record that is ${STATUS_LABELS[record.status]?.toLowerCase() || record.status} can’t be ${decision === 'reject' ? 'rejected' : `set to "${STATUS_LABELS[status] || status}"`} — undo the current decision first.`,
        { code: 'ILLEGAL_RECORD_TRANSITION', details: { from: record.status, decision, allowed: legal } },
      );
    }

    if (decision === 'reject' && !reason?.trim()) {
      throw ApiError.badRequest('A reason is required when rejecting a record');
    }

    // Approval Workflow's own rules — scoped to p7, whose assessmentTypes are
    // an ordered gate sequence rather than an unordered form set.
    if (record.stageKey === P7_STAGE_KEY) {
      // Defence in depth: the route already applies `canDecide`, but a
      // decision that gates a whole phase shouldn't rely on the routing layer
      // alone. `actor` is absent for trusted internal callers (seeds), which
      // skip the check exactly as completeStage's role gate does.
      if (actor && !can.decide(actor.role)) {
        throw ApiError.forbidden(
          'Only an MD, EA or Manager can decide an approval request.',
          { code: 'APPROVAL_ROLE_REQUIRED' },
        );
      }
      await assertApprovalTierOrder(record, decision);
      // Separation of duties: whoever filed the request can't sign it off.
      if (userId && record.submittedBy && String(record.submittedBy) === String(userId)) {
        throw ApiError.forbidden(
          'You submitted this approval request — it needs a different reviewer to decide it.',
          { code: 'SELF_APPROVAL' },
        );
      }
    }

    // Site Evaluation's own rule: only one property may be Approved at Phase 2
    // at a time. 'shortlist' from an already-SHORTLISTED record is exactly the
    // "Approve at Site Evaluation" action (see LEGAL_DECISIONS_BY_STATUS above
    // — the original Phase 1 shortlist decision happens from SUBMITTED or
    // EVALUATION_IN_PROGRESS, never from SHORTLISTED). Every downstream gate
    // (Commercial Finalization onward) resolves THE ONE approved property via
    // projectService.getP2ApprovedProperty's `.find()` — two simultaneously
    // approved properties would leave that resolution silently ambiguous.
    if (record.stageKey === 'p1' && decision === 'shortlist' && record.status === RECORD_STATUS.SHORTLISTED) {
      const alreadyApproved = await projectService.getP2ApprovedProperty(record.project);
      if (alreadyApproved && String(alreadyApproved._id) !== String(record._id)) {
        throw ApiError.badRequest(
          `"${alreadyApproved.title}" is already the approved property for this project's Site Evaluation — only one property can be approved. Reject or undo that decision first if you need to approve a different one.`,
          {
            code: 'PROPERTY_ALREADY_APPROVED',
            details: { approvedPropertyId: alreadyApproved._id, approvedPropertyTitle: alreadyApproved.title },
          },
        );
      }
    }

    const now = new Date();
    const fromStatus = record.status;
    record.status = status;
    record.decidedBy = userId;
    record.decidedAt = now;
    // Reviewer Remarks — optional, distinct from the required rejectReason
    // below (e.g. reason "Low ROI", remarks "Rental exceeds approved budget").
    // Captured for any decision (e.g. Approval Remarks on an approve/shortlist).
    record.decisionReason = remarks?.trim() || undefined;

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

    // Append to the permanent trail before saving — the stamps above only
    // ever describe the latest decision, so this is what makes a
    // reject → resubmit → approve cycle auditable on the record itself.
    record.decisionHistory.push({
      decision,
      fromStatus,
      toStatus: status,
      by: userId,
      at: now,
      reason: decision === 'reject' ? reason.trim() : undefined,
      remarks: remarks?.trim() || undefined,
    });

    await record.save();

    const statusLabel = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : `set to "${STATUS_LABELS[status] || status}"`;
    const activityMessage = record.assessmentType
      ? `${record.title} Submission #${await submissionNoFor(record)} ${statusLabel}${record.rejectReason ? ` (${record.rejectReason})` : ''}`
      : `${labelOf(record)} — ${statusLabel}${record.rejectReason ? ` (${record.rejectReason})` : ''}`;

    await logRecord(
      record,
      ACTIVITY_ACTIONS.STATUS_CHANGED,
      userId,
      activityMessage,
    );

    if (decision === 'approve' && DECISION_GATED_STAGES.has(record.stageKey) && record.assessmentType && record.parentRecordId) {
      const { stage, assessmentTypes } = await loadStageContext(record.project, record.stageKey);
      await maybeLogDecisionGatedStageCompleted(record, stage, assessmentTypes, userId);
    }

    // Project Creation (p4) is the one DECISION_GATED_STAGES phase with no
    // "Mark Done" button anywhere in the UI — ProjectCreationPage.jsx's own
    // comment says so explicitly: "Approval — not submission — creates the
    // project... there is deliberately no client-side completion here."
    // Approving the single Project Setup master record IS meant to be the
    // completion trigger, not merely the activity-log event the block above
    // produces. `completeStage`'s own p4 branch re-validates everything
    // (including copying the approved form's values onto the Project doc via
    // applyProjectSetup) and is idempotent, so this just invokes the same
    // authoritative path a manual "Mark Done" would elsewhere. Best-effort:
    // if the project turns out not to be eligible for some other reason, the
    // record approval itself must still succeed — the stage simply stays
    // open until that other condition clears.
    if (decision === 'approve' && record.stageKey === 'p4' && record.assessmentType === P4_MASTER_KEY) {
      try {
        await projectService.completeStage(record.project, 'p4', userId, actor);
      } catch (err) {
        logger.warn(`Auto-complete of Phase 4 after Project Setup approval did not apply: ${err.message}`, { project: String(record.project) });
      }
    }

    // Project Creation (p4) closes on the manager's approval of its single
    // master form — that approval IS the completion event. This used to be a
    // useEffect in ProjectCreationPage that fired on *submission*, so the
    // stage completed with nobody having approved anything. Now the server
    // owns it, and completeStage re-validates the approval independently, so
    // this can't complete a stage the gate wouldn't allow on its own.
    if (decision === 'approve' && record.stageKey === 'p4' && record.assessmentType === P4_MASTER_KEY) {
      await projectService.completeStage(record.project, 'p4', userId).catch((err) => {
        logger.warn(`p4 auto-completion skipped: ${err.message}`, { projectId: String(record.project) });
      });
    }

    // Project Closure (p10) closes the same way: approving a closure module
    // is the trigger, and completeStage's own p10 gate decides whether that
    // was in fact the last thing outstanding (every prior phase complete,
    // store live, every module approved, no open task). Harmlessly a no-op
    // until then — which is why this replaced the client-side useEffect that
    // used to fire it off "all modules approved" alone.
    if (decision === 'approve' && record.stageKey === 'p10') {
      await projectService.completeStage(record.project, 'p10', userId).catch((err) => {
        logger.warn(`p10 auto-completion skipped: ${err.message}`, { projectId: String(record.project) });
      });
    }

    return this.getById(id);
  },

  async undoDecision(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);
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
   * state change. Callers re-fire this on every visit while the record still
   * has no assessments (each page mount resets its own "already logged"
   * guard), so idempotency has to live here: skip the write if an "opened"
   * entry for this record already exists, instead of spamming the timeline.
   */
  async markOpened(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    const alreadyLogged = await activityService.exists({
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.VIEWED,
    });
    if (!alreadyLogged) {
      await logRecord(record, ACTIVITY_ACTIONS.VIEWED, userId, `${labelOf(record)} opened`);
    }
    return record;
  },

  async addComment(id, body, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    record.comments.push({ author: userId, body });
    await record.save();
    await logRecord(record, ACTIVITY_ACTIONS.COMMENTED, userId, `Commented on ${labelOf(record)}`);
    return this.getById(id);
  },

  async remove(id, userId) {
    const record = await Record.findByIdAndDelete(id);
    if (!record) throw ApiError.notFound('Record not found');
    
    let message = `${record.title || 'Record'} deleted`;
    try {
      const { stage, assessmentName } = await loadStageContext(
        record.project,
        record.stageKey,
        record.assessmentType,
      );
      message = record.assessmentType
        ? `${assessmentName} deleted.`
        : `${stage.recordNoun || 'Record'} ${labelOf(record)} deleted`;
    } catch (e) {
      // fallback if context loading fails
    }
    
    await logRecord(record, ACTIVITY_ACTIONS.DELETED, userId, message);
    return record;
  },

  /**
   * Upload a media file to S3 without attaching it to a record yet — the
   * create form uploads before the record exists and keeps the returned ref in
   * `values`. Reuses the shared S3 helper (no new upload implementation).
   */
  async uploadMedia(file) {
    if (!file) throw ApiError.badRequest('No file provided');
    if (!isS3Configured) {
      throw new ApiError(503, 'File uploads are not configured', {
        code: 'S3_NOT_CONFIGURED',
      });
    }
    const result = await uploadBuffer(file.buffer, {
      folder: 'records',
      filename: file.originalname,
      contentType: file.mimetype,
    });
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
