import { useEffect, useMemo, useState } from 'react';
import { Plus, Building2, Star, MapPin, Pencil, Power, Users, Store, Warehouse, Landmark } from 'lucide-react';
import '../../styles/ops-org.css';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { Kpi } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useBranches, useSaveBranch, usePeople } from '../../lib/opsQueries.js';
import { BRANCH_TYPE_LABEL, errMsg } from '../../lib/opsUi.js';
import { useMe, ConfirmModal, Toggle, tone } from './orgCommon.jsx';
import { useAccess } from '../../hooks/useAccess.js';

const TYPE_TONE = {
  headquarters: tone('var(--primary)'),
  regional_office: tone('var(--info)'),
  outlet: tone('var(--success)'),
  warehouse: tone('var(--text-muted)'),
};
const TYPE_ICON = { headquarters: Landmark, regional_office: Building2, outlet: Store, warehouse: Warehouse };
const CODE_RX = /^[A-Za-z0-9-]{2,12}$/;

export function BranchesPage() {
  const access = useAccess();
  const me = useMe();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // branch | {} for new
  const [toggling, setToggling] = useState(null);
  const { data: res, isLoading, isError, error } = useBranches(showInactive ? { includeInactive: 'true' } : undefined);
  const { data: people } = usePeople();
  const save = useSaveBranch();

  const branches = useMemo(
    () =>
      [...(res?.data || [])].sort(
        (a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.isActive !== false) - Number(a.isActive !== false) || a.name.localeCompare(b.name),
      ),
    [res],
  );
  const headcount = useMemo(() => {
    const m = {};
    (people || []).forEach((p) => {
      if (p.branch?._id) m[p.branch._id] = (m[p.branch._id] || 0) + 1;
    });
    return m;
  }, [people]);

  const active = branches.filter((b) => b.isActive !== false);
  const unassigned = (people || []).filter((p) => !p.branch).length;

  const toggleActive = async () => {
    const b = toggling;
    try {
      await save.mutateAsync({ _id: b._id, isActive: b.isActive === false });
      toast.success(b.isActive === false ? `${b.name} reactivated` : `${b.name} deactivated`);
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };

  return (
    <>
      <Topbar
        title="Branches"
        subtitle="Work is partitioned headquarters-wise — every task, checklist and scoreboard belongs to a branch, and people see their own branch by default."
        actions={
          <div className="row gap-2">
            <label className="toggle-row nowrap">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            {me.isAdmin && (
              <button className="btn btn-primary" onClick={() => setEditing({})}>
                <Plus size={16} /> New branch
              </button>
            )}
          </div>
        }
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          {!isLoading && !isError && (
            <div className="kpi-row">
              <Kpi label="Active branches" value={active.length} />
              <Kpi label="Headquarters" value={active.filter((b) => b.type === 'headquarters').length} color="var(--gold-400)" />
              <Kpi label="Outlets" value={active.filter((b) => b.type === 'outlet').length} color="var(--success)" />
              <Kpi label="People without a branch" value={people ? unassigned : '—'} color="var(--warning)" hint="They fall back to the default branch" />
            </div>
          )}

          {isLoading ? (
            <div className="branch-grid">
              {Array.from({ length: 4 }).map((_, i) => <SkBlock key={i} h={200} />)}
            </div>
          ) : isError ? (
            <div className="card"><EmptyState icon={Building2} title="Couldn't load branches" hint={errMsg(error)} /></div>
          ) : !branches.length ? (
            <div className="card">
              <EmptyState
                icon={Building2}
                title="No branches yet"
                hint="Create your headquarters first, then add outlets and offices."
                action={me.isAdmin && <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New branch</button>}
              />
            </div>
          ) : (
            <div className="branch-grid">
              {branches.map((b) => (
                <BranchCard
                  key={b._id}
                  branch={b}
                  people={headcount[b._id] || 0}
                  /* Role rule AND the Access Control row — the server applies
                     both, so the pencil must not outlive either. */
                  canEdit={me.isAdmin && access.step('org-branches', 'edit')}
                  onEdit={() => setEditing(b)}
                  onToggle={() => setToggling(b)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <BranchModal branch={editing} onClose={() => setEditing(null)} />
      <ConfirmModal
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={toggling?.isActive === false ? 'Reactivate branch?' : 'Deactivate branch?'}
        message={
          toggling?.isActive === false
            ? `${toggling?.name} will be selectable again for people, tasks and checklists.`
            : `${toggling?.name} will be hidden from pickers and the branch switcher. Existing tasks and history are kept.`
        }
        confirmLabel={toggling?.isActive === false ? 'Reactivate' : 'Deactivate'}
        danger={toggling?.isActive !== false}
        onConfirm={toggleActive}
      />
    </>
  );
}

function BranchCard({ branch: b, people, canEdit, onEdit, onToggle }) {
  const inactive = b.isActive === false;
  const t = TYPE_TONE[b.type] || TYPE_TONE.outlet;
  const Icon = TYPE_ICON[b.type] || Building2;
  return (
    <div className={`card branch-card ${inactive ? 'inactive' : ''}`}>
      <div className="card-body">
        <div className="row between gap-3">
          <div className="row gap-3" style={{ minWidth: 0 }}>
            <span className="icon-tile" style={{ background: t.soft, color: t.color }}><Icon size={19} /></span>
            <div className="col" style={{ minWidth: 0 }}>
              <div className="row gap-2">
                <span className="truncate" style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</span>
                {b.isDefault && <Star size={15} className="default-star" aria-label="Default branch" />}
              </div>
              <span className="mono tiny muted">{b.code}</span>
            </div>
          </div>
          {inactive ? (
            <Badge color="var(--text-subtle)" soft="var(--surface-hover)">Inactive</Badge>
          ) : (
            <Badge color="var(--success)" soft="var(--success-soft)" dot>Active</Badge>
          )}
        </div>

        <div className="row gap-2 wrap">
          <Badge color={t.color} soft={t.soft}>{BRANCH_TYPE_LABEL[b.type] || b.type || 'Branch'}</Badge>
          {b.isDefault && <Badge color="var(--gold-400)" soft="color-mix(in srgb, var(--gold-400) 16%, transparent)">Default</Badge>}
        </div>

        <div className="col gap-1 sm muted" style={{ flex: 1 }}>
          <span className="row gap-2"><MapPin size={14} /> {b.city || 'City not set'}</span>
          {b.address && <span className="tiny" style={{ paddingLeft: 22 }}>{b.address}</span>}
          <span className="row gap-2"><Users size={14} /> {people} {people === 1 ? 'person' : 'people'}</span>
        </div>

        {canEdit && (
          <div className="row gap-2 team-foot">
            <button className="btn btn-subtle btn-sm" onClick={onEdit}><Pencil size={14} /> Edit</button>
            {b.isDefault ? (
              <span className="hint-wrap" title="The default branch can't be deactivated — make another branch the default first.">
                <button className="btn btn-ghost btn-sm" disabled><Power size={14} /> Deactivate</button>
              </span>
            ) : (
              <button className={`btn btn-ghost btn-sm ${inactive ? '' : 'danger-text'}`} onClick={onToggle}>
                <Power size={14} /> {inactive ? 'Reactivate' : 'Deactivate'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const initBranch = (b) => ({
  name: b?.name || '',
  code: b?.code || '',
  type: b?.type || 'outlet',
  city: b?.city || '',
  address: b?.address || '',
  isDefault: !!b?.isDefault,
});

function BranchModal({ branch, onClose }) {
  const open = !!branch;
  const isEdit = !!branch?._id;
  const [form, setForm] = useState(() => initBranch(branch));
  const save = useSaveBranch();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (branch) setForm(initBranch(branch));
  }, [branch]);

  const codeOk = CODE_RX.test(form.code.trim());
  const valid = form.name.trim().length >= 2 && codeOk;

  const submit = async () => {
    if (!valid) return;
    const body = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      type: form.type,
      city: form.city.trim(),
      address: form.address.trim(),
      isDefault: form.isDefault,
    };
    try {
      await save.mutateAsync(isEdit ? { _id: branch._id, ...body } : body);
      toast.success(isEdit ? 'Branch updated' : `Branch ${body.name} created`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit branch' : 'New branch'}
      subtitle={isEdit ? `${branch.name} · ${branch.code}` : 'Headquarters, regional office, outlet or warehouse'}
      width={600}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || save.isPending}>
            {save.isPending ? <span className="spinner" /> : isEdit ? 'Save changes' : 'Create branch'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label className="label">Name <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input className="input" autoFocus value={form.name} maxLength={120} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Pune — Koregaon Park" />
        </div>
        <div className="field">
          <label className="label">Code <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            className="input mono"
            value={form.code}
            maxLength={12}
            onChange={(e) => set('code')(e.target.value.toUpperCase())}
            placeholder="e.g. PUN-01"
          />
          <span className={`tiny ${form.code && !codeOk ? 'danger-text' : 'muted'}`}>2–12 letters, numbers or dashes.</span>
        </div>
        <div className="field">
          <label className="label">Type</label>
          <select className="select" value={form.type} onChange={(e) => set('type')(e.target.value)}>
            {Object.entries(BRANCH_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">City</label>
          <input className="input" value={form.city} maxLength={80} onChange={(e) => set('city')(e.target.value)} placeholder="e.g. Pune" />
        </div>
        <div className="field span-2">
          <label className="label">Address</label>
          <textarea className="textarea" value={form.address} maxLength={300} onChange={(e) => set('address')(e.target.value)} style={{ minHeight: 64 }} />
        </div>
        <div className="span-2">
          <Toggle
            checked={form.isDefault}
            onChange={set('isDefault')}
            disabled={isEdit && branch.isDefault}
            label="Make this the default branch"
            hint={
              isEdit && branch.isDefault
                ? 'This is the default branch. To change it, make another branch the default.'
                : 'People without a branch — and new records — fall back to the default branch.'
            }
          />
        </div>
      </div>
    </Modal>
  );
}

export default BranchesPage;
