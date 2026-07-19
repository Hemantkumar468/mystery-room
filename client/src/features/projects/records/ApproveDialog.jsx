import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal.jsx';

/**
 * Confirmation dialog for approving a property at Site Evaluation — mirrors
 * RejectDialog.jsx's shape (same Modal, same footer layout) but remarks are
 * optional and there's no required reason, since approving needs no
 * justification the way rejecting does.
 */
export function ApproveDialog({ open, title, onClose, onConfirm, pending }) {
  const [remarks, setRemarks] = useState('');
  if (!open) return null;

  const confirm = () => onConfirm(remarks.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: 'var(--success)', borderColor: 'transparent' }}
            onClick={confirm}
            disabled={pending}
          >
            {pending ? <span className="spinner" /> : 'Approve'}
          </button>
        </div>
      }
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Approval Remarks (optional)</label>
        <textarea
          className="textarea"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Any additional context for this approval…"
        />
      </div>
    </Modal>
  );
}

export default ApproveDialog;
