import { useState } from 'react';
import { AlertTriangle, ThumbsDown } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useDecideProperty } from '../../app/api/propertyCaptureApi.js';

/**
 * "Not this one." — the other half of the Step 1 decision.
 *
 * WHY IT IS ITS OWN DIALOG rather than a third road on the Shortlist one. The
 * two answers are not the same shape: shortlisting asks a follow-up (which
 * road, which assessments), rejecting asks for a reason and nothing else.
 * Putting them together made the common answer carry a destructive option in
 * the same list of choices.
 *
 * THE REASON IS REQUIRED, and not as ceremony. "Why did we say no to that shop
 * in Agra?" is asked months later by whoever is looking at the next site in
 * the same market, and a rejected list with no reasons cannot answer it. The
 * server enforces this too — see propertyCapture.service.js#decide.
 */
export function PropertyRejectModal({ row, onClose, onDone }) {
  const decide = useDecideProperty();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const confirm = async () => {
    setError(null);
    if (!reason.trim()) { setError('Say why — a rejected property without a reason teaches nobody anything.'); return; }
    try {
      const result = await decide.mutateAsync({
        recordId: row.recordId,
        decision: 'reject',
        reason: reason.trim(),
      });
      onDone?.(result?.data || result);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not reject that property.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Reject this property'}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={decide.isPending} onClick={confirm}>
            {decide.isPending ? 'Saving…' : <><ThumbsDown size={14} /> Reject property</>}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        <p className="sm" style={{ margin: 0 }}>
          It comes off the queue and stays findable under “Rejected”, with this reason on it.
          Nothing is deleted.
        </p>

        <label className="pt-field">
          <span>Why is it a no? *</span>
          <textarea
            className="textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Rent above the model, first floor with no lift, landlord will not sign 9 years…"
            autoFocus
          />
        </label>
      </div>
    </Modal>
  );
}

export default PropertyRejectModal;
