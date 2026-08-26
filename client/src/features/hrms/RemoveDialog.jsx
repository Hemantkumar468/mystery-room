/**
 * "Remove this, and say why."
 *
 * Both HRMS deletes are soft deletes that REQUIRE a reason on the server, so
 * a plain confirm() would have produced a request the API rejects. One dialog
 * for both, because the second copy is where the two drift: one asks for a
 * reason, the other stops bothering, and the audit trail quietly develops a
 * hole nobody notices until they need it.
 *
 * `consequence` is the sentence about what this actually does to everything
 * else. It is a required prop on purpose — a delete dialog that does not say
 * what it takes with it is the reason people click Cancel and go ask someone.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';

export function RemoveDialog({
  open, onClose, title, consequence, confirmLabel = 'Remove', onConfirm, busy,
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err?.data?.message || 'Could not remove this');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="col gap-3" onSubmit={submit}>
        <p className="hrms-remove-warn">
          <AlertTriangle size={15} aria-hidden />
          <span>{consequence}</span>
        </p>

        <label className="col gap-1">
          <span className="label">Why are you removing it? *</span>
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Kept on the record. Anyone looking for this later sees your reason instead of an empty gap."
          />
          <span className="tiny muted">
            Nothing is erased — it stops appearing in the lists and stays recoverable.
          </span>
        </label>

        {error && <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p>}

        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Keep it</button>
          <button type="submit" className="btn btn-danger" disabled={busy || reason.trim().length < 3}>
            {busy ? 'Removing…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default RemoveDialog;
