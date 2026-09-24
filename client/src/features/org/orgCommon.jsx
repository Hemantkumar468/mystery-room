import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { CHART_COLORS } from '../../lib/ui.js';
import { TEAM_ROLE_LABEL } from '../../lib/opsUi.js';

/** The 8 colours offered for teams, categories and tags. */
export const SWATCHES = CHART_COLORS;

/** A token colour with a matching translucent background (works in both themes). */
export const tone = (color) => ({ color, soft: `color-mix(in srgb, ${color} 16%, transparent)` });

export const ROLE_TONE = {
  admin: tone('var(--danger)'),
  manager: tone('var(--warning)'),
  executor: tone('var(--info)'),
  viewer: tone('var(--text-muted)'),
};

export const TEAM_ROLE_TONE = {
  admin: tone('var(--danger)'),
  manager: tone('var(--warning)'),
  member: tone('var(--text-muted)'),
};

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'executor', label: 'Executor' },
  { value: 'viewer', label: 'Viewer' },
];

/** Current user + role helpers. */
export function useMe() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  return {
    user,
    id: user?.id || user?._id,
    role,
    isAdmin: role === 'admin',
    canCurate: role === 'admin' || role === 'manager',
  };
}

export const isForbidden = (err) => err?.response?.status === 403;

/** Value that settles `ms` after the last change (for search boxes). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function RoleBadge({ role }) {
  if (!role) return null;
  const t = ROLE_TONE[role] || ROLE_TONE.viewer;
  return <Badge color={t.color} soft={t.soft}>{role.charAt(0).toUpperCase() + role.slice(1)}</Badge>;
}

export function TeamRoleBadge({ role }) {
  const t = TEAM_ROLE_TONE[role] || TEAM_ROLE_TONE.member;
  return <Badge color={t.color} soft={t.soft} dot>{TEAM_ROLE_LABEL[role] || role}</Badge>;
}

export function ColorSwatches({ value, onChange, colors = SWATCHES, small = false }) {
  return (
    <div className={`swatches ${small ? 'sm' : ''}`} role="radiogroup" aria-label="Colour">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`swatch ${value === c ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/** Yes/no confirmation that runs an async `onConfirm`. */
export function ConfirmModal({ open, onClose, title, message, confirmLabel = 'Delete', danger = true, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      /* the caller already reported the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={run} disabled={busy}>
            {busy ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      }
    >
      <div className="sm muted">{message}</div>
    </Modal>
  );
}

/** Checkbox row with an optional hint underneath. */
export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="toggle-row" style={{ alignItems: 'flex-start', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span className="col">
        <span>{label}</span>
        {hint && <span className="tiny muted" style={{ fontWeight: 400 }}>{hint}</span>}
      </span>
    </label>
  );
}
