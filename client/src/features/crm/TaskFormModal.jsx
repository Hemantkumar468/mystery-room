import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useCreateCrmTask, useCrmOptions } from '../../app/api/crmApi.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { TimePicker } from '../../components/ui/TimePicker.jsx';

/**
 * Plan a follow-up.
 *
 * DEFAULTS THAT MATCH REALITY: tomorrow at 10am, typed as a call, reminded 30
 * minutes before. Those three are what most tasks are, so the common case is
 * one field — a title — and everything else is already right.
 *
 * The REMINDER IS AN OFFSET, not a time. Rescheduling a task has to move its
 * reminder with it, and an absolute instant silently detaches the moment the
 * due date changes — the reminder then fires for a time that no longer exists.
 */

/** Tomorrow at 10:00, as the two inputs need it. */
function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: '10:00',
  };
}

const REMINDERS = [
  { value: '', label: 'No reminder' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: 'A day before' },
];

export function TaskFormModal({
  open, onClose, onSaved, entityType, entityId, entityLabel,
}) {
  const create = useCreateCrmTask();
  const { data: options } = useCrmOptions();
  const { employees } = useEmployees();
  const user = useAppSelector(selectCurrentUser);
  // Only a manager may put work on somebody else — the server enforces it, and
  // offering a picker that always fails would be a trap.
  const isManager = can.manage?.(user?.role) ?? ['md', 'ea', 'manager'].includes(user?.role);

  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    const due = defaultDue();
    setForm({ type: 'call', reminderOffsetMinutes: 30, ...due });
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const dueAt = new Date(`${form.date}T${form.time || '10:00'}`);
    if (Number.isNaN(dueAt.getTime())) { setError('Pick a valid date and time.'); return; }

    try {
      const saved = await create.mutateAsync({
        title: form.title,
        notes: form.notes,
        type: form.type,
        dueAt: dueAt.toISOString(),
        reminderOffsetMinutes: form.reminderOffsetMinutes === '' ? null : Number(form.reminderOffsetMinutes),
        owner: form.owner || undefined,
        entityType,
        entityId,
        entityLabel,
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that task.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      width={500}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="crm-task-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add task'}
          </button>
        </div>
      )}
    >
      <form id="crm-task-form" onSubmit={submit} className="crm-form">
        {error && <div className="crm-form__error">{error}</div>}

        {entityLabel && (
          <p className="crm-muted">Against <strong>{entityLabel}</strong></p>
        )}

        <label className="crm-form__field">
          <span className="crm-form__label">What needs doing?<em aria-hidden> *</em></span>
          <input
            className="input" required autoFocus
            value={form.title ?? ''} onChange={(e) => set('title', e.target.value)}
            placeholder="Call about the revised quote"
          />
        </label>

        <div className="crm-form__pair">
          <label className="crm-form__field">
            <span className="crm-form__label">Type</span>
            {/* Typed rather than free-form: the mix is the diagnosis. Fifty
                calls and no demos is a different problem from five demos and
                no calls, and an untyped list cannot tell them apart. */}
            <select className="select" value={form.type ?? 'call'} onChange={(e) => set('type', e.target.value)}>
              {(options?.taskTypes || ['call']).map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>

          <label className="crm-form__field">
            <span className="crm-form__label">Reminder</span>
            <select
              className="select" value={form.reminderOffsetMinutes ?? ''}
              onChange={(e) => set('reminderOffsetMinutes', e.target.value)}
            >
              {REMINDERS.map((r) => <option key={String(r.value)} value={r.value}>{r.label}</option>)}
            </select>
          </label>
        </div>

        <div className="crm-form__pair">
          <label className="crm-form__field">
            <span className="crm-form__label">Due date<em aria-hidden> *</em></span>
            <input
              type="date" className="input" required
              value={form.date ?? ''} onChange={(e) => set('date', e.target.value)}
            />
          </label>
          <label className="crm-form__field">
            <span className="crm-form__label">Time</span>
            <TimePicker
              ariaLabel="Time"
              value={form.time ?? ''} onChange={(t) => set('time', t)}
            />
          </label>
        </div>

        {isManager && (
          <label className="crm-form__field">
            <span className="crm-form__label">Assign to</span>
            <select className="select" value={form.owner ?? ''} onChange={(e) => set('owner', e.target.value)}>
              <option value="">Me</option>
              {employees
                .filter((emp) => emp.systemRole !== 'viewer')
                .map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </label>
        )}

        <label className="crm-form__field">
          <span className="crm-form__label">Notes</span>
          <textarea
            className="input" rows={2} value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </form>
    </Modal>
  );
}

export default TaskFormModal;
