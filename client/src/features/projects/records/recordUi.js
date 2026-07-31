import { fmtDateTime, fmtCurrency, fmtDate } from '../../../lib/format.js';
import { getEmployeeById } from '../../../lib/employees.js';

const EMPTY = '—';

/** True when a stored field value counts as "not filled in". */
export function isEmptyValue(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Turn a raw stored value into a display string for its field type. */
export function formatFieldValue(field, value) {
  if (isEmptyValue(value)) return EMPTY;
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'Yes' : 'No';
    case 'currency':
      return fmtCurrency(value);
    case 'date':
      return fmtDate(value);
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'user': {
      const employee = getEmployeeById(value);
      return employee?.name || String(value);
    }
    default:
      return String(value);
  }
}

/**
 * Presentation map for record statuses — mirrors the server's RECORD_STATUS
 * enum, matching the label+colour convention in lib/ui.js. `submitted`
 * displays as "Under Review" — the DB value is unchanged (see RECORD_STATUS
 * in server/src/core/constants/index.js) so every existing
 * `record.status === 'submitted'` comparison across the app keeps working;
 * only the label a user sees changed.
 */
export const RECORD_STATUS_META = {
  draft:                  { label: 'Draft',                   color: '#6B7280', soft: '#F3F4F6' },
  submitted:              { label: 'Under Review',            color: '#2563EB', soft: '#DBEAFE' },
  shortlisted:            { label: 'Shortlisted',             color: '#059669', soft: '#DCFCE7' },
  evaluation_in_progress: { label: 'Evaluation In Progress',  color: '#D97706', soft: '#FEF3C7' },
  rejected:               { label: 'Rejected',                color: '#DC2626', soft: '#FEE2E2' },
  approved:               { label: 'Approved',                color: '#059669', soft: '#DCFCE7' },
  archived:               { label: 'Archived',                color: '#64748B', soft: '#F1F5F9' },
  locked:                 { label: 'Locked',                  color: '#D97706', soft: '#FEF3C7' },
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

/** The field whose value titles a row (property name), with a sensible fallback. */
export function titleFieldKey(schema = []) {
  const named = schema.find((f) => f.key === 'property_name' || f.key === 'name' || f.key === 'title');
  return named?.key || schema[0]?.key;
}

/** A few compact, tabular fields to summarise a row in the table. */
export function summaryFields(schema = [], titleKey, max = 3) {
  return schema
    .filter((f) => f.key !== titleKey && !['file', 'textarea', 'multiselect'].includes(f.type))
    .slice(0, max);
}

/**
 * Presentation map for a Site Evaluation step's status — three-tier, both for
 * a single assessment step and (aggregated) for a whole property's evaluation.
 * `pending` isn't a real `Record.status` value — it's what a step shows before
 * any record for it exists yet.
 */
export const STEP_STATUS_META = {
  pending:     { label: 'Pending',     color: '#6B7280', soft: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#2563EB', soft: '#DBEAFE' },
  completed:   { label: 'Completed',   color: '#059669', soft: '#DCFCE7' },
};

/**
 * Same three-tier aggregate as STEP_STATUS_META, worded for Commercial
 * Finalization specifically.
 */
export const COMMERCIAL_STATUS_META = {
  pending:     { label: 'Approved for Commercial Finalization', color: '#6B7280', soft: '#F3F4F6' },
  in_progress: { label: 'In Progress',                         color: '#2563EB', soft: '#DBEAFE' },
  completed:   { label: 'Commercial Finalized',                color: '#059669', soft: '#DCFCE7' },
};

/**
 * A single record's own status badge — reads `record.status` directly rather
 * than an aggregated/derived state, since the enterprise Status dropdown
 * (StatusDropdown.jsx) edits this exact field: showing anything other than
 * the record's real status there would make the dropdown lie about what it's
 * about to change. `record` is the assessment's Record if one exists yet,
 * else null/undefined (shows "Pending" — nothing filed yet).
 *
 * p2 assessment records used to get an Edited/Completed-only override here
 * instead of their real status, which meant a `draft` record displayed as
 * "Completed" — actively misleading now that a draft is resumable via a
 * card's "Continue" action, which depends on the badge honestly reflecting
 * `draft` vs. everything else.
 */
export const cardStatusMeta = (record) => {
  if (!record) return { label: 'Pending', color: '#6B7280', soft: '#F3F4F6' };
  const meta = RECORD_STATUS_META[record.status];
  if (!meta) return { label: 'In Progress', color: '#2563EB', soft: '#DBEAFE' };
  return { label: meta.label, color: meta.color, soft: meta.soft || '#F3F4F6' };
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

/**
 * The shortlisted property whose Project Creation (p4) master form has been
 * genuinely Approved — mirrors project.service.js#completeStage's p4 branch
 * exactly: only a record with status `approved` counts, since that's what
 * establishes the project's real budget/timeline/manager. A merely
 * `submitted` form hasn't been signed off yet, so it doesn't count here
 * either, even though Department Planning and Execution both need to know
 * "the property" before p4 itself is marked complete. Shared by Department
 * Planning (p5) and Execution (p6), the two pages whose work is scoped to
 * this same property.
 */
export function resolveP4ApprovedProperty(properties, p4Records) {
  return (properties || []).find((p) =>
    (p4Records || []).some((r) => String(r.parentRecordId) === String(p._id) && r.status === 'approved'),
  ) || null;
}

/** Filter tabs shown above the records table. */
export const RECORD_FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'rejected', label: 'Rejected' },
];
