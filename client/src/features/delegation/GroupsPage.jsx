import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Users, ArrowLeft, ArrowRight, Pencil, Trash2, FolderKanban } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar, AvatarStack, EmptyState, SectionCard } from '../../components/ui/primitives.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { Segmented } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useGroups, useGroup, useSaveGroup, useDeleteGroup, useBranches } from '../../lib/opsQueries.js';
import { useAuthStore } from '../../store/authStore.js';
import { errMsg } from '../../lib/opsUi.js';
import { drawers } from '../../store/drawerStore.js';
import { useOpsStore } from '../../store/opsStore.js';
import { TaskExplorer } from './TaskExplorer.jsx';
import { TaskFormModal } from './TaskFormModal.jsx';

const SWATCHES = ['#6E45FF', '#14B8A6', '#F5A623', '#F43F5E', '#38BDF8', '#10B981', '#8B5CF6', '#EC4899'];

function GroupModal({ open, onClose, group }) {
  const save = useSaveGroup();
  const { data: branchRes } = useBranches();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open) {
      setF({
        name: group?.name || '',
        description: group?.description || '',
        color: group?.color || SWATCHES[0],
        branch: group?.branch?._id || '',
        members: (group?.members || []).map((m) => m._id),
      });
    }
  }, [open, group]);
  if (!f) return null;
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const submit = async () => {
    try {
      await save.mutateAsync({ ...(group ? { _id: group._id } : {}), ...f, branch: f.branch || null });
      toast.success(group ? 'Group updated' : 'Group created');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group ? 'Edit group' : 'New group'}
      subtitle="Tasks can be filed under a group; people still see only the tasks they are on"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={save.isPending || f.name.trim().length < 2}>{save.isPending ? <span className="spinner" /> : 'Save'}</button>
        </>
      }
    >
      <div className="field"><label className="label">Name</label><input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Pune launch war-room" /></div>
      <div className="field"><label className="label">Description</label><textarea className="textarea" value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
      <div className="form-grid">
        <div className="field">
          <label className="label">Colour</label>
          <div className="row gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: f.color === c ? '3px solid var(--text)' : '2px solid var(--surface)', boxShadow: 'var(--shadow-1)' }} />
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label">Branch</label>
          <select className="select" value={f.branch} onChange={(e) => set({ branch: e.target.value })}>
            <option value="">Any branch</option>
            {(branchRes?.data || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Members</label>
        <PersonPicker multiple value={f.members} onChange={(members) => set({ members })} placeholder="Add people — you're included automatically" />
      </div>
    </Modal>
  );
}

function GroupDetail({ id }) {
  const navigate = useNavigate();
  const branch = useOpsStore((s) => s.branch);
  const user = useAuthStore((s) => s.user);
  const { data: group, isLoading } = useGroup(id);
  const remove = useDeleteGroup();
  const [tab, setTab] = useState('tasks');
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = group && (user?.role === 'admin' || group.createdBy?._id === (user?.id || user?._id));

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate('/delegation/groups')}><ArrowLeft size={16} /></button>
            <span className="badge-dot" style={{ background: group?.color, width: 12, height: 12 }} />
            {group?.name || 'Group'}
          </span>
        }
        subtitle={group?.description || `${group?.members?.length || 0} members`}
        actions={
          <div className="row gap-2">
            <BranchSwitcher />
            {canManage && <button className="btn btn-ghost btn-icon" title="Edit group" onClick={() => setEditing(true)}><Pencil size={16} /></button>}
            {canManage && <button className="btn btn-ghost btn-icon" title="Delete group" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button>}
            {user?.role !== 'viewer' && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Group task</button>}
          </div>
        }
      />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          {isLoading ? <SkBlock h={420} /> : (
            <>
              <Segmented value={tab} onChange={setTab} options={[{ value: 'tasks', label: 'Tasks', icon: FolderKanban }, { value: 'members', label: 'Members', icon: Users, count: group?.members?.length }]} />
              {tab === 'tasks' && <TaskExplorer key={id} baseParams={{ group: id }} hideFilters={['group']} emptyHint="No tasks in this group yet." />}
              {tab === 'members' && (
                <SectionCard title="Members" subtitle={`Created by ${group?.createdBy?.name || '—'}`}>
                  <div className="col gap-3">
                    {(group?.members || []).map((m) => (
                      <div
                        key={m._id}
                        className="row gap-3 row-link"
                        style={{ padding: '6px 8px', borderRadius: 'var(--radius)' }}
                        title={`Open ${m.name}'s tasks in this group`}
                        onClick={() =>
                          drawers.drill({
                            kind: 'delegation',
                            label: `${m.name} — ${group.name}`,
                            description: 'Every task this member owns in the group.',
                            params: { group: id, doer: m._id, branch: branch || undefined, status: 'all' },
                          })
                        }
                      >
                        <Avatar name={m.name} color={m.avatarColor} />
                        <div className="col grow"><span style={{ fontWeight: 600 }}>{m.name}</span><span className="tiny muted">{m.title || m.email}</span></div>
                        <ArrowRight size={14} className="subtle" />
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
      <GroupModal open={editing} onClose={() => setEditing(false)} group={group} />
      <TaskFormModal open={creating} onClose={() => setCreating(false)} defaults={{ group: id, inLoop: [] }} />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this group?"
        subtitle="Its tasks are kept — they simply won't belong to a group any more."
        width={460}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync(id);
                  toast.success('Group deleted');
                  navigate('/delegation/groups');
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            >
              Delete group
            </button>
          </>
        }
      >
        <p className="sm">{group?.name}</p>
      </Modal>
    </>
  );
}

export function GroupsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const { data: groups = [], isLoading } = useGroups();
  const [creating, setCreating] = useState(false);

  if (id) return <GroupDetail id={id} />;

  return (
    <>
      <Topbar
        title="Groups"
        subtitle="File related tasks under a group — each person sees only the group tasks they are part of"
        actions={role !== 'viewer' && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New group</button>}
      />
      <div className="content">
        <div className="content-narrow fade-in">
          {isLoading ? <SkBlock h={240} /> : !groups.length ? (
            <div className="card"><EmptyState icon={Users} title="No groups yet" hint="Create one for a launch, an outlet crew or a project war-room." /></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
              {groups.map((g) => (
                <div key={g._id} className="card card-pad card-hover col gap-3" onClick={() => navigate(`/delegation/groups/${g._id}`)} style={{ borderTop: `3px solid ${g.color}` }}>
                  <div className="row between">
                    <span className="section-title">{g.name}</span>
                    {g.branch && <span className="chip chip-sm">{g.branch.code}</span>}
                  </div>
                  {g.description && <span className="sm muted">{g.description}</span>}
                  <div className="row between">
                    <AvatarStack people={g.members} max={5} />
                    <span className="tiny muted">{g.members.length} member(s)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <GroupModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export default GroupsPage;
