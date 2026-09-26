import { useEffect, useMemo, useState } from 'react';
import { Search, Contact, Pencil, Headset, Crown } from 'lucide-react';
import { Avatar, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { FilterSelect } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { usePeople, useUpdatePerson, useBranches, useTeams } from '../../lib/opsQueries.js';
import { errMsg } from '../../lib/opsUi.js';
import { DEPT_META } from '../../lib/ui.js';
import { RoleBadge, ROLE_OPTIONS, Toggle, tone } from './orgCommon.jsx';

const DEPT_OPTIONS = Object.entries(DEPT_META).map(([value, label]) => ({ value, label }));
const COORD = tone('var(--info)');
const DIRECTOR = tone('var(--primary)');
const INACTIVE = tone('var(--text-subtle)');

/** Directory of everyone, with the ops work profile admins maintain. */
export function PeopleDirectory({ me }) {
  const [f, setF] = useState({ search: '', branch: '', department: '', role: '', team: '' });
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const { data: people, isLoading, isError, error } = usePeople({
    branch: f.branch || undefined,
    department: f.department || undefined,
    role: f.role || undefined,
    team: f.team || undefined,
    includeInactive: showInactive ? 'true' : undefined,
  });
  const { data: branchRes } = useBranches();
  const branches = branchRes?.data || [];
  const { data: teams = [] } = useTeams();

  const rows = useMemo(() => {
    const needle = f.search.trim().toLowerCase();
    if (!needle) return people || [];
    return (people || []).filter((p) =>
      `${p.name} ${p.email || ''} ${p.title || ''}`.toLowerCase().includes(needle),
    );
  }, [people, f.search]);

  return (
    <div className="col gap-4">
      <div className="card filter-bar">
        <div className="search-box">
          <Search size={15} className="subtle" />
          <input value={f.search} onChange={(e) => set('search')(e.target.value)} placeholder="Search name, email, title…" />
        </div>
        <FilterSelect label="Branch" value={f.branch} onChange={set('branch')} options={branches.map((b) => ({ value: b._id, label: `${b.name} (${b.code})` }))} />
        <FilterSelect label="Department" value={f.department} onChange={set('department')} options={DEPT_OPTIONS} />
        <FilterSelect label="Role" value={f.role} onChange={set('role')} options={ROLE_OPTIONS} width={130} />
        <FilterSelect label="Team" value={f.team} onChange={set('team')} options={teams.map((t) => ({ value: t._id, label: t.name }))} />
        {me.isAdmin && (
          <label className="toggle-row" style={{ height: 36 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        )}
        <span className="sm muted tabular" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          {people ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : ''}
        </span>
      </div>

      {isLoading ? (
        <SkTable rows={8} />
      ) : isError ? (
        <div className="card"><EmptyState icon={Contact} title="Couldn't load people" hint={errMsg(error)} /></div>
      ) : !rows.length ? (
        <div className="card"><EmptyState icon={Contact} title="No one matches" hint="Try clearing a filter." /></div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Title</th>
                <th>Role</th>
                <th>Department</th>
                <th>Branch</th>
                <th>Reports to</th>
                <th>Teams</th>
                <th>Flags</th>
                {me.isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p._id} style={p.isActive === false ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div className="row gap-3">
                      <Avatar name={p.name} color={p.avatarColor} size={32} />
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="nowrap" style={{ fontWeight: 600 }}>{p.name}</span>
                        <span className="tiny muted truncate">{p.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="sm">{p.title || <span className="subtle">—</span>}</td>
                  <td><RoleBadge role={p.role} /></td>
                  <td className="sm">{DEPT_META[p.department] || <span className="subtle">—</span>}</td>
                  <td className="sm nowrap">
                    {p.branch ? <>{p.branch.name} <span className="mono tiny subtle">{p.branch.code}</span></> : <span className="subtle">—</span>}
                  </td>
                  <td>
                    {p.reportingManager ? (
                      <span className="row gap-2 sm nowrap">
                        <Avatar name={p.reportingManager.name} color={p.reportingManager.avatarColor} size={20} />
                        {p.reportingManager.name}
                      </span>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td>
                    <div className="row gap-1 wrap" style={{ maxWidth: 240 }}>
                      {(p.teams || []).map((t) => (
                        <Badge key={t._id} color={t.color || '#6b7280'} dot>{t.name}</Badge>
                      ))}
                      {!p.teams?.length && <span className="subtle">—</span>}
                    </div>
                  </td>
                  <td>
                    <div className="row gap-1 wrap">
                      {p.opsFlags?.coordinator && <Badge color={COORD.color} soft={COORD.soft}><Headset size={11} /> Coordinator</Badge>}
                      {p.opsFlags?.director && <Badge color={DIRECTOR.color} soft={DIRECTOR.soft}><Crown size={11} /> Director</Badge>}
                      {p.isActive === false && <Badge color={INACTIVE.color} soft={INACTIVE.soft}>Inactive</Badge>}
                    </div>
                  </td>
                  {me.isAdmin && (
                    <td>
                      <button className="btn btn-ghost btn-sm nowrap" onClick={() => setEditing(p)} title="Edit work profile">
                        <Pencil size={14} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WorkProfileModal person={editing} branches={branches} onClose={() => setEditing(null)} />
    </div>
  );
}

const initProfile = (p) => ({
  branch: p?.branch?._id || '',
  reportingManager: p?.reportingManager?._id || '',
  department: p?.department || '',
  title: p?.title || '',
  coordinator: !!p?.opsFlags?.coordinator,
  director: !!p?.opsFlags?.director,
});

function WorkProfileModal({ person, branches, onClose }) {
  const [form, setForm] = useState(() => initProfile(person));
  const update = useUpdatePerson();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    setForm(initProfile(person));
  }, [person]);

  const submit = async () => {
    try {
      await update.mutateAsync({
        id: person._id,
        branch: form.branch || null,
        reportingManager: form.reportingManager || null,
        department: form.department || null,
        title: form.title.trim(),
        opsFlags: { coordinator: form.coordinator, director: form.director },
      });
      toast.success(`${person.name}'s work profile saved`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={!!person}
      onClose={onClose}
      title="Edit work profile"
      subtitle={person ? `${person.name} · ${person.email}` : ''}
      width={600}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={update.isPending}>
            {update.isPending ? <span className="spinner" /> : 'Save profile'}
          </button>
        </>
      }
    >
      {person && (
        <>
          <div className="form-grid">
            <div className="field">
              <label className="label">Branch</label>
              <select className="select" value={form.branch} onChange={(e) => set('branch')(e.target.value)}>
                <option value="">No branch (default)</option>
                {branches.map((b) => <option key={b._id} value={b._id}>{b.name} ({b.code})</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Department</label>
              <select className="select" value={form.department} onChange={(e) => set('department')(e.target.value)}>
                <option value="">—</option>
                {DEPT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Title</label>
              <input className="input" value={form.title} maxLength={120} onChange={(e) => set('title')(e.target.value)} placeholder="e.g. Game Master" />
            </div>
            <div className="field">
              <label className="label">Reporting manager</label>
              <PersonPicker value={form.reportingManager} onChange={set('reportingManager')} exclude={[person._id]} placeholder="No manager" />
            </div>
          </div>
          <div className="form-section col gap-3" style={{ marginBottom: 0 }}>
            <span className="eyebrow" style={{ marginBottom: 0 }}>Operations roles</span>
            <Toggle
              checked={form.coordinator}
              onChange={set('coordinator')}
              label="Operations coordinator"
              hint="Can log follow-up calls on the tasks they are included in."
            />
            <Toggle
              checked={form.director}
              onChange={set('director')}
              label="Director"
              hint="Receives 7-day overdue escalations."
            />
          </div>
        </>
      )}
    </Modal>
  );
}

export default PeopleDirectory;
