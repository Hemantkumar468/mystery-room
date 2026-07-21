import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Plus, X, Paperclip, Link2, Users, CalendarClock, CheckSquare,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { MarkDoneButton } from '../../components/ui/MarkDoneButton.jsx';
import { SectionCard, Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useTemplate, useStageRecords, useUsers,
  useTasks, useCreateTask, useCompleteStage, useUploadMedia,
} from '../../lib/queries.js';
import { fmtDate } from '../../lib/format.js';
import { PRIORITY_META, TASK_STATUS_META } from '../../lib/ui.js';
import { approvedTypeCount, propertyNo } from './records/recordUi.js';
import { InfoTile, tileGrid } from './StageOverviewParts.jsx';

const EXEC_STAGE = 'p6'; // allocated tasks are the execution-phase tasks

/* ─── Allocate Task modal ─────────────────────────────────────────────── */
function AllocateTaskModal({ open, onClose, projectId, departments, presetDept, onCreate, creating }) {
  const empty = { title: '', description: '', department: presetDept || '', assignee: '', watchers: [], priority: 'medium', dueDate: '', checklist: [], links: [], attachments: [] };
  const [form, setForm] = useState(empty);
  const [newItem, setNewItem] = useState('');
  const [newLink, setNewLink] = useState({ label: '', url: '' });
  const upload = useUploadMedia();

  // Re-seed the department when opened from a specific card.
  useEffect(() => { if (open) setForm((f) => ({ ...f, department: presetDept || f.department })); }, [presetDept, open]);

  const users = useUsers(form.department ? { department: form.department } : {});
  const people = users.data || [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addItem = () => { if (newItem.trim()) { setForm((f) => ({ ...f, checklist: [...f.checklist, { label: newItem.trim() }] })); setNewItem(''); } };
  const addLink = () => { if (newLink.url.trim()) { setForm((f) => ({ ...f, links: [...f.links, { label: newLink.label.trim(), url: newLink.url.trim() }] })); setNewLink({ label: '', url: '' }); } };
  const toggleWatcher = (uid) => setForm((f) => ({ ...f, watchers: f.watchers.includes(uid) ? f.watchers.filter((w) => w !== uid) : [...f.watchers, uid] }));

  const onFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      try {
        const ref = await upload.mutateAsync({ file });
        setForm((f) => ({ ...f, attachments: [...f.attachments, { ...ref, originalName: file.name, mimetype: file.type, bytes: file.size }] }));
      } catch { /* ignore a single failed upload */ }
    }
  };

  const submit = async () => {
    const payload = {
      stageKey: EXEC_STAGE,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      department: form.department || undefined,
      assignee: form.assignee || undefined,
      watchers: form.watchers,
      priority: form.priority,
      plannedEnd: form.dueDate || undefined,
      checklist: form.checklist,
      links: form.links,
      attachments: form.attachments,
    };
    await onCreate(payload);
    setForm(empty);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Allocate Task"
      subtitle="Delegate work to a department and/or a specific doer"
      width={640}
      footer={
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={creating || !form.title.trim() || !form.department}>
            {creating ? <span className="spinner" /> : 'Assign Task'}
          </button>
        </div>
      }
    >
      <div className="col gap-3">
        <div className="field">
          <label className="label">Task Title *</label>
          <input className="input" value={form.title} onChange={set('title')} placeholder="e.g. Finalise civil contractor & BOQ" />
        </div>
        <div className="field">
          <label className="label">Description</label>
          <textarea className="textarea" rows={2} value={form.description} onChange={set('description')} placeholder="What needs to be done…" />
        </div>

        <div className="row gap-3 wrap">
          <div className="field grow" style={{ minWidth: 180 }}>
            <label className="label">Department *</label>
            <select className="select" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value, assignee: '' }))}>
              <option value="">Select department…</option>
              {departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </div>
          <div className="field grow" style={{ minWidth: 180 }}>
            <label className="label">Assign to (doer)</label>
            <select className="select" value={form.assignee} onChange={set('assignee')} disabled={!form.department}>
              <option value="">Department only (unassigned)</option>
              {people.map((u) => <option key={u._id} value={u._id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
            </select>
          </div>
        </div>

        <div className="row gap-3 wrap">
          <div className="field grow" style={{ minWidth: 150 }}>
            <label className="label">Priority</label>
            <select className="select" value={form.priority} onChange={set('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="field grow" style={{ minWidth: 150 }}>
            <label className="label">Deadline</label>
            <input className="input" type="date" value={form.dueDate} onChange={set('dueDate')} />
          </div>
        </div>

        {/* Buddy / CC */}
        {form.department && people.length > 0 && (
          <div className="field">
            <label className="label"><Users size={13} /> Buddy / CC (kept in the loop)</label>
            <div className="row wrap gap-2">
              {people.filter((u) => u._id !== form.assignee).map((u) => (
                <button
                  key={u._id}
                  type="button"
                  className={`btn btn-sm ${form.watchers.includes(u._id) ? 'btn-primary' : 'btn-subtle'}`}
                  onClick={() => toggleWatcher(u._id)}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Checklist */}
        <div className="field">
          <label className="label"><CheckSquare size={13} /> Checklist</label>
          <div className="col gap-1">
            {form.checklist.map((c, i) => (
              <div key={i} className="row gap-2" style={{ alignItems: 'center' }}>
                <span className="sm grow">• {c.label}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, j) => j !== i) }))}><X size={13} /></button>
              </div>
            ))}
            <div className="row gap-2">
              <input className="input" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a checklist item…" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())} />
              <button className="btn btn-subtle btn-sm" onClick={addItem}><Plus size={14} /></button>
            </div>
          </div>
        </div>

        {/* Links */}
        <div className="field">
          <label className="label"><Link2 size={13} /> Links</label>
          <div className="col gap-1">
            {form.links.map((l, i) => (
              <div key={i} className="row gap-2" style={{ alignItems: 'center' }}>
                <span className="sm grow" style={{ wordBreak: 'break-all' }}>{l.label ? `${l.label} — ` : ''}{l.url}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }))}><X size={13} /></button>
              </div>
            ))}
            <div className="row gap-2">
              <input className="input" style={{ maxWidth: 160 }} value={newLink.label} onChange={(e) => setNewLink((l) => ({ ...l, label: e.target.value }))} placeholder="Label" />
              <input className="input grow" value={newLink.url} onChange={(e) => setNewLink((l) => ({ ...l, url: e.target.value }))} placeholder="https://…" />
              <button className="btn btn-subtle btn-sm" onClick={addLink}><Plus size={14} /></button>
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div className="field">
          <label className="label"><Paperclip size={13} /> Attachments</label>
          <div className="col gap-1">
            {form.attachments.map((a, i) => (
              <div key={i} className="row gap-2" style={{ alignItems: 'center' }}>
                <span className="sm grow" style={{ wordBreak: 'break-all' }}>📎 {a.originalName || a.url}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((_, j) => j !== i) }))}><X size={13} /></button>
              </div>
            ))}
            <label className="btn btn-subtle btn-sm" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
              {upload.isPending ? <span className="spinner" /> : <><Paperclip size={14} /> Add files</>}
              <input type="file" multiple hidden onChange={onFiles} />
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ─── one allocated-task row ──────────────────────────────────────────── */
function TaskRow({ task }) {
  const pr = PRIORITY_META[task.priority] || {};
  const st = TASK_STATUS_META[task.status] || {};
  const done = task.checklist?.filter((c) => c.done).length || 0;
  return (
    <div className="row gap-3" style={{ alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
        <span className="tiny muted">
          {task.code}{task.plannedEnd ? ` · due ${fmtDate(task.plannedEnd)}` : ''}{task.checklist?.length ? ` · ${done}/${task.checklist.length} checks` : ''}
        </span>
      </div>
      {pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}
      <Badge color={st.color} soft={st.soft} dot>{st.label || task.status}</Badge>
      {task.assignee?.name
        ? <Avatar name={task.assignee.name} color={task.assignee.avatarColor} size={26} />
        : <span className="tiny muted">Unassigned</span>}
    </div>
  );
}

/* ─── page ────────────────────────────────────────────────────────────── */
export function DepartmentPlanningPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stageKey = 'p5';

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: tasksResp } = useTasks({ project: id, stageKey: EXEC_STAGE, limit: 500 });

  const createTask = useCreateTask(id);
  const completeStage = useCompleteStage(id);

  const [modal, setModal] = useState(null); // { presetDept } | null

  // Eligibility: property that cleared Project Creation (p4 master submitted).
  const isProjectCreated = (propId) =>
    (projectCreationRecords || []).some((r) => String(r.parentRecordId) === String(propId) && (r.status === 'submitted' || r.status === 'approved'));
  const property = (shortlisted || []).find((p) => isProjectCreated(p._id)) || null;

  const departments = (template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [])
    .map((t) => ({ key: t.key, name: t.name, subtitle: t.subtitle }));

  const tasks = tasksResp?.data || tasksResp || [];
  const tasksByDept = useMemo(() => {
    const map = {};
    for (const t of tasks) { const k = t.department || 'unassigned'; (map[k] = map[k] || []).push(t); }
    return map;
  }, [tasks]);

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  if (isLoading || !project) {
    return (<><Topbar title="Department Planning" /><div className="content"><SkPropertyIdentification /></div></>);
  }

  const create = async (payload) => {
    await createTask.mutateAsync(payload);
    setModal(null);
  };

  return (
    <>
      <Topbar
        title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back"><ArrowLeft size={16} /></button>{stage?.name || 'Department Planning'}</span>}
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content page-compact">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Department Planning"><div style={tileGrid}><InfoTile label="Loading…" value="…" /></div></SectionCard>
          ) : !property ? (
            <SectionCard title="Department Planning"><EmptyState icon={ClipboardList} title="No eligible project yet" hint="Complete Project Creation (Phase 4) first." /></SectionCard>
          ) : (
            <>
              {/* Allocation workspace */}
              <SectionCard
                title="Department Planning — Task Allocation"
                subtitle="Delegate the work packet to departments and doers"
                style={{ order: 1 }}
                action={
                  <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => setModal({ presetDept: '' })}><Plus size={14} /> Allocate Task</button>
                    {!isCompleted && (
                      <MarkDoneButton
                        onClick={() => completeStage.mutate(stageKey)}
                        disabled={tasks.length === 0}
                        disabledTitle="Allocate at least one task before completing planning."
                      />
                    )}
                    {isCompleted && <Badge color="var(--success)" soft="var(--success-soft)" dot>Planning Complete</Badge>}
                  </div>
                }
              >
                <div className="pc-grid">
                  {departments.map((d, i) => {
                    const list = tasksByDept[d.key] || [];
                    return (
                      <div key={d.key} className="card pc-module-card">
                        <div className="pc-module-head">
                          <span className="pc-module-num" style={{ background: `hsl(${(i * 47) % 360} 60% 55%)` }}>{i + 1}</span>
                          <span className="pc-module-title" title={d.name}>{d.name}</span>
                        </div>
                        <span className="tiny muted">{list.length} task{list.length === 1 ? '' : 's'} allocated</span>
                        <span className="pc-module-desc">{d.subtitle}</span>
                        <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
                          <button className="btn btn-primary btn-sm pc-module-action" onClick={() => setModal({ presetDept: d.key })}>
                            <Plus size={14} /> Assign Task
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {/* Allocated tasks, grouped by department */}
              <SectionCard title={`Allocated Tasks (${tasks.length})`} style={{ order: 2 }}>
                {tasks.length === 0 ? (
                  <EmptyState icon={CalendarClock} title="No tasks allocated yet" hint="Use “Allocate Task” to delegate the first piece of work." />
                ) : (
                  <div className="col gap-4">
                    {departments.filter((d) => (tasksByDept[d.key] || []).length).map((d) => (
                      <div key={d.key} className="col">
                        <div className="tiny upper" style={{ fontWeight: 700, color: 'var(--text-subtle)', letterSpacing: '0.06em', marginBottom: 2 }}>{d.name}</div>
                        {(tasksByDept[d.key] || []).map((t) => <TaskRow key={t._id} task={t} />)}
                      </div>
                    ))}
                    {(tasksByDept.unassigned || []).length > 0 && (
                      <div className="col">
                        <div className="tiny upper" style={{ fontWeight: 700, color: 'var(--text-subtle)', letterSpacing: '0.06em', marginBottom: 2 }}>Unassigned</div>
                        {tasksByDept.unassigned.map((t) => <TaskRow key={t._id} task={t} />)}
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* Collapsible context */}
              <SectionCard title="Property Summary" collapsible defaultCollapsed style={{ order: 3 }}>
                <div style={tileGrid}>
                  <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                  <InfoTile label="Property Name" value={property.title} />
                  <InfoTile label="City" value={property.values?.city} />
                  <InfoTile label="Locality" value={property.values?.locality} />
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>

      <AllocateTaskModal
        open={!!modal}
        onClose={() => setModal(null)}
        projectId={id}
        departments={departments}
        presetDept={modal?.presetDept}
        onCreate={create}
        creating={createTask.isPending}
      />
    </>
  );
}

export default DepartmentPlanningPage;
