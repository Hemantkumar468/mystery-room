import { Modal } from '../../components/ui/Modal.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { decisionOnly } from './propertyUi.jsx';
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
  /* AMBER, NOT INDIGO. "In Commercial" is the stage where the five closure
     documents are outstanding — it is the queue the "Documents Pending"
     tile counts. Sharing a colour with In Review made the two stages
     indistinguishable at a glance on a sheet where telling them apart is
     the point: one is being judged, the other is waiting on paperwork. */
  commercial: 's-docs',
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
 * The status chip — a question only where there is an answer.
 *
 * "Rejected" says what happened and not why, and the why is the part somebody
 * rings up about, so the chip can be asked. But it was ALWAYS a button, on
 * every row of every step, including the ones nobody has ruled on yet — and
 * pressing one of those opened a dialog whose entire content was that it had
 * nothing to tell you: "Nobody has decided on this property yet, so there is
 * no reason to show." A control that opens to say it has nothing should not
 * have been a control.
 *
 * So it is a plain label unless a decision was actually recorded against the
 * row, and on the pages that pass no `onWhy` at all it is always plain. The
 * wrapper carried no padding, border or font of its own, so a chip that loses
 * it sits exactly where it did.
 *
 * `stopPropagation` because the row underneath is clickable too and opens
 * something else entirely.
 */
export function StatusChip({ row, onWhy }) {
  /**
   * WHOSE STATUS IS THIS, THOUGH.
   *
   * The full ladder is the MD's view of the pipeline. Anybody who cannot
   * decide sees the verdict only — see `decisionOnly`. Read from the store
   * here rather than threaded through every caller, so a new table cannot
   * forget to ask and leak the stage by omission.
   */
  const user = useAppSelector(selectCurrentUser);
  const full = can.manage(user?.role);
  const s = full ? rowStatus(row) : decisionOnly(row);
  const d = row.decision || {};

  /* Nothing decided yet, and not the MD's screen: the column stays empty
     rather than inventing a word for "we have not answered you". */
  if (!s) return null;

  const chip = <span className={`pc2-status ${s.cls}`}>{s.label}</span>;

  /* A decision somebody made, not merely a status the ladder computed. */
  const hasAnswer = Boolean(d.reason || d.by || d.at);
  if (!onWhy || !hasAnswer) return chip;

  return (
    <button
      type="button"
      className="pc2-status-btn"
      title="Who decided this, when, and why"
      onClick={(e) => { e.stopPropagation(); onWhy(row); }}
    >
      {chip}
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
