import { useState } from 'react';
import { AlertTriangle, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useDecideProperty } from '../../app/api/propertyCaptureApi.js';

/**
 * The verdict after assessment: take this property forward, or take it off
 * the table.
 *
 * Shortlist moves it to Step 3, commercial closure. Reject requires a reason
 * and the field is not optional theatre — "why did we say no to that shop in
 * Agra?" is asked months later by whoever is looking at the next one, and an
 * empty reason makes the whole rejected list useless.
 *
 * Deciding before every assessment is in is ALLOWED, and deliberately: a site
 * that fails Feasibility outright should not need three more forms filled in
 * to be rejected. The warning below states what is still outstanding rather
 * than the button refusing the click.
 */
export function PropertyVerdictModal({ row, onClose, onDone }) {
  const decide = useDecideProperty();
  const [choice, setChoice] = useState(null); // 'shortlist' | 'reject'
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const pending = row.assessments.length - row.assessmentsFiled;

  const confirm = async () => {
    setError(null);
    if (!choice) { setError('Choose shortlist or reject.'); return; }
    if (choice === 'reject' && !reason.trim()) { setError('A rejected property needs a reason.'); return; }
    try {
      const result = await decide.mutateAsync({
        recordId: row.recordId,
        decision: choice,
        ...(choice === 'reject' ? { reason: reason.trim() } : {}),
      });
      onDone?.(result?.data || result);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not record that decision.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Assessment verdict'}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`btn ${choice === 'reject' ? 'btn-danger' : 'btn-primary'}`}
            disabled={decide.isPending || !choice}
            onClick={confirm}
          >
            {decide.isPending ? 'Saving…' : choice === 'reject' ? 'Reject property' : 'Shortlist for commercial'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {pending > 0 && (
          <div className="pt-alert">
            <AlertTriangle size={14} />
            {pending} of {row.assessments.length} assessments are still unfiled. You can still decide —
            a site that clearly fails does not need the rest completing first.
          </div>
        )}

        <p className="sm" style={{ margin: 0 }}>What is the verdict on this property?</p>

        <div className="prop-choice">
          <button
            type="button"
            className={`prop-choice-btn${choice === 'shortlist' ? ' active' : ''}`}
            onClick={() => setChoice('shortlist')}
          >
            <ThumbsUp size={18} />
            <b>Shortlist it</b>
            <span className="tiny muted">Moves to Step 3 — the LOI, lease, legal and deposits.</span>
          </button>
          <button
            type="button"
            className={`prop-choice-btn is-danger${choice === 'reject' ? ' active' : ''}`}
            onClick={() => setChoice('reject')}
          >
            <ThumbsDown size={18} />
            <b>Reject it</b>
            <span className="tiny muted">Off the table. The reason stays on the record.</span>
          </button>
        </div>

        {choice === 'reject' && (
          <label className="pt-field">
            <span>Why are we saying no?</span>
            <textarea
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Rent too high for the footfall, no three-phase power, landlord will not give a 9-year lock-in…"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}

export default PropertyVerdictModal;
