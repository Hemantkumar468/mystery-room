import { AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';

/**
 * "You have items left — still want to finish?" asked once, in one wording.
 *
 * An unticked checklist used to REFUSE the completion: the button walked the
 * person to the checklist and stopped, and the server backed it up with
 * CHECKLIST_INCOMPLETE. That strands whoever's work is actually done but has a
 * box that cannot be ticked — an item that turned out not to apply, or one
 * somebody else handled. The checklist is a record of the work, not its
 * gatekeeper, so the decision belongs to the doer and this only makes sure it
 * is a decision rather than an accident.
 *
 * Shared by Task Detail and My Tasks because both complete a task, and a
 * warning that reads differently depending on which button you pressed is a
 * warning people learn to distrust. Only ever rendered when something is
 * pending — a fully ticked checklist completes with no dialog at all.
 *
 * @param {{label: string, required?: boolean}[]} items  the unticked items
 * @param onConfirm  proceed — the caller runs the completion
 * @param onCancel   go back — the caller may point at the checklist instead
 */
export function ChecklistWarningModal({
  open, items = [], taskTitle, busy = false, onConfirm, onCancel,
}) {
  if (!open) return null;
  const n = items.length;

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      width={520}
      title="Checklist items are still incomplete"
      subtitle={taskTitle}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Go Back
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Complete Task Anyway'}
          </button>
        </>
      }
    >
      <div className="col gap-3">
        {/* Informational, not an error: warning tone, and it says what will
            happen rather than what went wrong. */}
        <div className="checklist-warn-note">
          <AlertTriangle size={16} />
          <span>
            {n === 1
              ? 'One checklist item has not been marked as complete.'
              : `${n} checklist items have not been marked as complete.`}
            {' '}You can still complete this task, but please note that
            {n === 1 ? ' it' : ' they'} will remain pending.
          </span>
        </div>

        <div className="col gap-1">
          <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Still pending
          </span>
          <ul className="checklist-warn-list">
            {items.map((c, i) => (
              // Labels are free text and can repeat, so the index is part of
              // the key — a duplicate label must not collapse two rows.
              <li key={`${c.label}-${i}`}>
                {c.label}
                {c.required && <span className="tiny muted"> · required</span>}
              </li>
            ))}
          </ul>
        </div>

        <span className="tiny muted">
          These items stay unticked and visible on the task, so they can be finished
          or reviewed after completion.
        </span>
      </div>
    </Modal>
  );
}

export default ChecklistWarningModal;
