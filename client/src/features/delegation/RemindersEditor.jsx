import { Plus, Trash2 } from 'lucide-react';
import { REMINDER_UNITS } from '../../lib/opsUi.js';

export const newReminder = () => ({ value: 1, unit: 'days', trigger: 'before', channel: 'email' });

/** Rows of "N units before/after the due date, via in-app/email". */
export function RemindersEditor({ value = [], onChange }) {
  const update = (i, patch) => onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="col gap-2">
      {value.map((r, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="row gap-2 wrap">
          <input className="input" type="number" min={1} max={999} style={{ width: 80 }} value={r.value} onChange={(e) => update(i, { value: Number(e.target.value) || 1 })} />
          <select className="select" style={{ width: 110 }} value={r.unit} onChange={(e) => update(i, { unit: e.target.value })}>
            {REMINDER_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <select className="select" style={{ width: 150 }} value={r.trigger} onChange={(e) => update(i, { trigger: e.target.value })}>
            <option value="before">before the due date</option>
            <option value="after">after the due date</option>
          </select>
          <select className="select" style={{ width: 130 }} value={r.channel} onChange={(e) => update(i, { channel: e.target.value })}>
            <option value="email">In-app + email</option>
            <option value="in_app">In-app only</option>
          </select>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Remove reminder">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="row gap-3">
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => onChange([...value, newReminder()])} disabled={value.length >= 10}>
          <Plus size={14} /> Add reminder
        </button>
        {!value.length && <span className="tiny muted">None set — the doer still gets a nudge a day before and a chase a day after.</span>}
      </div>
    </div>
  );
}

export default RemindersEditor;
