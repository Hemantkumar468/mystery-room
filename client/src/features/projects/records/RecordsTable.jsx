import { ClipboardList, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { SectionCard, Badge, EmptyState } from '../../../components/ui/primitives.jsx';
import { fmtDate } from '../../../lib/format.js';
import { cardStatusMeta, submissionNoOf, remarksOf } from './recordUi.js';
import { StatusDropdown } from './StatusDropdown.jsx';
import { useIsMobile } from '../../../hooks/useBreakpoint.js';

const ellipsisCell = (maxWidth) => ({
  display: 'block',
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/**
 * Mobile (<768px) stand-in for one `<tr>` of RecordsTable — same data and
 * actions as the table row, stacked into a card instead of an 11-column row
 * that only ever fit a phone via horizontal scroll. Every prop mirrors the
 * conditional columns the table itself renders, so nothing shown/hidden in
 * the table is shown/hidden differently here.
 */
function RecordCard({
  record, index, records, assessmentTypes, showStatus, showReviewed, showReviewedBy,
  showApprovedOn, showScore, scoreFor, showAttachments, extraColumn, statusMetaFor, canDecide,
  decidePending, onView, onDecide, onEdit, onDelete,
}) {
  const type = assessmentTypes.find((t) => t.key === record.assessmentType);
  const smeta = showStatus ? (statusMetaFor ? statusMetaFor(record) : cardStatusMeta(record)) : null;
  const remarks = remarksOf(record);
  const showActions = !!(onEdit || onDelete);
  const score = showScore ? scoreFor?.(record) : null;

  return (
    <div className="card card-hover" style={{ cursor: 'pointer' }} onClick={() => onView(record)}>
      <div className="card-body col gap-2">
        <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="mono tiny subtle">#{index + 1} · Submission #{submissionNoOf(records, record)}</span>
            <span style={{ fontWeight: 650 }}>{type?.name || record.title}</span>
          </div>
          {smeta && (
            <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
              {onDecide ? (
                <StatusDropdown record={record} canDecide={canDecide} onDecide={onDecide} pending={decidePending} />
              ) : (
                <Badge color={smeta.color} soft={smeta.soft}>{smeta.label}</Badge>
              )}
            </span>
          )}
        </div>

        {extraColumn && (
          <div className="sm muted">{extraColumn.label}: {extraColumn.render(record) ?? '—'}</div>
        )}

        <div className="sm muted">
          {showReviewed ? 'Reviewed' : 'Submitted'} by {(showReviewed ? record.decidedBy?.name : record.submittedBy?.name) || '—'}
          {showReviewed
            ? record.decidedAt && ` · ${fmtDate(record.decidedAt)}`
            : record.submittedAt && ` · ${fmtDate(record.submittedAt)}`}
        </div>
        {!showReviewed && showReviewedBy && (
          <div className="sm muted">Reviewed by {record.decidedBy?.name || '—'}</div>
        )}
        {!showReviewed && showApprovedOn && record.approvedAt && (
          <div className="sm muted">Approved {fmtDate(record.approvedAt)}</div>
        )}
        {showScore && (
          <div className="sm muted">Score: {score != null ? `${score}/100` : '—'}</div>
        )}
        {remarks && <div className="sm">{remarks}</div>}
        {showAttachments && record.attachments?.length > 0 && (
          <div className="row gap-1 tiny muted" style={{ alignItems: 'center' }}>
            <Paperclip size={12} /> {record.attachments.length} attachment{record.attachments.length === 1 ? '' : 's'}
          </div>
        )}

        {showActions && (
          <div className="row gap-2" onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}>
            {onEdit && (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => onEdit(record)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent' }}
              >
                <Pencil size={11} /> Edit
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => onDelete(record)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent' }}
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The records table shared by every property-level workspace — one row per submission, newest first.
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
  showScore = false,
  scoreFor,
  extraColumn,
  statusMetaFor,
  emptyTitle = 'No records filed yet',
  emptyHint = 'Fill and submit a form above to see it here.',
  wrapClassName = '',
  onEdit,
  onDelete,
}) {
  const sorted = [...(records || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const showActions = !!(onEdit || onDelete);
  const isMobile = useIsMobile();

  return (
    <SectionCard title={title} subtitle={`${sorted.length} submissions filed`}>
      {sorted.length ? isMobile ? (
        <div className="col gap-2">
          {sorted.map((record, i) => (
            <RecordCard
              key={record._id}
              record={record}
              index={i}
              records={records}
              assessmentTypes={assessmentTypes}
              showStatus={showStatus}
              showReviewed={showReviewed}
              showReviewedBy={showReviewedBy}
              showApprovedOn={showApprovedOn}
              showScore={showScore}
              scoreFor={scoreFor}
              showAttachments={showAttachments}
              extraColumn={extraColumn}
              statusMetaFor={statusMetaFor}
              canDecide={canDecide}
              decidePending={decidePending}
              onView={onView}
              onDecide={onDecide}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
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
                {showScore && <th>Score</th>}
                <th>Remarks</th>
                {showAttachments && <th>Attachments</th>}
                {showActions && <th>Actions</th>}
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
                    {showScore && (
                      <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                        {(() => {
                          const score = scoreFor?.(record);
                          return score != null ? `${score}/100` : '—';
                        })()}
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
                    {showActions && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row gap-2">
                          {onEdit && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => onEdit(record)}
                              style={{
                                padding: '4px 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'transparent',
                              }}
                            >
                              <Pencil size={11} /> Edit
                            </button>
                          )}
                          {onDelete && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => onDelete(record)}
                              style={{
                                padding: '4px 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'transparent',
                              }}
                            >
                              <Trash2 size={11} /> Delete
                            </button>
                          )}
                        </div>
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
