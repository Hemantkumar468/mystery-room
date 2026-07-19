import { ClipboardList, Paperclip } from 'lucide-react';
import { SectionCard, Badge, EmptyState } from '../../../components/ui/primitives.jsx';
import { fmtDate } from '../../../lib/format.js';
import { cardStatusMeta, submissionNoOf, remarksOf } from './recordUi.js';
import { StatusDropdown } from './StatusDropdown.jsx';

const ellipsisCell = (maxWidth) => ({
  display: 'block',
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/**
 * The records table shared by every property-level workspace (Site
 * Evaluation's Assessment Records, Commercial Finalization's Commercial
 * Records, Project Creation's Project Records, Department Planning's
 * Department Planning Records) — one row per submission, newest first, with
 * a Submission No. scoped to that row's own assessment type and a best-
 * effort Remarks column. Extracted here so the row markup, sorting and
 * numbering exist in exactly one place; each page just supplies its own
 * title/column label/type lookup.
 *
 * The whole row opens the record in RecordFormModal's read-only View mode
 * (`onView`) — clicking anywhere on it is the same action as before.
 *
 * The Status column is an enterprise inline-editable cell (StatusDropdown) —
 * click it to change the record's status directly, replacing the old
 * separate Approve/Reject action buttons entirely (Reject still requires a
 * reason, Approve still requires confirmation, both handled inside
 * StatusDropdown). Pass `onDecide(record, verb, extra)` to enable it — it
 * should call the page's `useRecordDecision` mutation; omitting it (Site
 * Evaluation's Assessment Records, a history/audit table with decisions made
 * from the Comparison Dashboard instead) falls back to a plain read-only
 * Badge. `showStatus` (default true) drops the Status column entirely —
 * Site Evaluation passes `showStatus={false}`. `statusMetaFor`, when given,
 * overrides the badge shown in that read-only fallback (Commercial
 * Finalization's own Submitted-vs-Draft-aware resolver) — StatusDropdown
 * itself always reads the record's own true status, since it's editing that
 * exact field.
 *
 * `showReviewed` and `extraColumn` are both optional, additive columns used
 * only by Approval Workflow so far — every other caller omits them and sees
 * no change. `showReviewed` adds "Reviewed By"/"Reviewed On" from the
 * record's own decision audit fields (decidedBy/decidedAt), *replacing*
 * Submitted On, distinct from who/when it was *submitted*. `extraColumn` is
 * a single generic `{ label, render(record) }` column inserted right after
 * the type column.
 *
 * `showReviewedBy`/`showApprovedOn`/`showAttachments` are a further set of
 * optional, additive columns (Store Launch so far) that sit alongside
 * Submitted On instead of replacing it — "Reviewed By" (decidedBy),
 * "Approved On" (approvedAt, blank on a rejected row) and an attachment
 * count. All default false, so every existing caller is unaffected.
 */
export function RecordsTable({
  title,
  typeColumnLabel = 'Assessment Type',
  records,
  assessmentTypes = [],
  canDecide,
  decidePending,
  onView,
  onDecide,
  showStatus = true,
  showReviewed = false,
  showReviewedBy = false,
  showApprovedOn = false,
  showAttachments = false,
  extraColumn,
  statusMetaFor,
  emptyTitle = 'No records filed yet',
  emptyHint = 'Fill and submit a form above to see it here.',
  wrapClassName = '',
}) {
  const sorted = [...(records || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <SectionCard title={title} subtitle={`${sorted.length} submissions filed`}>
      {sorted.length ? (
        <div className={wrapClassName} style={{ overflowX: 'auto' }}>
          <table className="table table-clickable">
            <thead>
              <tr>
                <th>No.</th>
                <th>{typeColumnLabel}</th>
                {extraColumn && <th>{extraColumn.label}</th>}
                <th>Submission No.</th>
                <th>Submitted By</th>
                {showReviewed && <th>Reviewed By</th>}
                {showReviewed && <th>Reviewed On</th>}
                {!showReviewed && <th>Submitted On</th>}
                {!showReviewed && showReviewedBy && <th>Reviewed By</th>}
                {!showReviewed && showApprovedOn && <th>Approved On</th>}
                {showStatus && <th>Status</th>}
                <th>Remarks</th>
                {showAttachments && <th>Attachments</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((record, i) => {
                const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                const smeta = showStatus ? (statusMetaFor ? statusMetaFor(record) : cardStatusMeta(record)) : null;
                const remarks = remarksOf(record);
                return (
                  <tr key={record._id} onClick={() => onView(record)}>
                    <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{i + 1}</td>
                    <td style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{type?.name || record.title}</td>
                    {extraColumn && (
                      <td style={{ whiteSpace: 'nowrap' }}>{extraColumn.render(record) ?? '—'}</td>
                    )}
                    <td style={{ whiteSpace: 'nowrap' }}>#{submissionNoOf(records, record)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.submittedBy?.name || '—'}</td>
                    {showReviewed && (
                      <td style={{ whiteSpace: 'nowrap' }}>{record.decidedBy?.name || '—'}</td>
                    )}
                    {showReviewed && (
                      <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{record.decidedAt ? fmtDate(record.decidedAt) : '—'}</td>
                    )}
                    {!showReviewed && (
                      <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{record.submittedAt ? fmtDate(record.submittedAt) : '—'}</td>
                    )}
                    {!showReviewed && showReviewedBy && (
                      <td style={{ whiteSpace: 'nowrap' }}>{record.decidedBy?.name || '—'}</td>
                    )}
                    {!showReviewed && showApprovedOn && (
                      <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{record.approvedAt ? fmtDate(record.approvedAt) : '—'}</td>
                    )}
                    {smeta && (
                      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {onDecide ? (
                          <StatusDropdown record={record} canDecide={canDecide} onDecide={onDecide} pending={decidePending} />
                        ) : (
                          <Badge color={smeta.color} soft={smeta.soft}>{smeta.label}</Badge>
                        )}
                      </td>
                    )}
                    <td style={{ maxWidth: 220 }}>
                      <span style={ellipsisCell(220)} title={remarks || undefined}>{remarks || '—'}</span>
                    </td>
                    {showAttachments && (
                      <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                        {record.attachments?.length ? (
                          <span className="row gap-1" style={{ alignItems: 'center', display: 'inline-flex' }}>
                            <Paperclip size={12} /> {record.attachments.length}
                          </span>
                        ) : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title={emptyTitle} hint={emptyHint} />
      )}
    </SectionCard>
  );
}

export default RecordsTable;
