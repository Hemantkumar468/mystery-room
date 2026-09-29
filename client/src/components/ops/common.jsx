import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Badge } from '../ui/primitives.jsx';
import { DLG_STATUS_META, CHK_STATUS_META, errMsg } from '../../lib/opsUi.js';
import { toast } from './toast.jsx';

export function DlgStatusBadge({ value, dot = true }) {
  const m = DLG_STATUS_META[value] || { label: value, color: '#6b7280' };
  return <Badge color={m.color} soft={m.soft} dot={dot}>{m.label}</Badge>;
}

export function ChkStatusBadge({ value, dot = true }) {
  const m = CHK_STATUS_META[value] || { label: value, color: '#6b7280' };
  return <Badge color={m.color} soft={m.soft} dot={dot}>{m.label}</Badge>;
}

/** Pill-style segmented control. */
export function Segmented({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={value === o.value}
            className={`seg-btn ${value === o.value ? 'active' : ''}`}
            onClick={() => onChange(o.value)}
            title={o.title || o.label}
          >
            {Icon && <Icon size={14} />}
            {o.label && <span>{o.label}</span>}
            {o.count !== undefined && <span className="seg-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact labelled select for filter bars. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All', width = 150 }) {
  return (
    <label className="filter-select" style={{ minWidth: width }}>
      <span className="tiny subtle upper">{label}</span>
      <select className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Modal that asks for a (usually mandatory) reason/remark and runs `onSubmit(text)`.
 * Used for send-back, reopen, non-functional, simple remarks…
 */
export function ReasonModal({ open, onClose, title, subtitle, label = 'Reason', placeholder, required = true, confirmLabel = 'Save', danger = false, onSubmit, children }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // `onSubmit` may return false (or throw) to signal failure — the modal then
  // stays open so nothing typed is lost.
  const submit = async () => {
    if (required && !text.trim()) return;
    setBusy(true);
    try {
      const ok = await onSubmit(text.trim());
      if (ok !== false) {
        setText('');
        onClose();
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy || (required && !text.trim())}>
            {busy ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      }
    >
      {children}
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
        <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      </div>
    </Modal>
  );
}

/** Small key/value row for detail panels. */
export function Meta({ icon: Icon, label, children }) {
  return (
    <div className="row between meta-row">
      <span className="row gap-2 muted sm">{Icon && <Icon size={14} />} {label}</span>
      <span className="sm" style={{ fontWeight: 600, textAlign: 'right' }}>{children ?? '—'}</span>
    </div>
  );
}

/** Mini KPI tile used across ops pages (clickable to filter). */
export function Kpi({ label, value, color = 'var(--primary)', active, onClick, hint }) {
  return (
    <button type="button" className={`kpi ${active ? 'active' : ''} ${onClick ? 'clickable' : ''}`} style={{ '--kpi': color }} onClick={onClick}>
      <span className="kpi-value tabular">{value ?? '—'}</span>
      <span className="kpi-label">{label}</span>
      {hint && <span className="tiny subtle">{hint}</span>}
    </button>
  );
}
