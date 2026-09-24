import { Modal } from '../../components/ui/Modal.jsx';
import { fmtDate } from './propertyUi.jsx';

/**
 * WHERE A PROPERTY STANDS, IN ONE WORD.
 *
 * The DECISION leads, because that is the thing people are waiting on and the
 * thing that changes under them: a site sitting in Assessment that the MD has
 * just turned down is Rejected, not "In Review", and a queue that kept saying
 * In Review until some background stage moved would be telling yesterday's
 * news. `decision.state` is written by the same decide() call the MD screens
 * use, so this follows those the moment they happen.
 *
 * Stage is the fallback, for a property nobody has ruled on yet.
 *
 * Shared by Steps 1 and 2 so one property cannot be described two ways on two
 * screens — which is exactly what would happen the first time one copy of the
 * ladder was edited and the other was not.
 */
/** The class each status wears. The WORD comes from the server. */
const STATUS_CLASS = {
  rejected: 's-no',
  approved: 's-go',
  shortlisted: 's-done',
  commercial: 's-go',
  in_review: 's-go',
  draft: 's-wait',
  awaiting_review: 's-go',
  captured: 's-done',
  assigned: 's-wait',
  not_started: 's-wait',
};

export function rowStatus(r) {
  /**
   * THE SERVER'S ANSWER, WHERE THERE IS ONE.
   *
   * This ladder used to be the only one. It is now the server's too, because
   * the status filter has to run over the whole queue rather than over the page
   * the browser happens to hold - and two copies of a ladder is how a chip
   * comes to say one thing while the filter that claims to match it says
   * another. The local ladder stays as the fallback for rows that predate the
   * field, and for the places that build a row object by hand.
   */
  if (r.statusKey && STATUS_CLASS[r.statusKey]) {
    return { cls: STATUS_CLASS[r.statusKey], label: r.statusLabel || r.statusKey };
  }

  const d = r.decision?.state;
  if (d === 'rejected' || r.stage === 'rejected') return { cls: 's-no', label: 'Rejected' };
  if (d === 'approved') return { cls: 's-go', label: 'Approved' };
  if (d === 'shortlisted' || r.status === 'shortlisted') return { cls: 's-done', label: 'Shortlisted' };

  if (r.stage === 'commercial') return { cls: 's-go', label: 'In Commercial' };
  if (r.stage === 'assessment') return { cls: 's-go', label: 'In Review' };
  if (r.status === 'draft') return { cls: 's-wait', label: 'Draft' };
  if (r.status === 'awaiting_review' || r.status === 'submitted') return { cls: 's-go', label: 'Awaiting review' };
  if (r.filedAt || r.recordId) return { cls: 's-done', label: 'Captured' };
  if (r.capturePlan?.assignedNames?.length) return { cls: 's-wait', label: 'Assigned' };
  return { cls: 's-wait', label: 'Not Started' };
}

/**
 * The status chip, as something you can ask a question of.
 *
 * "Rejected" answers what happened and not why, and the why is the part
 * somebody rings up about. `stopPropagation` because the row underneath is
 * clickable too and opens something else entirely.
 */
export function StatusChip({ row, onWhy }) {
  const s = rowStatus(row);
  return (
    <button
      type="button"
      className="pc2-status-btn"
      title="Who decided this, when, and why"
      onClick={(e) => { e.stopPropagation(); onWhy(row); }}
    >
      <span className={`pc2-status ${s.cls}`}>{s.label}</span>
    </button>
  );
}

/** Who said so, when, and what they wrote. */
export function PropertyWhyStatusModal({ row, onClose }) {
  const s = rowStatus(row);
  const d = row.decision || {};
  return (
    <Modal
      open
      onClose={onClose}
      title="Why this status"
      subtitle={[row.title, row.city].filter(Boolean).join(' · ')}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="pc2-why">
        <div className="pc2-why-row">
          <span>
            <span className="pc2-why-k">Status</span>
            <span className={`pc2-status ${s.cls}`}>{s.label}</span>
          </span>
          <span>
            <span className="pc2-why-k">Decided by</span>
            <span className="pc2-why-v">{d.by || '—'}</span>
          </span>
          <span>
            <span className="pc2-why-k">Decided on</span>
            <span className="pc2-why-v">{d.at ? fmtDate(d.at) : '—'}</span>
          </span>
        </div>
        <div>
          <span className="pc2-why-k" style={{ marginBottom: 4 }}>Reason</span>
          <div className="pc2-why-reason">
            {d.reason
              ? d.reason
              : (
                /* Said plainly rather than left blank: "no reason" is itself
                   worth knowing when somebody is asking why. */
                <span className="pc2-why-none">
                  {d.state && d.state !== 'waiting'
                    ? 'No reason was recorded with this decision.'
                    : 'Nobody has decided on this property yet, so there is no reason to show.'}
                </span>
              )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default PropertyWhyStatusModal;
