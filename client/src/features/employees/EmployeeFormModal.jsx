import { useState, useEffect } from 'react';
import { Eye, EyeOff, RefreshCw, Mail, Lock, User as UserIcon } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useCreateUser, useUpdateUser } from '../../lib/queries.js';
import { ROLE_META, DEPT_META, CHART_COLORS } from '../../lib/ui.js';

const BLANK = {
  name: '',
  email: '',
  password: '',
  role: 'executor',
  department: '',
  title: '',
  phone: '',
  avatarColor: CHART_COLORS[0],
};

/** Readable, paste-able password that clears the server's 8-char minimum. */
function suggestPassword() {
  const words = ['Mystery', 'Escape', 'Puzzle', 'Vault', 'Cipher', 'Riddle'];
  const word = words[Math.floor(Math.random() * words.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${word}@${digits}`;
}

export function EmployeeFormModal({ open, onClose, onSuccess, employee }) {
  const isEdit = !!employee?._id;
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const mutation = isEdit ? updateUser : createUser;

  const [form, setForm] = useState(BLANK);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError('');
    setShowPassword(false);
    setForm(
      isEdit
        ? {
            name: employee.name || '',
            email: employee.email || '',
            password: '', // blank means "leave the existing password alone"
            role: employee.role || 'executor',
            department: employee.department || '',
            title: employee.title || '',
            phone: employee.phone || '',
            avatarColor: employee.avatarColor || CHART_COLORS[0],
          }
        : { ...BLANK, password: suggestPassword() },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?._id]);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((p) => { const n = { ...p }; delete n[key]; return n; });
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim() || form.name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    // On edit an empty password means "unchanged"; on create it is required.
    if (!isEdit && form.password.length < 8) next.password = 'Password must be at least 8 characters.';
    if (isEdit && form.password && form.password.length < 8) next.password = 'Password must be at least 8 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;

    // `department` is an enum server-side — an empty string would be rejected,
    // so omit every blank optional rather than sending "".
    const body = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      avatarColor: form.avatarColor,
      ...(form.department ? { department: form.department } : {}),
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.password ? { password: form.password } : {}),
    };

    try {
      await mutation.mutateAsync(isEdit ? { id: employee._id, ...body } : body);
      onSuccess?.(body.name, isEdit);
      onClose();
    } catch (err) {
      const data = err.response?.data;
      if (Array.isArray(data?.details) && data.details.length) {
        setErrors(Object.fromEntries(data.details.map((d) => [d.field, d.message])));
      }
      setServerError(data?.message || err.message || 'Something went wrong.');
    }
  };

  const field = (key) =>
    errors[key] ? { borderColor: 'var(--danger)' } : {};

  const ErrorText = ({ name }) =>
    errors[name] ? (
      <span style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3, display: 'block' }}>
        {errors[name]}
      </span>
    ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={isEdit ? 'Edit Employee' : 'Add Employee'}
      subtitle={
        isEdit
          ? `Updating ${employee?.name}`
          : 'Create a login for a team member and set what they can do'
      }
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={mutation.isPending} style={{ minWidth: 130 }}>
            {mutation.isPending ? <span className="spinner" /> : (isEdit ? 'Save Changes' : 'Create Employee')}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="col gap-4">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="field">
            <label className="label">Full Name *</label>
            <div className="input-icon-wrap">
              <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Arjun Mehta" style={field('name')} required />
              <UserIcon className="input-icon" size={15} />
            </div>
            <ErrorText name="name" />
          </div>

          <div className="field">
            <label className="label">Email Address *</label>
            <div className="input-icon-wrap">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={set('email')}
                placeholder="name@mysteryrooms.in"
                autoComplete="off"
                style={field('email')}
                required
              />
              <Mail className="input-icon" size={15} />
            </div>
            <ErrorText name="email" />
          </div>
        </div>

        <div className="field">
          <label className="label">
            {isEdit ? 'New Password' : 'Password *'}
            <span className="tiny subtle" style={{ marginLeft: 6, fontWeight: 400 }}>
              {isEdit ? 'leave blank to keep the current password' : 'minimum 8 characters'}
            </span>
          </label>
          <div className="input-icon-wrap">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={set('password')}
              placeholder={isEdit ? '••••••••' : 'Set an initial password'}
              autoComplete="new-password"
              style={field('password')}
            />
            <Lock className="input-icon" size={15} />
            <button
              type="button"
              className="input-icon-trail"
              onClick={() => setShowPassword((s) => !s)}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="row between" style={{ marginTop: 4 }}>
            <ErrorText name="password" />
            <button
              type="button"
              className="row gap-1 tiny"
              onClick={() => { setForm((f) => ({ ...f, password: suggestPassword() })); setShowPassword(true); }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
            >
              <RefreshCw size={11} /> Suggest a password
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="field">
            <label className="label">Role *</label>
            <select className="select" value={form.role} onChange={set('role')}>
              {Object.entries(ROLE_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
            <span className="tiny muted" style={{ marginTop: 4, display: 'block' }}>
              {ROLE_META[form.role]?.hint}
            </span>
          </div>

          <div className="field">
            <label className="label">Department</label>
            <select className="select" value={form.department} onChange={set('department')}>
              <option value="">— None —</option>
              {Object.entries(DEPT_META).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <ErrorText name="department" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="field">
            <label className="label">Job Title</label>
            <input className="input" value={form.title} onChange={set('title')} placeholder="e.g. Expansion Lead" />
          </div>
          <div className="field">
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="e.g. 98xxxxxx01" />
          </div>
        </div>

        <div className="field">
          <label className="label">Avatar Colour</label>
          <div className="row gap-3" style={{ alignItems: 'center' }}>
            <span
              className="avatar"
              style={{ background: form.avatarColor, width: 34, height: 34, fontSize: 13 }}
            >
              {(form.name.trim() || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div className="row gap-2">
              {CHART_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
                  aria-label={`Avatar colour ${c}`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: c,
                    border: form.avatarColor === c ? '2px solid var(--text)' : '1px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                    boxSizing: 'content-box',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {serverError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              color: 'var(--danger)',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {serverError}
          </div>
        )}
      </form>
    </Modal>
  );
}

export default EmployeeFormModal;
