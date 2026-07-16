import { fmtDateTime } from '../../../lib/format.js';

/**
 * Presentation map for record statuses — mirrors the server's RECORD_STATUS
 * enum, matching the label+colour convention in lib/ui.js. `submitted`
 * displays as "Under Review" — the DB value is unchanged (see RECORD_STATUS
 * in server/src/core/constants/index.js) so every existing
 * `record.status === 'submitted'` comparison across the app keeps working;
 * only the label a user sees changed.
 */
export const RECORD_STATUS_META = {
  draft: { label: 'Draft', color: '#7c7784' },
  submitted: { label: 'Under Review', color: '#38bdf8' },
  shortlisted: { label: 'Shortlisted', color: '#10b981' },
  evaluation_in_progress: { label: 'Evaluation In Progress', color: '#f59e0b' },
  rejected: { label: 'Rejected', color: '#f43f5e' },
  approved: { label: 'Approved', color: '#6366f1' },
  archived: { label: 'Archived', color: '#94a3b8' },
  locked: { label: 'Locked', color: '#e0a13a' },
};

/**
 * The seven statuses the enterprise Status dropdown (StatusDropdown.jsx)
 * offers, in display order, each paired with the decision verb
 * useRecordDecision sends to POST /pms/records/:id/decision (see
 * DECISION_MAP in record.service.js). Deliberately excludes `locked` — it's
 * a reserved-for-later-use status no page's UI sets today.
 */
export const STATUS_DROPDOWN_OPTIONS = [
  { value: 'draft', verb: 'draft', ...RECORD_STATUS_META.draft },
  { value: 'submitted', verb: 'under_review', ...RECORD_STATUS_META.submitted },
  { value: 'shortlisted', verb: 'shortlist', ...RECORD_STATUS_META.shortlisted },
  { value: 'evaluation_in_progress', verb: 'evaluation_in_progress', ...RECORD_STATUS_META.evaluation_in_progress },
  { value: 'approved', verb: 'approve', ...RECORD_STATUS_META.approved },
  { value: 'rejected', verb: 'reject', ...RECORD_STATUS_META.rejected },
  { value: 'archived', verb: 'archive', ...RECORD_STATUS_META.archived },
];

/** Stable display label for a record's number, e.g. "Property No. 1". */
export const propertyNo = (seq) => (seq ? `Property No. ${seq}` : '—');

/**
 * Presentation map for a Site Evaluation step's status — three-tier, both for
 * a single assessment step and (aggregated) for a whole property's evaluation.
 * `pending` isn't a real `Record.status` value — it's what a step shows before
 * any record for it exists yet.
 */
export const STEP_STATUS_META = {
  pending: { label: 'Pending', color: '#7c7784' },
  in_progress: { label: 'In Progress', color: '#38bdf8' },
  completed: { label: 'Completed', color: '#10b981' },
};

/**
 * Same three-tier aggregate as STEP_STATUS_META, worded for Commercial
 * Finalization specifically — a property lands here already "Approved for
 * Commercial Finalization" (Site Evaluation cleared), and only reads
 * "Commercial Finalized" once every workflow below is approved.
 */
export const COMMERCIAL_STATUS_META = {
  pending: { label: 'Approved for Commercial Finalization', color: '#7c7784' },
  in_progress: { label: 'In Progress', color: '#38bdf8' },
  completed: { label: 'Commercial Finalized', color: '#10b981' },
};

/**
 * A single record's own status badge — reads `record.status` directly rather
 * than an aggregated/derived state, since the enterprise Status dropdown
 * (StatusDropdown.jsx) edits this exact field: showing anything other than
 * the record's real status there would make the dropdown lie about what it's
 * about to change. `record` is the assessment's Record if one exists yet,
 * else null/undefined (shows "Pending" — nothing filed yet).
 */
export const cardStatusMeta = (record) => {
  if (!record) return { ...STEP_STATUS_META.pending, soft: 'var(--surface-hover)' };
  const meta = RECORD_STATUS_META[record.status];
  if (!meta) return { ...STEP_STATUS_META.in_progress, color: 'var(--info)', soft: 'var(--info-soft)' };
  return { label: meta.label, color: meta.color, soft: `${meta.color}22` };
};

/** Overall per-property Site Evaluation progress counts only Approved assessments. */
export const isAssessmentApproved = (record) => record?.status === 'approved';

/**
 * Whether one assessment type is "done" for `parentId` — normally "has at
 * least one Approved record among `records`" (multi-submission stages like
 * Project Creation/Department Planning/Commercial Finalization, where a type
 * can be resubmitted after approval without losing credit for the earlier
 * one). A type that declares `subKeyField` (Commercial Finalization's NOC
 * Management, Commercial Approvals) instead tracks several required
 * sub-items in one form — one record per NOC type / approval level — so it's
 * only done once *every* option of that select field has its own Approved
 * record. The required options come straight from the field's own
 * `masterDataSchema` entry, so a template edit (new NOC type, new approval
 * level) needs no code change here.
 */
/** The required sub-item options for a `subKeyField` type (e.g. NOC Management's 7 NOC types), or [] if it isn't one. */
function requiredSubItems(type) {
  if (!type.subKeyField) return [];
  const field = (type.masterDataSchema || []).find((f) => f.key === type.subKeyField);
  return field?.options || [];
}

function isTypeDone(records, parentId, type) {
  const own = (records || []).filter(
    (r) => String(r.parentRecordId) === String(parentId) && r.assessmentType === type.key,
  );
  const required = requiredSubItems(type);
  if (!required.length) return own.some((r) => r.status === 'approved');
  return required.every((opt) =>
    own.some((r) => r.status === 'approved' && r.values?.[type.subKeyField] === opt),
  );
}

/**
 * Count of `types` that are done (see isTypeDone) for `parentId` among
 * `records` — used everywhere a stage's overall progress ("4/6 workflows
 * approved") is derived from its assessmentTypes.
 */
export const approvedTypeCount = (records, parentId, types) =>
  (types || []).filter((t) => isTypeDone(records, parentId, t)).length;

/** True once every required sub-item of `type` has its own Approved record — see isTypeDone. */
export const isTypeApproved = (records, parentId, type) => isTypeDone(records, parentId, type);

/**
 * "X/Y Approved" progress for a `subKeyField` type (e.g. "5/7 Approved" for
 * NOC Management) — null for an ordinary one-record-per-type type, which has
 * no sub-item checklist to summarize this way.
 */
export function subItemProgress(records, parentId, type) {
  const required = requiredSubItems(type);
  if (!required.length) return null;
  const own = (records || []).filter(
    (r) => String(r.parentRecordId) === String(parentId) && r.assessmentType === type.key,
  );
  const approvedCount = required.filter((opt) =>
    own.some((r) => r.status === 'approved' && r.values?.[type.subKeyField] === opt),
  ).length;
  return `${approvedCount}/${required.length} Approved`;
}

/**
 * Primary action label per card state — what the button at the bottom of an
 * assessment card reads, matching what clicking it will actually do.
 */
export const primaryActionLabel = (record) => {
  if (!record) return 'Fill Form';
  if (record.status === 'draft') return 'Continue';
  return 'Open Form';
};

/**
 * A record's 1-based submission number within its own assessment type,
 * ordered by when it was actually filed (oldest = #1) — independent of
 * whatever order the records table itself is displayed in. Single-record-
 * per-type stages (Site Evaluation, Commercial Finalization) always report
 * #1, since only one record ever exists per type there.
 */
export const submissionNoOf = (records, record) => {
  const sameType = (records || [])
    .filter((r) => r.assessmentType === record.assessmentType)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const idx = sameType.findIndex((r) => String(r._id) === String(record._id));
  return idx >= 0 ? idx + 1 : 1;
};

/**
 * Best-effort "remarks" text for a records-table row — most assessment
 * schemas across stages settle on a `remarks` or `notes` key for their
 * free-text field, so this covers every stage without needing its schema
 * threaded through just to find one column's value.
 */
export const remarksOf = (record) => record?.values?.remarks || record?.values?.notes || '';

/**
 * Assemble the metadata block RecordFormModal's View mode shows above the
 * form fields — submission facts, current status, and (if decided) who
 * decided it and why. `allRecords` is every record for this parent/type, so
 * the submission number is scoped correctly; `typeLabel` is the assessment
 * type's display name (the caller already has it from its own assessmentTypes
 * lookup, so it isn't re-derived here).
 */
export const buildRecordMeta = (record, allRecords, typeLabel) => {
  if (!record) return null;
  const smeta = cardStatusMeta(record);
  return {
    typeLabel,
    submissionNo: submissionNoOf(allRecords, record),
    submittedBy: record.submittedBy?.name || record.createdBy?.name || '—',
    submittedOn: fmtDateTime(record.submittedAt || record.createdAt),
    statusLabel: smeta.label,
    statusColor: smeta.color,
    decidedBy: record.decidedBy?.name,
    decidedOn: record.decidedAt ? fmtDateTime(record.decidedAt) : undefined,
    rejectReason: record.status === 'rejected' ? (record.rejectReason || record.decisionReason) : undefined,
  };
};

/**
 * Whether `record` belongs under a clicked KPI card's filter key — shared by
 * every module-based workspace page's "click a KPI card to narrow the
 * records table below" behavior. `null`/`'all'` clears the filter. `'pending'`
 * always returns false: a pending module has zero records by definition, so
 * filtering to it correctly empties the table rather than matching anything.
 */
export function matchesStatusFilter(record, filterKey) {
  if (!filterKey || filterKey === 'all') return true;
  if (filterKey === 'pending') return false;
  if (filterKey === 'approved') return record.status === 'approved';
  if (filterKey === 'rejected') return record.status === 'rejected';
  if (filterKey === 'in_progress') return record.status === 'draft' || record.status === 'submitted';
  return true;
}

/** Filter tabs shown above the records table. */
export const RECORD_FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'rejected', label: 'Rejected' },
];
