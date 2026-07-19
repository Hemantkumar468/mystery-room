import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal.jsx';

/**
 * Shared confirmation dialog for rejecting a record — requires a reason.
 * Used by both the Property Records table and the Property Detail page so the
 * reject flow (and its validation) lives in exactly one place.
 */
export function RejectDialog({ open, title, onClose, onConfirm, pending, placeholder }) {
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  if (!open) return null;

  const confirm = () => {
    if (!reason.trim()) return;
    onConfirm(reason.trim(), remarks.trim());
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={!reason.trim() || pending}>
            Reject
          </button>
        </div>
      }
    >
      <div className="col gap-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Reject Reason <span style={{ color: 'var(--danger)' }}>*</span></label>
          <textarea
            className="textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Reviewer Remarks (optional)</label>
          <textarea
            className="textarea"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Any additional context for this decision…"
          />
        </div>
      </div>
    </Modal>
  );
}

export default RejectDialog;
