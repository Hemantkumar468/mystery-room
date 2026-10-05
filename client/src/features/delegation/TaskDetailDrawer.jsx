import { useEffect, useState } from 'react';
import {
  PlayCircle, CheckCircle2, ShieldCheck, ThumbsUp, RotateCcw, CalendarClock, UserCog, Layers,
  MessageSquare, Megaphone, StickyNote, PhoneCall, Bell, Trash2, Pencil, Link2, Ban, Send,
  Building2, Users, FolderKanban, Tag, Clock, Repeat, AlertTriangle, GitBranch, Paperclip, Volume2, Plus,
} from 'lucide-react';
import { Drawer } from '../../components/ops/Drawer.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar, AvatarStack, PriorityBadge, Spinner, EmptyState } from '../../components/ui/primitives.jsx';
import { DlgStatusBadge, Segmented, ReasonModal, Meta } from '../../components/ops/common.jsx';
import { FileUploader, Attachments } from '../../components/ops/FileUploader.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useDelegation, useDelegationAction, useUpdateDelegation, useDeleteDelegation, useCatalog, useGroups, useBranches,
} from '../../lib/opsQueries.js';
import {
  DLG_STATUS_META, FREQ_LABEL, ESCALATION_LABEL, PRIORITY_OPTIONS, parseRemarkLines, isDlgOverdue, errMsg,
} from '../../lib/opsUi.js';
import { fmtDate, fmtDateTime, fromNow, daysUntil } from '../../lib/format.js';
import {
  CompleteModal, ReviseDateModal, DependentModal, BlockedModal, ReassignModal, ChannelRemarkModal, FollowupModal, RemindersModal,
} from './ActionModals.jsx';
import { TaskFormModal } from './TaskFormModal.jsx';
import { drawers } from '../../store/drawerStore.js';

/* ------------------------------------------------------------------ */

function RemarkChannel({ label, value, tone }) {
  const lines = parseRemarkLines(value);
  if (!lines.length) return null;
  return (
    <div className="drawer-section">
      <span className="eyebrow row gap-1" style={{ color: tone }}>{label} · {lines.length}</span>
      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
        {lines.map((l, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="remark-line">
            {l.at && <div className="tiny subtle tabular">{l.at}</div>}
            <div className="sm">{l.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubtaskTree({ nodes, onOpen }) {
  if (!nodes?.length) return null;
  return nodes.map((n) => (
    <div key={n._id}>
      <div className="subtask" onClick={() => onOpen(n._id)} role="button" tabIndex={0}>
        <GitBranch size={13} className="subtle" />
        <span className="mono tiny subtle">{n.code}</span>
        <span className="grow sm truncate" style={{ fontWeight: 600 }}>{n.title}</span>
        <Avatar name={n.doer?.name} color={n.doer?.avatarColor} size={22} />
        <DlgStatusBadge value={n.status} />
      </div>
      {n.subtasks?.length > 0 && (
        <div className="subtask-children"><SubtaskTree nodes={n.subtasks} onOpen={onOpen} /></div>
      )}
    </div>
  ));
}

function EditTaskModal({ task, open, onClose }) {
  const update = useUpdateDelegation();
  const { data: categories = [] } = useCatalog('categories');
  const { data: tags = [] } = useCatalog('tags');
  const { data: groups = [] } = useGroups();
  const { data: branchRes } = useBranches();
  const [f, setF] = useState(null);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const branches = branchRes?.data || [];
  useEffect(() => {
    if (open && task) {
      setF({
        title: task.title,
        description: task.description || '',
        category: task.category || '',
        priority: task.priority,
        inLoop: (task.inLoop || []).map((u) => typeof u === 'string' ? u : u._id),
        group: task.group?._id || '',
        branch: task.branch?._id || task.branch || '',
        tags: task.tags || [],
        checklistItems: (task.checklistItems || []).map((item) => ({
          _id: item._id,
          text: item.text,
          completed: Boolean(item.completed),
        })),
        evidenceRequired: task.evidenceRequired,
        verificationRequired: task.verificationRequired,
        voiceNoteUrl: task.voiceNoteUrl ? [task.voiceNoteUrl] : [],
        referenceDocs: task.referenceDocs || [],
      });
      setNewChecklistItem('');
    }
  }, [open, task]);
  if (!task || !f) return null;
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const save = async () => {
    try {
      await update.mutateAsync({
        id: task._id,
        ...f,
        group: f.group || null,
        branch: f.branch || null,
        voiceNoteUrl: f.voiceNoteUrl[0] || null,
        checklistItems: f.checklistItems.map(({ _id, text, completed }) => ({
          ...(_id ? { _id } : {}), text, completed,
        })),
      });
      toast.success('Task updated');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit task"
      subtitle={task.code}
      width={680}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={update.isPending || !f.title.trim()}>{update.isPending ? <span className="spinner" /> : 'Save task details'}</button>
        </>
      }
    >
      <div className="field"><label className="label">Title</label><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} /></div>
      <div className="field"><label className="label">Description</label><textarea className="textarea" value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
      <div className="form-grid">
        <div className="field">
          <label className="label">Category</label>
          <select className="select" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            {categories.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
            {f.category && !categories.some((c) => c.name === f.category) && <option value={f.category}>{f.category}</option>}
          </select>
        </div>
        <div className="field">
          <label className="label">Priority</label>
          <select className="select" value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
            {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">In the loop</label>
          <PersonPicker multiple value={f.inLoop} onChange={(inLoop) => set({ inLoop })} exclude={[task.doer?._id]} />
        </div>
        <div className="field">
          <label className="label">Group</label>
          <select className="select" value={f.group} onChange={(e) => set({ group: e.target.value })}>
            <option value="">No group</option>
            {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Branch</label>
          <select className="select" value={f.branch} onChange={(e) => set({ branch: e.target.value })}>
            <option value="">No branch</option>
            {branches.map((b) => <option key={b._id} value={b._id}>{b.name} ({b.code})</option>)}
          </select>
        </div>
        <div className="field span-2">
          <label className="label">Tags</label>
          <div className="row gap-2 wrap">
            {[...new Set([...tags.map((tag) => tag.name), ...f.tags])].map((name) => {
              const selected = f.tags.includes(name);
              const tag = tags.find((item) => item.name === name);
              return (
                <button
                  type="button"
                  key={name}
                  className={`chip ${selected ? 'active' : ''}`}
                  onClick={() => set({ tags: selected ? f.tags.filter((item) => item !== name) : [...f.tags, name] })}
                >
                  {tag?.color && <span className="badge-dot" style={{ background: tag.color }} />} {name}
                </button>
              );
            })}
            {!tags.length && !f.tags.length && <span className="tiny muted">No tags available</span>}
          </div>
        </div>
      </div>
      <div className="form-section">
        <span className="eyebrow row gap-1"><Layers size={12} /> Checklist</span>
        {f.checklistItems.map((item, index) => (
          <div key={item._id || `new-${index}`} className="check-item">
            <input type="checkbox" checked={item.completed} disabled readOnly aria-label="Completed status" />
            <input
              className="input grow"
              value={item.text}
              aria-label={`Checklist item ${index + 1}`}
              onChange={(e) => set({ checklistItems: f.checklistItems.map((current, i) => (i === index ? { ...current, text: e.target.value } : current)) })}
            />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => set({ checklistItems: f.checklistItems.filter((_, i) => i !== index) })} aria-label="Remove checklist item"><Trash2 size={13} /></button>
          </div>
        ))}
        <div className="row gap-2" style={{ marginTop: 8 }}>
          <input className="input" value={newChecklistItem} onChange={(e) => setNewChecklistItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), newChecklistItem.trim() && (set({ checklistItems: [...f.checklistItems, { text: newChecklistItem.trim(), completed: false }] }), setNewChecklistItem('')))} placeholder="Add a checklist item" />
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => { if (!newChecklistItem.trim()) return; set({ checklistItems: [...f.checklistItems, { text: newChecklistItem.trim(), completed: false }] }); setNewChecklistItem(''); }}><Plus size={14} /> Add</button>
        </div>
      </div>
      <div className="row gap-5">
        <label className="toggle-row"><input type="checkbox" checked={f.evidenceRequired} onChange={(e) => set({ evidenceRequired: e.target.checked })} /> Proof required</label>
        <label className="toggle-row"><input type="checkbox" checked={f.verificationRequired} onChange={(e) => set({ verificationRequired: e.target.checked })} /> Verification required</label>
      </div>
      <div className="form-section">
        <span className="eyebrow">Attachments</span>
        <div className="form-grid">
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Voice note</label>
            <FileUploader multiple={false} value={f.voiceNoteUrl} onChange={(voiceNoteUrl) => set({ voiceNoteUrl })} label="Attach audio" accept="audio/*" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Reference documents</label>
            <FileUploader value={f.referenceDocs} onChange={(referenceDocs) => set({ referenceDocs })} label="Attach files" />
          </div>
        </div>
      </div>
      <p className="tiny muted">Change the assignee, deadline, or reminders using their dedicated task actions so the history stays accurate.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

export function TaskDetailDrawer({ taskId, onClose, onOpenTask }) {
  const { data: task, isLoading, error } = useDelegation(taskId);
  const act = useDelegationAction();
  const update = useUpdateDelegation();
  const remove = useDeleteDelegation();
  const [tab, setTab] = useState('details');
  const [modal, setModal] = useState(null);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState([]);

  useEffect(() => {
    setTab('details');
    setModal(null);
    setComment('');
    setFiles([]);
  }, [taskId]);

  const can = task?.can || {};
  const close = () => setModal(null);

  /** Run a lifecycle action; resolves false on failure so modals can stay open. */
  const quick = async (action, body, success) => {
    try {
      await act.mutateAsync({ id: task._id, action, body });
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    }
  };

  const toggleItem = async (item) => {
    const items = task.checklistItems.map((c) => ({ _id: c._id, text: c.text, completed: c._id === item._id ? !c.completed : c.completed }));
    try {
      await update.mutateAsync({ id: task._id, checklistItems: items });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    try {
      await act.mutateAsync({ id: task._id, action: 'comments', body: { body: comment.trim(), attachments: files } });
      setComment('');
      setFiles([]);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const overdue = task && isDlgOverdue(task);
  const dleft = task?.dueDate ? daysUntil(task.dueDate) : null;
  const revisionsUsed = task ? (task.revision1 ? 1 : 0) + (task.revision2 ? 1 : 0) : 0;
  const busy = act.isPending;

  return (
    <Drawer
      open={Boolean(taskId)}
      onClose={onClose}
      width={780}
      title={task ? task.title : 'Task'}
      subtitle={task ? `${task.code}${task.parent ? ` · sub-task of ${task.parent.code}` : ''}` : ''}
      actions={
        task && can.canEdit ? (
          <button className="btn btn-ghost btn-icon" onClick={() => setModal('edit')} title="Edit"><Pencil size={16} /></button>
        ) : null
      }
    >
      {isLoading && <Spinner label="Loading task…" />}
      {error && <EmptyState icon={AlertTriangle} title="This task isn't available" hint="It may have been deleted, or it's outside what you can see." />}
      {task && (
        <div className="col gap-4">
          {/* Status strip */}
          <div className="row gap-2 wrap">
            <DlgStatusBadge value={task.status} />
            <PriorityBadge value={task.priority} />
            {overdue && <DlgStatusBadge value="overdue" />}
            {task.escalationTier > 0 && (
              <span className="escalation-pill"><AlertTriangle size={11} /> {ESCALATION_LABEL[task.escalationTier]}</span>
            )}
            {task.recurrence && (
              <button type="button" className="chip chip-sm" title="Open the repeat rule" onClick={() => drawers.recurrence(task.recurrence._id)}>
                <Repeat size={11} /> {FREQ_LABEL[task.recurrence.frequency]} · rule
              </button>
            )}
            {task.verificationRequired && <span className="chip chip-sm"><ShieldCheck size={11} /> Verification</span>}
            {task.evidenceRequired && <span className="chip chip-sm"><Paperclip size={11} /> Proof needed</span>}
            {task.deletedAt && <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>In trash</span>}
          </div>

          {/* Actions */}
          {!task.deletedAt && (
            <div className="action-bar">
              {can.canWork && task.status === 'pending' && (
                <button className="btn btn-subtle btn-sm" disabled={busy} onClick={() => quick('status', { status: 'accepted' }, 'Task accepted')}><ThumbsUp size={14} /> Accept</button>
              )}
              {can.canWork && task.status !== 'in_progress' && (
                <button className="btn btn-subtle btn-sm" disabled={busy} onClick={() => quick('status', { status: 'in_progress' }, 'Work started')}><PlayCircle size={14} /> Start</button>
              )}
              {can.canWork && (
                <button className="btn btn-primary btn-sm" onClick={() => setModal('complete')}>
                  {task.verificationRequired ? <><ShieldCheck size={14} /> Submit for verification</> : <><CheckCircle2 size={14} /> Complete</>}
                </button>
              )}
              {can.canResume && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => quick('status', { status: 'accepted' }, 'Task resumed')}><RotateCcw size={14} /> Resume</button>
              )}
              {can.canApprove && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => setModal('approve')}><CheckCircle2 size={14} /> Approve</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setModal('sendback')}><RotateCcw size={14} /> Send back</button>
                </>
              )}
              {/* EDIT, SPELLED OUT. It was a bare pencil in the drawer header,
                  beside the close button, and people asked where editing was
                  while looking straight at it. Every sibling action is a
                  labelled button on this row; this one had no reason to be
                  the exception. The header icon stays for anyone used to it. */}
              {can.canEdit && <button className="btn btn-subtle btn-sm" onClick={() => setModal('edit')}><Pencil size={14} /> Edit task</button>}
              {can.canReopen && <button className="btn btn-subtle btn-sm" onClick={() => setModal('reopen')}><RotateCcw size={14} /> Reopen</button>}
              {can.canMarkDependent && <button className="btn btn-subtle btn-sm" onClick={() => setModal('dependent')}><Link2 size={14} /> Dependent on others</button>}
              {can.canBlock && <button className="btn btn-subtle btn-sm" onClick={() => setModal('blocked')}><Ban size={14} /> Blocked by</button>}
              {can.canRevise && <button className="btn btn-subtle btn-sm" onClick={() => setModal('revise')}><CalendarClock size={14} /> Change deadline</button>}
              {can.canReassign && <button className="btn btn-subtle btn-sm" onClick={() => setModal('reassign')}><UserCog size={14} /> Reassign</button>}
              {can.canAddSubtask && <button className="btn btn-subtle btn-sm" onClick={() => setModal('subtask')}><Layers size={14} /> Sub-task</button>}
              {can.canManagementRemark && <button className="btn btn-subtle btn-sm" onClick={() => setModal('management')}><Megaphone size={14} /> Follow-up</button>}
              {can.canComment && <button className="btn btn-subtle btn-sm" onClick={() => setModal('coordinator')}><StickyNote size={14} /> Note</button>}
              {can.canFollowUp && <button className="btn btn-subtle btn-sm" onClick={() => setModal('followup')}><PhoneCall size={14} /> Log call</button>}
              {can.canRemindersEdit && <button className="btn btn-subtle btn-sm" onClick={() => setModal('reminders')}><Bell size={14} /> Reminders</button>}
              {can.canDelete && <button className="btn btn-ghost btn-sm danger-text" onClick={() => setModal('delete')}><Trash2 size={14} /> Delete</button>}
            </div>
          )}

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'details', label: 'Details' },
              { value: 'conversation', label: 'Conversation', count: task.remarks?.length || 0 },
              { value: 'subtasks', label: 'Sub-tasks', count: task.subtasks?.length || 0 },
              { value: 'history', label: 'History', count: (task.revisions?.length || 0) + (task.followups?.length || 0) },
            ]}
          />

          {tab === 'details' && (
            <div className="col gap-4">
              {task.ancestors?.length > 0 && (
                <div className="row gap-1 wrap tiny muted">
                  {task.ancestors.map((a) => (
                    <button key={a._id} className="link-btn tiny" onClick={() => onOpenTask(a._id)}>{a.code} ›</button>
                  ))}
                  <span>{task.code}</span>
                </div>
              )}
              {task.description && <p className="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{task.description}</p>}

              <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 var(--space-6)' }}>
                <div>
                  <Meta icon={Send} label="Assigned by">{task.assigner?.name}</Meta>
                  <Meta icon={Users} label="Doer">
                    <span className="row gap-2" style={{ justifyContent: 'flex-end' }}><Avatar name={task.doer?.name} color={task.doer?.avatarColor} size={20} />{task.doer?.name}</span>
                  </Meta>
                  <Meta icon={UserCog} label="Reporting manager">{task.doer?.reportingManager?.name}</Meta>
                  <Meta icon={Building2} label="Branch">{task.branch ? `${task.branch.name} (${task.branch.code})` : null}</Meta>
                  <Meta icon={FolderKanban} label="Group">{task.group?.name}</Meta>
                  <Meta icon={Tag} label="Category">{task.category}</Meta>
                  {task.recurrence && (
                    <Meta icon={Repeat} label="Repeat rule">
                      <button className="link-btn" onClick={() => drawers.recurrence(task.recurrence._id)}>{FREQ_LABEL[task.recurrence.frequency]} — view all instances</button>
                    </Meta>
                  )}
                </div>
                <div>
                  <Meta icon={Clock} label="Due">
                    <span style={{ color: overdue ? 'var(--danger)' : undefined }}>
                      {task.dueDate ? fmtDateTime(task.dueDate) : '—'}
                      {dleft != null && task.status !== 'completed' && <span className="tiny"> · {dleft < 0 ? `${-dleft}d late` : dleft === 0 ? 'today' : `in ${dleft}d`}</span>}
                    </span>
                  </Meta>
                  <Meta icon={CalendarClock} label="Same-week revisions">{revisionsUsed} of 2 used</Meta>
                  <Meta icon={Megaphone} label="Follow-ups">{task.followUpCount || 0}</Meta>
                  <Meta icon={CheckCircle2} label="Completed">{task.completedAt ? fmtDateTime(task.completedAt) : null}</Meta>
                  <Meta icon={Clock} label="Created">{fmtDate(task.createdAt)}</Meta>
                  {(task.shiftedFrom || task.shiftedTo) && (
                    <Meta icon={GitBranch} label={task.shiftedTo ? 'Shifted to' : 'Shifted from'}>
                      <button className="link-btn" onClick={() => onOpenTask((task.shiftedTo || task.shiftedFrom)._id)}>{(task.shiftedTo || task.shiftedFrom).code}</button>
                    </Meta>
                  )}
                </div>
              </div>

              {(task.inLoop?.length > 0 || task.tags?.length > 0) && (
                <div className="row between wrap gap-3">
                  {task.inLoop?.length > 0 && (
                    <span className="row gap-2 sm muted">In the loop <AvatarStack people={task.inLoop} max={6} /></span>
                  )}
                  {task.tags?.length > 0 && (
                    <span className="row gap-1 wrap">{task.tags.map((t) => <span key={t} className="chip chip-sm">#{t}</span>)}</span>
                  )}
                </div>
              )}

              {task.dependencyDetails?.summary && (
                <div className="card card-pad" style={{ borderLeft: '3px solid var(--warning)' }}>
                  <span className="eyebrow">Dependency</span>
                  <div className="sm" style={{ fontWeight: 600, marginTop: 4 }}>{task.dependencyDetails.summary}</div>
                  <div className="sm muted">{task.dependencyDetails.remark}</div>
                </div>
              )}
              {task.blockedByDetails?.summary && (
                <div className="card card-pad" style={{ borderLeft: '3px solid var(--danger)' }}>
                  <span className="eyebrow">Blocked by</span>
                  <div className="sm" style={{ fontWeight: 600, marginTop: 4 }}>{task.blockedByDetails.summary}</div>
                  <div className="sm muted">{task.blockedByDetails.reason}</div>
                </div>
              )}

              {task.checklistItems?.length > 0 && (
                <div className="drawer-section">
                  <span className="eyebrow">Checklist · {task.checklistItems.filter((c) => c.completed).length}/{task.checklistItems.length}</span>
                  {task.checklistItems.map((c) => (
                    <label key={c._id} className={`check-item ${c.completed ? 'done' : ''}`}>
                      <input type="checkbox" checked={c.completed} disabled={!(can.canWork || can.canEdit) || update.isPending} onChange={() => toggleItem(c)} />
                      <span className="sm grow">{c.text}</span>
                    </label>
                  ))}
                </div>
              )}

              {(task.voiceNoteUrl || task.referenceDocs?.length > 0 || task.evidenceUrls?.length > 0) && (
                <div className="drawer-section col gap-3">
                  {task.voiceNoteUrl && (
                    <div className="col gap-1">
                      <span className="eyebrow row gap-1"><Volume2 size={12} /> Voice note</span>
                      <audio controls src={task.voiceNoteUrl} style={{ width: '100%' }} />
                    </div>
                  )}
                  {task.referenceDocs?.length > 0 && (
                    <div className="col gap-1"><span className="eyebrow">Reference documents</span><Attachments urls={task.referenceDocs} /></div>
                  )}
                  {task.evidenceUrls?.length > 0 && (
                    <div className="col gap-1"><span className="eyebrow">Proof of completion</span><Attachments urls={task.evidenceUrls} /></div>
                  )}
                </div>
              )}

              <RemarkChannel label="Management follow-ups" value={task.managementRemark} tone="var(--danger)" />
              <RemarkChannel label="Coordinator notes" value={task.coordinatorRemark} tone="var(--info)" />

              {task.reminders?.length > 0 && (
                <div className="drawer-section">
                  <span className="eyebrow">Reminders</span>
                  <div className="row gap-2 wrap">
                    {task.reminders.map((r) => (
                      <span key={r._id} className="chip chip-sm" style={{ opacity: r.sentAt ? 0.55 : 1 }} title={r.sentAt ? `Sent ${fmtDateTime(r.sentAt)}` : `Fires ${fmtDateTime(r.fireAt)}`}>
                        <Bell size={11} /> {r.value} {r.unit} {r.trigger}{r.sentAt ? ' · sent' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'conversation' && (
            <div className="col gap-4">
              <div className="timeline">
                {(task.remarks || []).map((r) => (
                  <div key={r._id} className={`timeline-item ${r.kind}`}>
                    <Avatar name={r.author?.name} color={r.author?.avatarColor} size={28} />
                    <div className="bubble">
                      <div className="row between gap-2">
                        <span className="sm" style={{ fontWeight: 650 }}>
                          {r.author?.name}
                          {r.kind === 'management' && <span className="tiny danger-text"> · follow-up</span>}
                          {r.kind === 'coordinator' && <span className="tiny" style={{ color: 'var(--info)' }}> · note</span>}
                          {r.fromSubtask && <span className="tiny subtle"> · on sub-task "{r.subtaskTitle}"</span>}
                        </span>
                        <span className="tiny subtle" title={fmtDateTime(r.createdAt)}>{fromNow(r.createdAt)}</span>
                      </div>
                      <div className="sm" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{r.body}</div>
                      {r.attachments?.length > 0 && <div style={{ marginTop: 6 }}><Attachments urls={r.attachments} /></div>}
                    </div>
                  </div>
                ))}
                {!task.remarks?.length && <div className="empty sm">No conversation yet</div>}
              </div>
              {can.canComment && !task.deletedAt && (
                <div className="card card-pad col gap-2">
                  <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment — everyone on the task is notified" />
                  <div className="row between gap-2">
                    <FileUploader value={files} onChange={setFiles} label="Attach" />
                    <button className="btn btn-primary btn-sm" onClick={sendComment} disabled={!comment.trim() || busy}><MessageSquare size={14} /> Comment</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'subtasks' && (
            <div className="col gap-2">
              {task.subtasks?.length ? <SubtaskTree nodes={task.subtasks} onOpen={onOpenTask} /> : <div className="empty sm">No sub-tasks yet</div>}
              {task.assigneeHierarchy && <div className="tiny muted">Passed down: {task.doer?.name} → {task.assigneeHierarchy}</div>}
              {can.canAddSubtask && <button className="btn btn-subtle btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setModal('subtask')}><Layers size={14} /> Add sub-task</button>}
            </div>
          )}

          {tab === 'history' && (
            <div className="col gap-4">
              {task.followups?.length > 0 && (
                <div className="drawer-section">
                  <span className="eyebrow">Follow-up calls</span>
                  {task.followups.map((f) => (
                    <div key={f._id} className="remark-line">
                      <div className="row between"><span className="sm" style={{ fontWeight: 600 }}>{f.follower?.name} · {f.callStatus === 'connected' ? 'Connected' : 'Not connected'}</span><span className="tiny subtle">{fmtDateTime(f.createdAt)}</span></div>
                      <div className="tiny muted">
                        {[f.observedStatus && `Reported: ${f.observedStatus}`, f.systemUpdated != null && `ERP updated: ${f.systemUpdated ? 'yes' : 'no'}`, f.nextFollowUpDate && `Next: ${fmtDate(f.nextFollowUpDate)}`].filter(Boolean).join(' · ')}
                        {f.escalationRequired && <span className="danger-text"> · escalation required</span>}
                      </div>
                      {f.response && <div className="sm">{f.response}</div>}
                    </div>
                  ))}
                </div>
              )}
              <div className="drawer-section">
                <span className="eyebrow">Status & date changes</span>
                <div className="col gap-2">
                  {(task.revisions || []).map((r) => (
                    <div key={r._id} className="remark-line">
                      <div className="row between gap-2">
                        <span className="sm">
                          {r.oldStatus !== r.newStatus ? (
                            <><span className="muted">{DLG_STATUS_META[r.oldStatus]?.label}</span> → <b>{DLG_STATUS_META[r.newStatus]?.label}</b></>
                          ) : r.oldDueDate && r.newDueDate && r.oldDueDate !== r.newDueDate ? (
                            <><span className="muted">{fmtDate(r.oldDueDate)}</span> → <b>{fmtDate(r.newDueDate)}</b></>
                          ) : (
                            <b>Updated</b>
                          )}
                        </span>
                        <span className="tiny subtle">{r.changedBy?.name} · {fmtDateTime(r.createdAt)}</span>
                      </div>
                      {r.reason && <div className="tiny muted">{r.reason}</div>}
                    </div>
                  ))}
                  {!task.revisions?.length && <div className="tiny muted">No changes yet</div>}
                </div>
              </div>
              <div className="drawer-section">
                <span className="eyebrow">Activity</span>
                {(task.activity || []).map((a) => (
                  <div key={a._id} className="row gap-2 sm" style={{ padding: '5px 0' }}>
                    <Avatar name={a.actor?.name} color={a.actor?.avatarColor} size={20} />
                    <span className="grow"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.description}</span></span>
                    <span className="tiny subtle nowrap">{fromNow(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {task && (
        <>
          <CompleteModal task={task} open={modal === 'complete'} onClose={close} />
          <ReviseDateModal
            task={task}
            open={modal === 'revise'}
            onClose={close}
            onDone={(res) => res?.meta?.outcome === 'shifted' && res?.data?._id && onOpenTask(res.data._id)}
          />
          <DependentModal task={task} open={modal === 'dependent'} onClose={close} />
          <BlockedModal task={task} open={modal === 'blocked'} onClose={close} />
          <ReassignModal task={task} open={modal === 'reassign'} onClose={close} />
          <ChannelRemarkModal task={task} channel="management" open={modal === 'management'} onClose={close} canSetStatus={can.isAdmin || can.isAssigner} />
          <ChannelRemarkModal task={task} channel="coordinator" open={modal === 'coordinator'} onClose={close} />
          <FollowupModal task={task} open={modal === 'followup'} onClose={close} />
          <RemindersModal task={task} open={modal === 'reminders'} onClose={close} />
          <EditTaskModal task={task} open={modal === 'edit'} onClose={close} />
          <TaskFormModal open={modal === 'subtask'} onClose={close} parent={task} />
          <ReasonModal
            open={modal === 'approve'}
            onClose={close}
            title="Approve task"
            subtitle={`${task.code} · submitted ${task.completedAt ? fromNow(task.completedAt) : ''}`}
            label="Remark"
            required={false}
            confirmLabel="Approve"
            onSubmit={(remark) => quick('approve', { remark: remark || undefined }, 'Task approved')}
          />
          <ReasonModal open={modal === 'sendback'} onClose={close} title="Send back for rework" label="What needs fixing?" confirmLabel="Send back" danger onSubmit={(reason) => quick('send-back', { reason }, 'Sent back for rework')} />
          <ReasonModal open={modal === 'reopen'} onClose={close} title="Reopen task" label="Why reopen?" confirmLabel="Reopen" onSubmit={(reason) => quick('reopen', { reason }, 'Task reopened')} />
          <Modal
            open={modal === 'delete'}
            onClose={close}
            title="Move to trash?"
            subtitle={task.subtasks?.length ? `Its ${task.subtasks.length} sub-task(s) go too. You can restore from the trash.` : 'You can restore it from the trash.'}
            width={460}
            footer={
              <>
                <button className="btn btn-ghost" onClick={close}>Cancel</button>
                <button
                  className="btn btn-danger"
                  disabled={remove.isPending}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(task._id);
                      toast.success('Moved to trash');
                      close();
                      onClose();
                    } catch (e) {
                      toast.error(errMsg(e));
                    }
                  }}
                >
                  Delete
                </button>
              </>
            }
          >
            <p className="sm">{task.code} · {task.title}</p>
          </Modal>
        </>
      )}
    </Drawer>
  );
}

export default TaskDetailDrawer;
