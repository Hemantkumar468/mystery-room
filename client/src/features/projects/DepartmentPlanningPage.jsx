import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ClipboardList, Plus, X, Paperclip, Link2, Users, CalendarClock, CheckSquare, Truck,
  HardHat, Sofa, Package, Cpu, Monitor, Megaphone, IndianRupee, Settings2, Scale, Briefcase, TrendingUp,
  LayoutGrid, CheckCircle2, Clock, AlertTriangle, Flag,
  Upload, RefreshCw, MessageCircle, Trash2, UserPlus, FolderPlus, FileUp, FileText, Send, XCircle,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { KpiStrip } from '../../components/ui/KpiStrip.jsx';
import { SectionCard, Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useUsers } from '../../app/api/usersApi.js';
import { useStageRecords, useUploadMedia } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { useTasks, useCreateTask } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime, fmtDuration, daysUntil } from '../../lib/format.js';
import { PRIORITY_META, TASK_STATUS_META, DEPT_META, CHART_COLORS } from '../../lib/ui.js';
import { approvedTypeCount, propertyNo } from './records/recordUi.js';
import { InfoTile, tileGrid } from './StageOverviewParts.jsx';
import { P9_TASK_PURPOSE_OPTIONS } from './storeLaunchTaskKeys.js';

const EXEC_STAGE = 'p6'; // allocated tasks are the execution-phase tasks

// Same MediaRecorder convention as DynamicField.jsx's AudioRecorderField —
// kept as a separate, simpler copy here because this modal uploads
// immediately on pick/stop (onFiles below), not through the deferred
// useMediaEntries/pending-entry pipeline that field forms use.
const RECORDER_MIME_CANDIDATES = ['audio/webm', 'audio/ogg', 'audio/mp4'];
const RECORDER_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

/*
 * ─── Allocate Task modal ─────────────────────────────────────────────────
 * `stageKey` defaults to Execution (p6) — its original, still most common
 * caller — but is overridable so other stage-scoped "create a task" flows
 * (e.g. Phase 8's ad-hoc checklist items, stageKey 'p8') can reuse this same
 * modal instead of a second copy. `categoryOptions` (an array of {key, name})
 * renders Task Category as a fixed <select> instead of free text — Phase 8
 * passes the 9 READINESS_CATEGORIES for this; every other caller leaves it
 * unset and the field stays hidden.
 */
export function AllocateTaskModal({
  open, onClose, projectId, departments, presetDept, presetCategory, categoryOptions,
  stageKey = EXEC_STAGE, onCreate, creating, tasks = [], error,
}) {
  const empty = {
    title: '', description: '', department: presetDept || '', taskCategory: presetCategory || '',
    assignee: '', watchers: [], priority: 'medium', dueDate: '', checklist: [], links: [], attachments: [],
    templateTaskKey: '',
  };
  const [form, setForm] = useState(empty);
  const [newItem, setNewItem] = useState('');
  const [newLink, setNewLink] = useState({ label: '', url: '' });
  const upload = useUploadMedia();

  // Re-seed the department/category when opened from a specific card.
  useEffect(() => {
    if (open) setForm((f) => ({ ...f, department: presetDept || f.department, taskCategory: presetCategory || f.taskCategory }));
  }, [presetDept, presetCategory, open]);

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

  // Live audio recording, straight into Attachments — same MediaRecorder
  // pattern as DynamicField.jsx's AudioRecorderField, but uploads immediately
  // on Stop (matching onFiles above) instead of deferring to a later Save.
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const [recStatus, setRecStatus] = useState('idle'); // idle | requesting | recording | paused | uploading
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState('');

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  const startTimer = () => { clearInterval(timerRef.current); timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000); };
  const stopTimer = () => clearInterval(timerRef.current);

  /** Imperative-only teardown — safe to call on unmount/close mid-recording. */
  const discardRecording = () => {
    stopTimer();
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      try { recorderRef.current.stop(); } catch { /* already inactive */ }
    }
    stopStream();
    chunksRef.current = [];
  };

  // Closing the modal (Cancel, backdrop, Escape, X) mid-recording must
  // discard it, not silently finalize and upload it after the fact.
  useEffect(() => () => discardRecording(), []);

  const startRecording = async () => {
    setRecError('');
    setRecStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = RECORDER_MIME_CANDIDATES.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stopTimer();
        stopStream();
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext = RECORDER_EXT[type.split(';')[0]] || 'webm';
        const file = new File([blob], `Recording ${new Date().toLocaleTimeString()}.${ext}`, { type });
        setRecStatus('uploading');
        try {
          const ref = await upload.mutateAsync({ file });
          setForm((f) => ({ ...f, attachments: [...f.attachments, { ...ref, originalName: file.name, mimetype: file.type, bytes: file.size }] }));
        } catch {
          setRecError('Recording upload failed — try recording again.');
        }
        setRecSeconds(0);
        setRecStatus('idle');
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecSeconds(0);
      setRecStatus('recording');
      startTimer();
    } catch {
      setRecStatus('idle');
      setRecError('Microphone permission was denied or is unavailable — check your browser settings.');
    }
  };
  const pauseRecording = () => { recorderRef.current?.pause(); stopTimer(); setRecStatus('paused'); };
  const resumeRecording = () => { recorderRef.current?.resume(); startTimer(); setRecStatus('recording'); };
  const stopRecording = () => recorderRef.current?.stop(); // finalizes via onstop -> uploads -> adds the attachment
  const cancelRecording = () => { discardRecording(); setRecSeconds(0); setRecStatus('idle'); };

  const submit = async () => {
    const payload = {
      stageKey,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      department: form.department || undefined,
      taskCategory: form.taskCategory.trim() || undefined,
      assignee: form.assignee || undefined,
      watchers: form.watchers,
      priority: form.priority,
      plannedEnd: form.dueDate || undefined,
      checklist: form.checklist,
      links: form.links,
      attachments: form.attachments,
      templateTaskKey: form.templateTaskKey || undefined,
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
        <div className="col gap-2" style={{ width: '100%' }}>
          {/* Whatever the server actually said (duplicate title, assignee in
              the wrong department, dependency cycle…) — shown verbatim so
              the UI never silently swallows a rejected allocation. */}
          {error && (
            <span className="sm" style={{ color: 'var(--danger)', textAlign: 'right' }}>{error}</span>
          )}
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-subtle" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={creating || !form.title.trim() || !form.department || !form.dueDate}>
              {creating ? <span className="spinner" /> : 'Assign Task'}
            </button>
          </div>
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

        {categoryOptions?.length > 0 && (
          <div className="field">
            <label className="label">Task Category</label>
            <select className="select" value={form.taskCategory} onChange={set('taskCategory')}>
              <option value="">Select category…</option>
              {categoryOptions.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* Store Launch only: tags this task as one of the named Go-Live
            checkpoints (Final Approval, Staff Briefing, …) so StoreLaunchPage's
            launch gate and Pre-Launch Activities panel can find it — optional,
            only relevant if this task IS that checkpoint. */}
        {stageKey === 'p9' && (
          <div className="field">
            <label className="label">Task Purpose (optional)</label>
            <select className="select" value={form.templateTaskKey} onChange={set('templateTaskKey')}>
              <option value="">General checklist item</option>
              {P9_TASK_PURPOSE_OPTIONS.map((o) => {
                const claimed = tasks.some((t) => t.templateTaskKey === o.key);
                return (
                  <option key={o.key} value={o.key} disabled={claimed}>
                    {o.label}{claimed ? ' (already set)' : ''}
                  </option>
                );
              })}
            </select>
            <span className="tiny muted">Only set this if the task fulfils one of Store Launch's named Go-Live checkpoints.</span>
          </div>
        )}

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
            <label className="label">Due Date *</label>
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
            <div className="row gap-2 wrap">
              <label className="btn btn-subtle btn-sm" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
                {upload.isPending ? <span className="spinner" /> : <><Paperclip size={14} /> Add files</>}
                <input type="file" multiple hidden onChange={onFiles} />
              </label>
              {recStatus === 'idle' && (
                <button type="button" className="btn btn-subtle btn-sm" onClick={startRecording}>
                  🎙 Record Audio
                </button>
              )}
            </div>
            {recStatus === 'requesting' && <span className="tiny muted">Requesting microphone permission…</span>}
            {recStatus === 'uploading' && <span className="tiny muted">Uploading recording…</span>}
            {(recStatus === 'recording' || recStatus === 'paused') && (
              <div
                className="row gap-3 wrap"
                style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center' }}
              >
                <span className="row gap-2 sm" style={{ fontWeight: 650 }}>
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: recStatus === 'recording' ? 'var(--danger)' : 'var(--text-subtle)',
                    }}
                  />
                  {fmtDuration(recSeconds)}
                </span>
                <span className="row gap-1 wrap">
                  {recStatus === 'recording' ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={pauseRecording}>Pause</button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={resumeRecording}>Resume</button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" onClick={stopRecording}>Stop</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={cancelRecording}>Cancel</button>
                </span>
              </div>
            )}
            {recError && <span className="tiny" style={{ color: 'var(--danger)' }}>{recError}</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ─── one allocated-task row — shared with DepartmentTasksPage ─────────── */
export function TaskRow({ task }) {
  const pr = PRIORITY_META[task.priority] || {};
  const st = TASK_STATUS_META[task.status] || {};
  const done = task.checklist?.filter((c) => c.done).length || 0;
  const dates = task.plannedStart && task.plannedEnd
    ? `${fmtDate(task.plannedStart)} → ${fmtDate(task.plannedEnd)}`
    : task.plannedEnd ? `due ${fmtDate(task.plannedEnd)}` : '';
  return (
    <div className="row gap-3" style={{ alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
        <span className="tiny muted">
          {task.code}{dates ? ` · ${dates}` : ''}{task.checklist?.length ? ` · ${done}/${task.checklist.length} checks` : ''}
        </span>
        <span className="tiny muted">
          Assigned by {task.createdBy?.name || '—'} · {fmtDateTime(task.createdAt)}
        </span>
        {(task.dependencies?.length > 0 || task.longLead) && (
          <div className="row gap-2" style={{ marginTop: 4, flexWrap: 'wrap' }}>
            {task.dependencies?.map((dep) => (
              <Badge key={dep._id || dep} color="var(--text-subtle)" soft="var(--surface-hover)">
                after {dep.code || dep}
              </Badge>
            ))}
            {task.longLead && (
              <Badge color="var(--warning)" soft="var(--warning-soft)">
                <Truck size={11} style={{ marginRight: 3, verticalAlign: '-2px' }} /> Long-lead
              </Badge>
            )}
          </div>
        )}
      </div>
      {pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}
      <Badge color={st.color} soft={st.soft} dot>{st.label || task.status}</Badge>
      {task.assignee?.name
        ? (
          <div className="row gap-2" style={{ alignItems: 'center', flexShrink: 0 }}>
            <Avatar name={task.assignee.name} color={task.assignee.avatarColor} size={26} />
            <span className="tiny" style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task.assignee.name}
            </span>
          </div>
        )
        : <span className="tiny muted">Unassigned</span>}
    </div>
  );
}

/* ─── one clickable department row — name, count, cheap overdue signal ──── */
// One icon per department — purely a visual anchor so the list reads at a
// glance instead of as a wall of identical rows.
const DEPT_ICONS = {
  construction: HardHat, interior: Sofa, procurement: Package, automation: Cpu,
  it: Monitor, marketing: Megaphone, hr: Users, finance: IndianRupee,
  operations: Settings2, legal: Scale, projects: Briefcase, expansion: TrendingUp,
};
const DEPT_ORDER = Object.keys(DEPT_META);

export function DepartmentRow({ deptKey, subtitle, taskList, onOpen }) {
  const Icon = DEPT_ICONS[deptKey] || Briefcase;
  const accent = CHART_COLORS[DEPT_ORDER.indexOf(deptKey) % CHART_COLORS.length] || 'var(--primary)';
  const overdueCount = taskList.filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date()).length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="list-row"
    >
      <div className="list-row-icon" style={{ background: `${accent}1A`, color: accent }}>
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="sm" style={{ fontWeight: 650 }}>{DEPT_META[deptKey] || deptKey}</span>
        {subtitle && (
          <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </span>
        )}
      </div>
      {overdueCount > 0 && <Badge color="var(--danger)" soft="var(--danger-soft)">{overdueCount} overdue</Badge>}
      <Badge color="var(--text-subtle)" soft="var(--surface-hover)">{taskList.length} task{taskList.length === 1 ? '' : 's'}</Badge>
      <ChevronRight size={18} className="muted list-row-chevron" />
    </div>
  );
}

/** Icon + color for one activity entry, read off its message text — mirrors
 * the verbs project.service.js/task.service.js/activityService actually log
 * (created/status changed/reassigned/uploaded/deleted/commented). Real
 * activity data, not a fabricated per-department summary. */
export function activityMeta(message = '') {
  const m = message.toLowerCase();
  if (m.includes('created')) return { Icon: FolderPlus, color: 'var(--info)' };
  if (m.includes('to done') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--success)' };
  if (m.includes('changed status')) return { Icon: RefreshCw, color: 'var(--warning)' };
  if (m.includes('reassigned')) return { Icon: UserPlus, color: 'var(--chart-7)' };
  if (m.includes('uploaded')) return { Icon: Upload, color: 'var(--chart-2)' };
  if (m.includes('deleted')) return { Icon: Trash2, color: 'var(--danger)' };
  if (m.includes('posted an update')) return { Icon: FileText, color: 'var(--chart-4)' };
  if (m.includes('submitted') && m.includes('approval')) return { Icon: Send, color: 'var(--chart-7)' };
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--danger)' };
  if (m.includes('approved')) return { Icon: CheckCircle2, color: 'var(--success)' };
  if (m.includes('commented')) return { Icon: MessageCircle, color: 'var(--chart-3)' };
  return { Icon: Clock, color: 'var(--text-subtle)' };
}

/* ─── sidebar: Today's Activity — real project activity, task-related only ─ */
export function ActivityPanel({ projectId, title = "Today's Activity" }) {
  const { data: activity, isLoading } = useProjectActivity(projectId);
  const items = (activity || [])
    .filter((a) => a.entityType === 'task')
    .slice(0, 6);
  return (
    <SectionCard title={title}>
      {isLoading ? (
        <span className="tiny muted">Loading…</span>
      ) : items.length === 0 ? (
        <EmptyState title="No activity yet" hint="Task allocations and updates will show up here." />
      ) : (
        <div className="col">
          {items.map((a) => {
            const { Icon, color } = activityMeta(a.message);
            return (
              <div key={a._id} className="row gap-3" style={{ alignItems: 'flex-start', padding: '9px 0', borderTop: '1px solid var(--border)' }}>
                <div className="list-row-icon" style={{ width: 28, height: 28, background: `${color}1A`, color, flexShrink: 0 }}>
                  <Icon size={13} strokeWidth={2} />
                </div>
                <div className="col grow" style={{ minWidth: 0 }}>
                  <span className="sm" style={{ fontWeight: 600 }}>{a.actor?.name || 'System'}</span>
                  <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.message}</span>
                </div>
                <span className="tiny muted" style={{ flexShrink: 0 }}>{fmtDateTime(a.createdAt).split(', ')[1]}</span>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/* ─── sidebar: Upcoming Deadlines — soonest not-done tasks, real data ────── */
function relativeDeadline(days) {
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} Days`;
}

export function DeadlinesPanel({ tasks, onOpen }) {
  const upcoming = useMemo(() => (
    tasks
      .filter((t) => t.status !== 'done' && t.plannedEnd)
      .sort((a, b) => new Date(a.plannedEnd) - new Date(b.plannedEnd))
      .slice(0, 5)
  ), [tasks]);

  return (
    <SectionCard
      title="Upcoming Deadlines"
      action={<button className="btn btn-ghost btn-sm" onClick={onOpen}>View Calendar</button>}
    >
      {upcoming.length === 0 ? (
        <EmptyState title="Nothing due" hint="No pending tasks have a due date yet." />
      ) : (
        <div className="col">
          {upcoming.map((t) => {
            const days = daysUntil(t.plannedEnd);
            return (
              <div key={t._id} className="row gap-2" style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: days < 0 ? 'var(--danger)' : days <= 1 ? 'var(--warning)' : 'var(--success)' }} />
                <span className="sm grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="tiny muted" style={{ flexShrink: 0 }}>{relativeDeadline(days)}</span>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/* ─── sidebar: Quick Actions — only wired where real functionality exists ── */
function QuickActionsPanel({ onAllocate }) {
  const ACTIONS = [
    { icon: Plus, label: 'Allocate New Task', onClick: onAllocate },
    { icon: FolderPlus, label: 'Add New Department', disabled: true, hint: 'Coming soon — department master isn’t built yet' },
    { icon: FileUp, label: 'Bulk Upload Tasks', disabled: true, hint: 'Coming soon — Excel import is a separate build' },
    { icon: FileText, label: 'Generate Report', disabled: true, hint: 'Coming soon — export is a separate build' },
  ];
  return (
    <SectionCard title="Quick Actions">
      <div className="col gap-1">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={a.disabled}
            title={a.hint}
            onClick={a.onClick}
            style={{ justifyContent: 'space-between', width: '100%' }}
          >
            <span className="row gap-2" style={{ alignItems: 'center' }}><a.icon size={14} /> {a.label}</span>
            <ChevronRight size={14} className="muted" />
          </button>
        ))}
      </div>
    </SectionCard>
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

  const [modal, setModal] = useState(null); // { presetDept } | null
  const [createError, setCreateError] = useState('');

  // Eligibility: the property whose Project Setup a manager actually
  // APPROVED. Submission alone isn't enough — approval is what creates the
  // project, and the server refuses to allocate work (task.service#create)
  // or close this phase until Phase 4 is genuinely complete.
  const isProjectCreated = (propId) =>
    (projectCreationRecords || []).some((r) => String(r.parentRecordId) === String(propId) && r.status === 'approved');
  const property = (shortlisted || []).find((p) => isProjectCreated(p._id)) || null;
  const p4Complete = project?.stages?.find((s) => s.key === 'p4')?.status === 'completed';

  const departments = (template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [])
    .map((t) => ({ key: t.key, name: t.name, subtitle: t.subtitle }));

  const tasks = tasksResp?.data || tasksResp || [];
  const tasksByDept = useMemo(() => {
    const map = {};
    for (const t of tasks) { const k = t.department || 'unassigned'; (map[k] = map[k] || []).push(t); }
    return map;
  }, [tasks]);

  const stats = useMemo(() => {
    const now = new Date();
    const completed = tasks.filter((t) => t.status === 'done').length;
    const overdue = tasks.filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < now).length;
    const pending = tasks.length - completed - overdue;
    const highPriority = tasks.filter((t) => t.priority === 'high' || t.priority === 'critical').length;
    const resources = new Set(tasks.filter((t) => t.assignee).map((t) => t.assignee._id || t.assignee)).size;
    return { completed, overdue, pending, highPriority, resources };
  }, [tasks]);

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  if (isLoading || !project) {
    return (<><Topbar title="Department Planning" /><div className="content"><SkPropertyIdentification /></div></>);
  }

  const create = async (payload) => {
    setCreateError('');
    try {
      await createTask.mutateAsync(payload);
      setModal(null);
    } catch (err) {
      // Keep the modal open with the work intact so the user can fix it.
      setCreateError(err?.response?.data?.message || 'Could not allocate this task — try again.');
    }
  };

  return (
    <>
      <Topbar
        title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back"><ArrowLeft size={16} /></button>{stage?.name || 'Department Planning'}</span>}
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content">
        <div
          className="se-page se-page--tight-top fade-in"
          style={{
            display: 'grid',
            gridTemplateColumns: property && !propertiesLoading && !templateLoading ? 'minmax(0, 1fr) 300px' : '1fr',
            gap: 'var(--space-3)',
            alignItems: 'start',
          }}
        >
        <div className="col gap-3">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Department Planning"><div style={tileGrid}><InfoTile label="Loading…" value="…" /></div></SectionCard>
          ) : !property ? (
            <SectionCard title="Department Planning"><EmptyState icon={ClipboardList} title="No eligible project yet" hint="Complete Project Creation (Phase 4) first." /></SectionCard>
          ) : (
            <>
              {/* Overview stats */}
              <KpiStrip cards={[
                { key: 'departments', label: 'Total Departments', value: departments.length, icon: LayoutGrid, color: 'var(--info)', soft: 'var(--info-soft)' },
                { key: 'allocated', label: 'All Allocated Tasks', value: tasks.length, icon: ClipboardList, color: '#6366F1', soft: 'rgba(99,102,241,0.12)' },
                { key: 'completed', label: 'Tasks Completed', value: stats.completed, icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)' },
                { key: 'pending', label: 'Tasks Pending', value: stats.pending, icon: Clock, color: 'var(--warning)', soft: 'var(--warning-soft)' },
                { key: 'overdue', label: 'Tasks Overdue', value: stats.overdue, icon: AlertTriangle, color: 'var(--danger)', soft: 'var(--danger-soft)' },
                { key: 'highPriority', label: 'High Priority Tasks', value: stats.highPriority, icon: Flag, color: '#8B5CF6', soft: 'rgba(139,92,246,0.12)' },
                { key: 'teamMembers', label: 'Team Members', value: stats.resources, icon: Users, color: '#16A79A', soft: 'rgba(22,167,154,0.12)' },
              ]} />

              {/* Allocation workspace */}
              <SectionCard
                title="Department Planning — Task Allocation"
                subtitle="Delegate the work packet to departments and doers"
                style={{ order: 1 }}
                action={
                  <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Mirrors task.service#create's own P4_NOT_COMPLETE
                        guard, so this never fails on the server instead. */}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setModal({ presetDept: '' })}
                      disabled={!p4Complete}
                      title={!p4Complete ? 'Project Creation (Phase 4) must be approved and completed first' : undefined}
                    >
                      <Plus size={14} /> Allocate Task
                    </button>
                    {isCompleted && <Badge color="var(--success)" soft="var(--success-soft)" dot>Planning Complete</Badge>}
                  </div>
                }
              />

              {/* Allocated tasks, grouped by department */}
              <SectionCard title={`Allocated Tasks (${tasks.length})`} style={{ order: 2 }}>
                {tasks.length === 0 ? (
                  <EmptyState icon={CalendarClock} title="No tasks allocated yet" hint="Use “Allocate Task” to delegate the first piece of work." />
                ) : (
                  <div className="col">
                    {Object.keys(tasksByDept).filter((k) => k !== 'unassigned').sort().map((deptKey) => (
                      <DepartmentRow
                        key={deptKey}
                        deptKey={deptKey}
                        subtitle={departments.find((d) => d.key === deptKey)?.subtitle}
                        taskList={tasksByDept[deptKey]}
                        onOpen={() => navigate(`/projects/${id}/department-planning/${deptKey}`)}
                      />
                    ))}
                    {/* Unassigned has no real DEPARTMENT key to drill into — shown for visibility only, not clickable. */}
                    {(tasksByDept.unassigned || []).length > 0 && (
                      <div className="row gap-3" style={{ alignItems: 'center', padding: '13px 14px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ width: 36, height: 36, flexShrink: 0 }} />
                        <span className="sm grow muted">Unassigned</span>
                        <Badge color="var(--text-subtle)" soft="var(--surface-hover)">{tasksByDept.unassigned.length} task{tasksByDept.unassigned.length === 1 ? '' : 's'}</Badge>
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

        {property && !propertiesLoading && !templateLoading && (
          <div className="col gap-3">
            <ActivityPanel projectId={id} />
            <DeadlinesPanel tasks={tasks} onOpen={() => navigate('/calendar')} />
            <QuickActionsPanel onAllocate={() => setModal({ presetDept: '' })} />
          </div>
        )}
        </div>
      </div>

      <AllocateTaskModal
        open={!!modal}
        onClose={() => { setModal(null); setCreateError(''); }}
        error={createError}
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
