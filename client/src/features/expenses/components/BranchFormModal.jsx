import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { CityCombobox } from '../../../components/ui/CityCombobox.jsx';
import { UserPicker } from '../../../components/ui/UserPicker.jsx';
import { useCreateBranch, useUpdateBranch } from '../../../app/api/branchesApi.js';
import { useProjects } from '../../../app/api/projectsApi.js';

const KIND_OPTIONS = [
  { value: 'store', label: 'Store' },
  { value: 'hq', label: 'HQ' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'other', label: 'Other' },
];

const EMPTY_FORM = {
  name: '', kind: 'store', city: '', address: '', costCenterCode: '',
  openedAt: '', manager: null, project: '', status: 'active',
};

/** Mirrors branch.service.js's generateBranchCode() exactly, so the preview
 * shown here is honest about what the server will actually assign — the
 * sequence number is never known until save, shown as ###. Same pattern
 * NewProjectModal.jsx already uses for Project.code. */
const KIND_PREFIX = { hq: 'HQ', warehouse: 'WH', other: 'OTH' };
function codePreview(city, kind) {
  const segment = city
    ? city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X')
    : (KIND_PREFIX[kind] || 'GEN');
  return `BR-${segment}-###`;
}

/**
 * Create/Edit Branch — one modal, one form, prefilled for edit. Code is
 * never an input here (server-generated, see branch.service.js); status is
 * only editable in edit mode (a brand-new branch is always created active).
 */
export function BranchFormModal({ open, onClose, branch }) {
  const isEdit = Boolean(branch);
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const { data: projectsResult } = useProjects({ limit: 200 });
  const projectOptions = projectsResult?.data || [];

  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setTouched({});
    setForm(branch ? {
      name: branch.name || '',
      kind: branch.kind || 'store',
      city: branch.city || '',
      address: branch.address || '',
      costCenterCode: branch.costCenterCode || '',
      openedAt: branch.openedAt ? branch.openedAt.slice(0, 10) : '',
      manager: branch.manager?._id || null,
      project: branch.project?._id || '',
      status: branch.status || 'active',
    } : EMPTY_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branch?._id]);

  const nameInvalid = touched.name && form.name.trim().length < 2;
  const canSubmit = form.name.trim().length >= 2;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) { setTouched((t) => ({ ...t, name: true })); return; }
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      city: form.city.trim() || undefined,
      address: form.address.trim() || undefined,
      costCenterCode: form.costCenterCode.trim() || undefined,
      openedAt: form.openedAt || undefined,
      manager: form.manager || undefined,
      project: form.project || undefined,
    };
    if (isEdit) {
      update.mutate({ id: branch._id, ...payload, status: form.status }, { onSuccess: onClose });
    } else {
      create.mutate(payload, { onSuccess: onClose });
    }
  };

  const pending = create.isPending || update.isPending;
  const error = create.error || update.error;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${branch.name}` : 'New Branch'}
      subtitle={isEdit ? branch.code : `Code will be generated as ${codePreview(form.city, form.kind)}`}
      width={560}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="branch-form" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Branch'}
          </button>
        </>
      )}
    >
      <form id="branch-form" className="col gap-3" onSubmit={handleSubmit}>
        {error && (
          <div className="sm" style={{ color: 'var(--danger)' }}>
            {error.response?.data?.message || error.message || 'Something went wrong'}
          </div>
        )}

        <label className="col gap-1">
          <span className="sm muted">Name *</span>
          <input
            className={`input${nameInvalid ? ' np-invalid' : ''}`}
            value={form.name}
            onChange={set('name')}
            onBlur={blur('name')}
            placeholder="e.g. Bhopal DB Mall"
          />
        </label>

        <div className="row gap-3">
          <label className="col gap-1" style={{ flex: 1 }}>
            <span className="sm muted">Kind</span>
            <select className="input" value={form.kind} onChange={set('kind')}>
              {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="col gap-1" style={{ flex: 1 }}>
            <span className="sm muted">City</span>
            <CityCombobox value={form.city} onChange={set('city')} />
          </label>
        </div>

        <label className="col gap-1">
          <span className="sm muted">Address</span>
          <input className="input" value={form.address} onChange={set('address')} placeholder="Optional" />
        </label>

        <div className="row gap-3">
          <label className="col gap-1" style={{ flex: 1 }}>
            <span className="sm muted">Cost Centre Code</span>
            <input className="input" value={form.costCenterCode} onChange={set('costCenterCode')} placeholder="Optional" />
          </label>
          <label className="col gap-1" style={{ flex: 1 }}>
            <span className="sm muted">Opened On</span>
            <input type="date" className="input" value={form.openedAt} onChange={set('openedAt')} />
          </label>
        </div>

        <label className="col gap-1">
          <span className="sm muted">Linked Project</span>
          <select className="input" value={form.project} onChange={set('project')}>
            <option value="">— Not linked to a project —</option>
            {projectOptions.map((p) => (
              <option key={p._id} value={p._id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </label>

        <label className="col gap-1">
          <span className="sm muted">Branch Manager</span>
          <UserPicker value={form.manager} onChange={(id) => setForm((f) => ({ ...f, manager: id }))} />
        </label>

        {isEdit && (
          <label className="col gap-1">
            <span className="sm muted">Status</span>
            <select className="input" value={form.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        )}
      </form>
    </Modal>
  );
}

export default BranchFormModal;
