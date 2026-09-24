import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useCrmOptions } from '../../app/api/crmApi.js';

/**
 * Why was this deal lost?
 *
 * Opens when a card is dropped on a lost stage and HOLDS THE MOVE until it is
 * answered. That sequencing is the whole point: ask afterwards and every deal
 * closed by someone who then switched tabs has no reason at all, which is
 * precisely the set of deals you most want to understand.
 *
 * The reasons are a fixed list served by the server. Free text alone produces
 * a report nobody can group — "customer said no" restates the outcome instead
 * of explaining it. The notes box is where the specifics go, and it is
 * optional, because forcing prose is how you get "n/a" six hundred times.
 */
export function LostReasonModal({ open, deal, onCancel, onConfirm, pending }) {
  const { data: options } = useCrmOptions();
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) { setReason(''); setNotes(''); }
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    if (!reason) return;
    onConfirm({ lostReason: reason, lostNotes: notes.trim() || undefined });
  };

  return (
    <Modal
      open={open}
      // Cancelling must leave the card where it was, not in the lost column
      // with no reason. Nothing was sent, so there is no optimistic patch to
      // undo — the card simply never left. See DealBoardPage's onCancel.
      onClose={onCancel}
      title="Mark this deal as lost"
      width={460}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onCancel}>Keep it open</button>
          <button
            type="submit" form="crm-lost-reason" className="btn btn-primary"
            disabled={!reason || pending}
          >
            {pending ? 'Saving…' : 'Mark as lost'}
          </button>
        </div>
      )}
    >
      <form id="crm-lost-reason" onSubmit={submit} className="crm-form">
        {deal && (
          <p className="crm-muted">
            <strong>{deal.title}</strong>
            {deal.value ? ` · ₹${(deal.value / 100000).toFixed(1)}L` : ''}
          </p>
        )}

        <div className="crm-form__field">
          <span className="crm-form__label">Reason<em aria-hidden> *</em></span>
          {/* Radios, not a select: six options that a person must choose
              between deliberately, all visible at once. A closed dropdown
              invites picking whatever is first. */}
          <div className="crm-reasons">
            {(options?.lostReasons || []).map((r) => (
              <label key={r.value} className={`crm-reason ${reason === r.value ? 'is-on' : ''}`}>
                <input
                  type="radio" name="lostReason" value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="crm-form__field">
          <span className="crm-form__label">Anything worth remembering?</span>
          <textarea
            className="input" rows={3} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Who they went with, what number they wanted, when to try again…"
          />
        </label>
      </form>
    </Modal>
  );
}

export default LostReasonModal;
