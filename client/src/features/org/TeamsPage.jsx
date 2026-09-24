import { useEffect, useState } from 'react';
import { Plus, Users, Contact, Building2, ChevronRight, Pencil, Trash2, UserPlus, X } from 'lucide-react';
import '../../styles/ops-org.css';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Avatar, AvatarStack, EmptyState } from '../../components/ui/primitives.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { Segmented, Meta } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useTeams,
  useSaveTeam,
  useDeleteTeam,
  useUpsertTeamMember,
  useRemoveTeamMember,
  useBranches,
} from '../../lib/opsQueries.js';
import { TEAM_ROLE_LABEL, errMsg } from '../../lib/opsUi.js';
import { useMe, ColorSwatches, ConfirmModal, TeamRoleBadge, SWATCHES } from './orgCommon.jsx';
import { PeopleDirectory } from './PeopleDirectory.jsx';

const TEAM_ROLES = Object.entries(TEAM_ROLE_LABEL).map(([value, label]) => ({ value, label }));

export function TeamsPage() {
  const me = useMe();
  const [tab, setTab] = useState('teams');
  const [creating, setCreating] = useState(false);
  const { data: teams } = useTeams();

  return (
    <>
      <Topbar
        title="Teams & People"
        subtitle="Who works where, who reports to whom, and the teams that get the work done"
        actions={
          me.isAdmin && tab === 'teams' ? (
            <div className="row gap-2">
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> New team
              </button>
            </div>
          ) : null
        }
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          <div>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'teams', label: 'Teams', icon: Users, count: teams?.length },
                { value: 'people', label: 'People directory', icon: Contact },
              ]}
            />
          </div>
          {tab === 'teams' ? <TeamsTab me={me} onCreate={() => setCreating(true)} /> : <PeopleDirectory me={me} />}
        </div>
      </div>
      <TeamFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Teams grid                                                          */
/* ------------------------------------------------------------------ */

function TeamsTab({ me, onCreate }) {
  const { data: teams, isLoading, isError, error } = useTeams();
  const [openId, setOpenId] = useState(null);
  const openTeam = (teams || []).find((t) => t._id === openId);

  if (isLoading) {
    return (
      <div className="team-grid">
        {Array.from({ length: 6 }).map((_, i) => <SkBlock key={i} h={190} />)}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="card">
        <EmptyState icon={Users} title="Couldn't load teams" hint={errMsg(error)} />
      </div>
    );
  }
  if (!teams?.length) {
    return (
      <div className="card">
        <EmptyState
          icon={Users}
          title="No teams yet"
          hint="Teams group people for task delegation, reporting lines and team leaderboards."
          action={me.isAdmin && <button className="btn btn-primary" onClick={onCreate}><Plus size={16} /> New team</button>}
        />
      </div>
    );
  }

  return (
    <>
      <div className="team-grid">
        {teams.map((t) => <TeamCard key={t._id} team={t} onOpen={() => setOpenId(t._id)} />)}
      </div>
      <TeamDetailModal team={openTeam} onClose={() => setOpenId(null)} me={me} />
    </>
  );
}

function TeamCard({ team, onOpen }) {
  const color = team.color || 'var(--primary)';
  const members = team.members || [];
  const leads = members.filter((m) => m.role !== 'member' && m.user).map((m) => m.user.name);
  return (
    <div
      className="card card-hover team-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="team-accent" style={{ background: color }} />
      <div className="card-body">
        <div className="row between gap-3">
          <div className="row gap-3" style={{ minWidth: 0 }}>
            <span className="icon-tile" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
              <Users size={19} />
            </span>
            <div className="col" style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 700, fontSize: 15 }}>{team.name}</div>
              <div className="tiny muted row gap-1">
                <Building2 size={12} />
                {team.branch ? `${team.branch.name} · ${team.branch.code}` : 'All branches'}
              </div>
            </div>
          </div>
          <ChevronRight size={16} className="subtle" />
        </div>
        <p className="sm muted team-desc">{team.description || 'No description yet.'}</p>
        {leads.length > 0 && <div className="tiny muted truncate">Led by {leads.join(', ')}</div>}
        <div className="row between team-foot">
          <AvatarStack people={members.map((m) => m.user).filter(Boolean)} max={5} />
          <span className="sm muted tabular">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team detail: members + actions                                      */
/* ------------------------------------------------------------------ */

function TeamDetailModal({ team, onClose, me }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(null);
  const upsert = useUpsertTeamMember();
  const remove = useRemoveTeamMember();
  const del = useDeleteTeam();

  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setRemoving(null);
  }, [team?._id]);

  if (!team) return null;

  const members = team.members || [];
  const myRole = members.find((m) => m.user?._id === me.id)?.role;
  const canEdit = me.isAdmin || myRole === 'manager' || myRole === 'admin';
  const memberIds = members.map((m) => m.user?._id).filter(Boolean);
  const childOpen = editing || confirmDelete || !!removing;

  const updateMember = async (m, patch) => {
    try {
      await upsert.mutateAsync({
        teamId: team._id,
        user: m.user._id,
        role: m.role,
        reportsTo: m.reportsTo?._id || null,
        ...patch,
      });
      toast.success(`${m.user.name} updated`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const removeMember = async () => {
    try {
      await remove.mutateAsync({ teamId: team._id, userId: removing.user._id });
      toast.success(`${removing.user.name} removed from ${team.name}`);
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };

  const deleteTeam = async () => {
    try {
      await del.mutateAsync(team._id);
      toast.success(`Team “${team.name}” deleted`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };

  return (
    <>
      <Modal
        open={!childOpen}
        onClose={onClose}
        width={900}
        title={
          <span className="row gap-2">
            <span className="color-dot" style={{ background: team.color || 'var(--primary)' }} />
            {team.name}
          </span>
        }
        subtitle={team.description}
        footer={
          <div className="row between full">
            <div>
              {me.isAdmin && (
                <button className="btn btn-ghost danger-text" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} /> Delete team
                </button>
              )}
            </div>
            <div className="row gap-2">
              {canEdit && (
                <button className="btn btn-subtle" onClick={() => setEditing(true)}>
                  <Pencil size={15} /> Edit team
                </button>
              )}
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        }
      >
        <div className="col gap-4">
          <div className="row gap-5 wrap">
            <div style={{ minWidth: 220 }}>
              <Meta icon={Building2} label="Branch">{team.branch ? `${team.branch.name} (${team.branch.code})` : 'All branches'}</Meta>
            </div>
            <div style={{ minWidth: 180 }}>
              <Meta icon={Users} label="Members">{members.length}</Meta>
            </div>
          </div>

          <div className="card table-wrap">
            {members.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Title</th>
                    <th>Team role</th>
                    <th>Reports to</th>
                    {canEdit && <th style={{ width: 44 }} />}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <MemberRow
                      key={m.user?._id || m.addedAt}
                      m={m}
                      members={members}
                      canEdit={canEdit}
                      busy={upsert.isPending}
                      onChange={(patch) => updateMember(m, patch)}
                      onRemove={() => setRemoving(m)}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={Users} title="No members yet" hint={canEdit ? 'Add the first person below.' : undefined} />
            )}
          </div>

          {canEdit && <AddMemberForm team={team} exclude={memberIds} members={members} />}
        </div>
      </Modal>

      <TeamFormModal open={editing} onClose={() => setEditing(false)} team={team} />
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete team?"
        message={`“${team.name}” and its reporting lines will be removed. People keep their accounts and tasks.`}
        confirmLabel="Delete team"
        onConfirm={deleteTeam}
      />
      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove member?"
        message={removing ? `${removing.user?.name} will no longer be part of ${team.name}.` : ''}
        confirmLabel="Remove"
        onConfirm={removeMember}
      />
    </>
  );
}

function MemberRow({ m, members, canEdit, busy, onChange, onRemove }) {
  const u = m.user || {};
  const others = members.filter((x) => x.user && x.user._id !== u._id);
  return (
    <tr>
      <td>
        <div className="row gap-3">
          <Avatar name={u.name} color={u.avatarColor} size={30} />
          <div className="col" style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{u.name || 'Unknown'}</span>
            <span className="tiny muted truncate">{u.email}</span>
          </div>
        </div>
      </td>
      <td className="sm muted">{u.title || '—'}</td>
      <td>
        {canEdit ? (
          <select className="select select-sm" value={m.role} disabled={busy} onChange={(e) => onChange({ role: e.target.value })}>
            {TEAM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        ) : (
          <TeamRoleBadge role={m.role} />
        )}
      </td>
      <td>
        {canEdit ? (
          <select
            className="select select-sm"
            value={m.reportsTo?._id || ''}
            disabled={busy}
            onChange={(e) => onChange({ reportsTo: e.target.value || null })}
          >
            <option value="">—</option>
            {others.map((o) => <option key={o.user._id} value={o.user._id}>{o.user.name}</option>)}
          </select>
        ) : (
          <span className="sm">{m.reportsTo?.name || '—'}</span>
        )}
      </td>
      {canEdit && (
        <td>
          <button className="btn btn-ghost btn-icon btn-sm" title="Remove from team" onClick={onRemove}>
            <X size={15} />
          </button>
        </td>
      )}
    </tr>
  );
}

function AddMemberForm({ team, exclude, members }) {
  const [user, setUser] = useState('');
  const [role, setRole] = useState('member');
  const [reportsTo, setReportsTo] = useState('');
  const upsert = useUpsertTeamMember();

  const add = async () => {
    if (!user) return;
    try {
      await upsert.mutateAsync({ teamId: team._id, user, role, reportsTo: reportsTo || null });
      toast.success('Member added');
      setUser('');
      setRole('member');
      setReportsTo('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="form-section" style={{ marginBottom: 0 }}>
      <span className="eyebrow">Add a member</span>
      <div className="add-member">
        <div className="field">
          <label className="label">Person</label>
          <PersonPicker value={user} onChange={setUser} exclude={exclude} placeholder="Pick someone…" />
        </div>
        <div className="field">
          <label className="label">Team role</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {TEAM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Reports to</label>
          <select className="select" value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
            <option value="">—</option>
            {members.filter((m) => m.user).map((m) => <option key={m.user._id} value={m.user._id}>{m.user.name}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={add} disabled={!user || upsert.isPending}>
          {upsert.isPending ? <span className="spinner" /> : <><UserPlus size={15} /> Add</>}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit team                                                  */
/* ------------------------------------------------------------------ */

const initTeam = (team) => ({
  name: team?.name || '',
  description: team?.description || '',
  color: team?.color || SWATCHES[0],
  branch: team?.branch?._id || '',
  members: [],
});

function TeamFormModal({ open, onClose, team }) {
  const isEdit = !!team;
  const [form, setForm] = useState(() => initTeam(team));
  const save = useSaveTeam();
  const { data: branchRes } = useBranches();
  const branches = branchRes?.data || [];
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open) setForm(initTeam(team));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team?._id]);

  const valid = form.name.trim().length >= 2;

  const submit = async () => {
    if (!valid) return;
    const base = { name: form.name.trim(), description: form.description.trim(), color: form.color };
    const body = isEdit
      ? { _id: team._id, ...base, branch: form.branch || null }
      : {
          ...base,
          ...(form.branch ? { branch: form.branch } : {}),
          members: form.members.map((u) => ({ user: u, role: 'member' })),
        };
    try {
      await save.mutateAsync(body);
      toast.success(isEdit ? 'Team updated' : `Team “${base.name}” created`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit team' : 'New team'}
      subtitle={isEdit ? team.name : 'Group people who work together'}
      width={600}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || save.isPending}>
            {save.isPending ? <span className="spinner" /> : isEdit ? 'Save changes' : 'Create team'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label className="label">Name <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input className="input" autoFocus value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Pune Game Masters" maxLength={120} />
        </div>
        <div className="field span-2">
          <label className="label">Description</label>
          <textarea className="textarea" value={form.description} onChange={(e) => set('description')(e.target.value)} maxLength={500} placeholder="What does this team do?" />
        </div>
        <div className="field">
          <label className="label">Branch</label>
          <select className="select" value={form.branch} onChange={(e) => set('branch')(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b._id} value={b._id}>{b.name} ({b.code})</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Colour</label>
          <ColorSwatches value={form.color} onChange={set('color')} />
        </div>
        {!isEdit && (
          <div className="field span-2" style={{ marginBottom: 0 }}>
            <label className="label">Initial members</label>
            <PersonPicker multiple value={form.members} onChange={set('members')} placeholder="Add people (optional)…" />
            <span className="tiny muted">Everyone joins as a member — promote managers from the team page.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default TeamsPage;
