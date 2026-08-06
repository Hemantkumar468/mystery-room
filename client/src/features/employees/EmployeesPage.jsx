import { useState, useEffect, useMemo } from 'react';
import {
  Users, Search, Pencil, Trash2, KeyRound, UserCheck, UserX, ShieldAlert, Plus,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Avatar, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  useUsers, useSetUserStatus, useDeleteUser, useResetUserPassword,
} from '../../app/api/usersApi.js';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { toastPushed } from '../../app/slices/notificationSlice.js';
import { ROLE_META, DEPT_META } from '../../lib/ui.js';
import { fmtDateTime } from '../../lib/format.js';
import { EmployeeFormModal } from './EmployeeFormModal.jsx';
import { can } from '../../lib/roles.js';

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Deactivated' },
];

/* ---------- Reset password ---------- */
function ResetPasswordModal({ employee, onClose, onDone }) {
  const reset = useResetUserPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setPassword(''); setError(''); }, [employee?._id]);
  if (!employee) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    try {
      await reset.mutateAsync({ id: employee._id, password });
      onDone(`Password reset for ${employee.name}.`);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={440}
      title="Reset Password"
      subtitle={`Set a new password for ${employee.name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={reset.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={reset.isPending} style={{ minWidth: 120 }}>
            {reset.isPending ? <span className="spinner" /> : 'Reset Password'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="col gap-3">
        <div className="field">
          <label className="label">New Password</label>
          <input
            className="input"
            type="text"
            autoFocus
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="Minimum 8 characters"
            style={error ? { borderColor: 'var(--danger)' } : {}}
          />
          {error && <span style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{error}</span>}
        </div>
        <p className="tiny muted" style={{ lineHeight: 1.6 }}>
          Share this password with {employee.name.split(' ')[0]} over a secure channel. They can sign in
          with it immediately — existing sessions are not signed out.
        </p>
      </form>
    </Modal>
  );
}

/* ---------- Destructive confirmations ---------- */
function ConfirmModal({ open, title, subtitle, body, confirmLabel, danger, onClose, onConfirm, isPending }) {
  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={isPending}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={isPending}
            style={{ minWidth: 120 }}
          >
            {isPending ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.6 }}>{body}</div>
    </Modal>
  );
}

export function EmployeesPage() {
  const currentUser = useAppSelector(selectCurrentUser);
  const isAdmin = can.administer(currentUser?.role);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [formTarget, setFormTarget] = useState(null); // employee | {} for "new"
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);

  const dispatch = useAppDispatch();
  const setStatus = useSetUserStatus();
  const deleteUser = useDeleteUser();

  // Keep the request off the critical path of every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Toast display/auto-dismiss now lives in the global ToastHost (uiSlice's
  // sibling notificationSlice) — this page just dispatches.
  const showToast = (text, type = 'success') =>
    dispatch(toastPushed({ kind: type === 'danger' ? 'error' : type, message: text }));

  const { data, isLoading } = useUsers({
    search: debounced || undefined,
    role: roleFilter || undefined,
    status: statusFilter || undefined,
  });
  const employees = useMemo(() => data || [], [data]);

  // Counts describe the whole directory, so derive them from an unfiltered read.
  const { data: allUsers } = useUsers({});
  const stats = useMemo(() => {
    const all = allUsers || [];
    return {
      total: all.length,
      active: all.filter((u) => u.isActive !== false).length,
      inactive: all.filter((u) => u.isActive === false).length,
      admins: all.filter((u) => can.administer(u.role)).length,
    };
  }, [allUsers]);

  const confirmStatus = async () => {
    try {
      const next = !(statusTarget.isActive !== false);
      await setStatus.mutateAsync({ id: statusTarget._id, isActive: next });
      showToast(`${statusTarget.name} ${next ? 'reactivated' : 'deactivated'}.`, next ? 'success' : 'danger');
      setStatusTarget(null);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status.', 'danger');
      setStatusTarget(null);
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteUser.mutateAsync(deleteTarget._id);
      showToast(`${deleteTarget.name} deleted.`, 'danger');
      setDeleteTarget(null);
    } catch (err) {
      // The server refuses to delete anyone still referenced by a project or task.
      showToast(err.response?.data?.message || 'Failed to delete employee.', 'danger');
      setDeleteTarget(null);
    }
  };

  const isSelf = (u) => String(u._id) === String(currentUser?._id || currentUser?.id);

  return (
    <>
      <Topbar
        title="Employees"
        subtitle="Everyone with access to the operations console"
        actions={
          isAdmin && (
            <button className="btn btn-primary row gap-1" onClick={() => setFormTarget({})}>
              <Plus size={15} /> Add Employee
            </button>
          )
        }
      />

      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          {/* Directory stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
            {[
              { label: 'Total Employees', value: stats.total, color: 'var(--text)' },
              { label: 'Active', value: stats.active, color: '#10b981' },
              { label: 'Deactivated', value: stats.inactive, color: '#7c7784' },
              { label: 'Admins', value: stats.admins, color: '#f43f5e' },
            ].map((s) => (
              <div key={s.label} className="card card-pad">
                <div className="tiny subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 650 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 26, fontWeight: 750, color: s.color, marginTop: 4 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="card card-pad">
            <div className="row between wrap gap-3">
              <div className="input-icon-wrap" style={{ flex: 1, minWidth: 240, maxWidth: 380 }}>
                <input
                  className="input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email or job title…"
                />
                <Search className="input-icon" size={15} />
              </div>

              <div className="row gap-3 wrap">
                <div className="row gap-1">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.key || 'all'}
                      className={`chip ${statusFilter === f.key ? 'active' : ''}`}
                      onClick={() => setStatusFilter(f.key)}
                      style={{ cursor: 'pointer', border: '1px solid var(--border)' }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <select
                  className="select"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  style={{ width: 'auto', minWidth: 130 }}
                >
                  <option value="">All roles</option>
                  {Object.entries(ROLE_META).map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Directory */}
          <div className="card">
            {isLoading ? (
              <div className="card-body"><SkTable rows={6} /></div>
            ) : !employees.length ? (
              <EmptyState
                icon={Users}
                title={debounced || roleFilter || statusFilter ? 'No employees match those filters' : 'No employees yet'}
                hint={
                  debounced || roleFilter || statusFilter
                    ? 'Try clearing the search or filters.'
                    : isAdmin ? 'Add your first team member to get started.' : 'Ask an admin to add you.'
                }
                action={
                  isAdmin && !debounced && !roleFilter && !statusFilter ? (
                    <button className="btn btn-primary" onClick={() => setFormTarget({})}>+ Add Employee</button>
                  ) : null
                }
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Role</th>
                      <th>Department</th>
                      <th>Status</th>
                      <th>Last Login</th>
                      {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((u) => {
                      const active = u.isActive !== false;
                      const role = ROLE_META[u.role] || { label: u.role, color: '#6b7280' };
                      const self = isSelf(u);
                      return (
                        <tr key={u._id} style={{ opacity: active ? 1 : 0.55 }}>
                          <td>
                            <div className="row gap-3">
                              <Avatar name={u.name} color={u.avatarColor} size={34} />
                              <div className="col" style={{ minWidth: 0 }}>
                                <span className="row gap-2" style={{ fontWeight: 650 }}>
                                  {u.name}
                                  {self && (
                                    <span className="tiny subtle" style={{ fontWeight: 600 }}>(you)</span>
                                  )}
                                </span>
                                <span className="tiny muted">{u.email}</span>
                                {u.title && <span className="tiny subtle">{u.title}</span>}
                              </div>
                            </div>
                          </td>
                          <td><Badge color={role.color} dot>{role.label}</Badge></td>
                          <td className="sm muted">{DEPT_META[u.department] || '—'}</td>
                          <td>
                            <Badge color={active ? '#10b981' : '#7c7784'} dot>
                              {active ? 'Active' : 'Deactivated'}
                            </Badge>
                          </td>
                          <td className="sm muted">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Never'}</td>

                          {isAdmin && (
                            <td>
                              <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  title="Edit employee"
                                  onClick={() => setFormTarget(u)}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  title="Reset password"
                                  onClick={() => setResetTarget(u)}
                                >
                                  <KeyRound size={14} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  title={self ? 'You cannot deactivate your own account' : (active ? 'Deactivate' : 'Reactivate')}
                                  disabled={self}
                                  onClick={() => setStatusTarget(u)}
                                  style={{ color: active ? 'var(--text-subtle)' : '#10b981' }}
                                >
                                  {active ? <UserX size={14} /> : <UserCheck size={14} />}
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  title={self ? 'You cannot delete your own account' : 'Delete employee'}
                                  disabled={self}
                                  onClick={() => setDeleteTarget(u)}
                                  style={{ color: 'var(--text-subtle)' }}
                                  onMouseEnter={(e) => { if (!self) e.currentTarget.style.color = 'var(--danger)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-subtle)'; }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!isAdmin && (
            <p className="row gap-2 tiny muted">
              <ShieldAlert size={13} />
              Only admins can add, edit or deactivate employees.
            </p>
          )}
        </div>
      </div>

      {/* Create / edit */}
      <EmployeeFormModal
        open={!!formTarget}
        employee={formTarget?._id ? formTarget : null}
        onClose={() => setFormTarget(null)}
        onSuccess={(name, wasEdit) =>
          showToast(wasEdit ? `${name} updated.` : `${name} added — they can sign in now.`)
        }
      />

      {/* Reset password */}
      {resetTarget && (
        <ResetPasswordModal
          employee={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={showToast}
        />
      )}

      {/* Deactivate / reactivate */}
      <ConfirmModal
        open={!!statusTarget}
        danger={statusTarget?.isActive !== false}
        title={statusTarget?.isActive !== false ? 'Deactivate Employee' : 'Reactivate Employee'}
        subtitle={statusTarget?.name}
        confirmLabel={statusTarget?.isActive !== false ? 'Deactivate' : 'Reactivate'}
        isPending={setStatus.isPending}
        onClose={() => setStatusTarget(null)}
        onConfirm={confirmStatus}
        body={
          statusTarget?.isActive !== false ? (
            <>
              <strong>{statusTarget?.name}</strong> will no longer be able to sign in, and their
              existing session ends on the next request. Their projects, tasks and history stay intact,
              and you can reactivate them at any time.
            </>
          ) : (
            <>
              <strong>{statusTarget?.name}</strong> will be able to sign in again with their existing
              password.
            </>
          )
        }
      />

      {/* Delete */}
      <ConfirmModal
        open={!!deleteTarget}
        danger
        title="Delete Employee"
        subtitle="This action cannot be undone"
        confirmLabel="Delete"
        isPending={deleteUser.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        body={
          <>
            Permanently delete <strong>{deleteTarget?.name}</strong>&apos;s account?
            <p className="sm muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
              If they own projects or are assigned tasks, the delete is refused — deactivate them
              instead so their history stays readable.
            </p>
          </>
        }
      />
    </>
  );
}

export default EmployeesPage;
