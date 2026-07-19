import { Eye, FileText, Pencil, Plus } from 'lucide-react';
import { Badge } from '../../../components/ui/primitives.jsx';
import { fmtDate } from '../../../lib/format.js';
import { cardStatusMeta, primaryActionLabel } from './recordUi.js';

/**
 * One assessment/workflow card — Site Evaluation's Feasibility/Financial/
 * Technical/Operational, Commercial Finalization's LOI/Lease/Legal
 * Verification/Security Deposit/NOCs/Final Approvals, Project Creation's and
 * Department Planning's workflows all render through this one component,
 * driven entirely by `type` (from the stage's assessmentTypes). Extracted
 * out of PropertyEvaluationPage so the card's markup exists in exactly one
 * place — every stage's page just maps `steps` over this.
 *
 * `type.subtitle` is optional — Site Evaluation's types don't set one, so
 * that line simply doesn't render there. `submissionCount`, when given (a
 * multi-submission stage), renders a "N Records" badge alongside the status
 * badge — the card otherwise has no notion of how many records the type has.
 * `progressLabel`, when given (a type with several required sub-items, e.g.
 * Commercial Finalization's NOC Management/Commercial Approvals — see
 * `subKeyField`/`subItemProgress` in recordUi.js), renders an "X/Y Approved"
 * badge alongside it.
 * `actionLabel`, when given, overrides the status-derived primary-action
 * label/icon — used where every click always starts a brand-new submission
 * (e.g. Site Evaluation's "New Assessment") rather than resuming a draft.
 * `showStatus` (default true) hides the status badge/record-count row
 * entirely — Site Evaluation's cards are decision-free (property approval
 * happens on the Comparison Dashboard, not per-assessment here), so its
 * cards pass `showStatus={false}` and show only title/meta/action.
 * `compact` (default false) drops the "Last Updated By/On" meta row
 * entirely (not just visually — no empty space left behind) and switches
 * the card to a shorter fixed height via `.assessment-card-compact` —
 * Commercial Finalization's single-row, six-card dashboard passes
 * `compact` to stay information-dense; every other stage's grid is
 * unaffected.
 *
 * The whole card is a role="button" div, not a literal `<button>`, because it
 * hosts a real nested `<button>` (the primary action) and a button cannot
 * legally nest inside another button.
 */
export function AssessmentCard({ type, record, onOpen, submissionCount, progressLabel, actionLabel, showStatus = true, compact = false }) {
  const cmeta = showStatus ? cardStatusMeta(record) : null;
  const ActionIcon = actionLabel ? Plus : !record ? FileText : record.status === 'draft' ? Pencil : Eye;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      title="Click to open form"
      className={`card card-hover assessment-card${compact ? ' assessment-card-compact' : ''}`}
    >
      {cmeta && (
        <div className="assessment-card-status" style={submissionCount != null || progressLabel ? { justifyContent: 'space-between' } : undefined}>
          <Badge color={cmeta.color} soft={cmeta.soft} dot>{cmeta.label}</Badge>
          <span className="row gap-2" style={{ alignItems: 'center' }}>
            {progressLabel && <span className="tiny muted">{progressLabel}</span>}
            {submissionCount != null && (
              <span className="tiny muted">{submissionCount} {submissionCount === 1 ? 'Record' : 'Records'}</span>
            )}
          </span>
        </div>
      )}

      <div className="assessment-card-title-wrap">
        <span className="assessment-card-title">{type.name}</span>
        {type.subtitle && <span className="assessment-card-subtitle">{type.subtitle}</span>}
      </div>

      {!compact && (
        <div className="assessment-card-meta tiny muted">
          <span>Last Updated By: {record?.updatedBy?.name || '—'}</span>
          <span>Last Updated On: {record ? fmtDate(record.updatedAt) : '—'}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary assessment-card-action"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        <ActionIcon size={15} strokeWidth={2} />
        {actionLabel || primaryActionLabel(record)}
      </button>
    </div>
  );
}

export default AssessmentCard;
