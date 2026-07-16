import { Modal } from '../../../components/ui/Modal.jsx';

/**
 * Generic yes/no confirmation modal — built the same way RejectDialog wraps
 * Modal. First use: the enterprise Status dropdown (StatusDropdown.jsx)
 * requires confirmation before applying an Approved decision.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', onClose, onConfirm, pending }) {
  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="sm muted" style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}

export default ConfirmDialog;
