import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, Trash2, Paperclip, Image as ImageIcon, FileText, Link2, AlertTriangle, Ban, CheckCircle2, Clock,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge, Avatar } from '../../components/ui/primitives.jsx';
import {
  useUpdateTask, useUsers, useTask, useUploadTaskAttachment, useDeleteTaskAttachment,
} from '../../lib/queries.js';
import { TASK_STATUS_META, TASK_STATUS_ORDER, PRIORITY_META, deptMeta } from '../../lib/ui.js';
import { fmtDate, fmtFileSize, daysUntil } from '../../lib/format.js';

const extOf = (name = '') => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
function isImage(a) {
  return (a.mimetype || '').startsWith('image/') || a.resourceType === 'image'
    || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extOf(a.originalName));
}

/** One attachment row — image thumbnail or file chip, open link, delete. */
function AttachmentRow({ a, onDelete, deleting }) {
  const img = isImage(a);
  return (
    <div className="row gap-2" style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', alignItems: 'center' }}>
      {img ? (
        <a href={a.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
          <img src={a.url} alt={a.originalName || ''} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
        </a>
      ) : (
        <span className="center" style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface-hover)', color: 'var(--text-subtle)', flexShrink: 0 }}>
          <FileText size={18} />
        </span>
      )}
      <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.originalName}>
          {a.originalName || 'file'}
        </span>
        <span className="tiny muted">{a.bytes ? fmtFileSize(a.bytes) : ''}{a.uploadedBy?.name ? ` · ${a.uploadedBy.name}` : ''}</span>
      </div>
      <a className="btn btn-ghost btn-sm" href={a.url} target="_blank" rel="noreferrer">{img ? 'Open' : 'Preview'}</a>
      {onDelete && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--danger)' }} disabled={deleting} onClick={() => onDelete(a)} title="Delete attachment">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Task detail drawer — the Phase 6 "tracking engine" surface. Beyond the basic
 * status/priority/assignee/checklist edit, it surfaces the three things
 * Execution is really about: the attachment pipeline (site images, receipts,
 * blueprints), inter-task dependencies with a live blocker signal, and the
 * delay / root-cause state. `allTasks` (the project's full task list) is used
 * to resolve each dependency's live status without an extra fetch.
 */
export function TaskDetailModal({ task, projectId, allTasks = [], onClose }) {
  const update = useUpdateTask(projectId);
  const users = useUsers();
  const { data: fresh } = useTask(task?._id);
  const upload = useUploadTaskAttachment(projectId);
  const removeAttachment = useDeleteTaskAttachment(projectId);
  const fileRef = useRef(null);

  const t = fresh || task;
  const [checklist, setChecklist] = useState([]);
  const [uploadPct, setUploadPct] = useState(null);
  const [uploadErr, setUploadErr] = useState('');

  useEffect(() => {
    setChecklist(t?.checklist?.map((c) => ({ ...c })) || []);
  }, [t?._id, t?.checklist?.length]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const x of allTasks) m.set(String(x._id), x);
    return m;
  }, [allTasks]);

  if (!task) return null;

  const patch = (body) => update.mutate({ id: t._id, ...body });

  const toggleCheck = (idx) => {
    const next = checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    setChecklist(next);
    patch({ checklist: next.map(({ label, done, required }) => ({ label, done, required })) });
  };

  const doneCount = checklist.filter((c) => c.done).length;
  const progress = checklist.length ? Math.round((doneCount / checklist.length) * 100) : (t.status === 'done' ? 100 : 0);

  const dLeft = t.plannedEnd ? daysUntil(t.plannedEnd) : null;
  const overdue = t.status !== 'done' && dLeft != null && dLeft < 0;
  const blocked = t.status === 'blocked';

  // Dependencies resolved to their live status — the honest, task-level
  // "critical path" signal: any unfinished dependency is actively blocking.
  const deps = (t.dependencies || []).map((d) => {
    const full = byId.get(String(d._id || d));
    return { _id: String(d._id || d), code: d.code || full?.code, title: d.title || full?.title, status: full?.status };
  });
  const blockingDeps = deps.filter((d) => d.status && d.status !== 'done');

  const onPickFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setUploadErr('');
    for (const file of files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await upload.mutateAsync({ taskId: t._id, file, onProgress: setUploadPct });
      } catch (err) {
        setUploadErr(err?.response?.data?.message || `Couldn't upload "${file.name}".`);
      }
    }
    setUploadPct(null);
  };

  const onDeleteAttachment = (a) => {
    if (!window.confirm(`Delete "${a.originalName || 'this file'}"? This removes it from storage too.`)) return;
    removeAttachment.mutate({ taskId: t._id, attachmentId: a._id });
  };

  const attachments = t.attachments || [];
  const st = TASK_STATUS_META[t.status] || {};
  const dm = deptMeta(t.department);

  return (
    <Modal open={!!task} onClose={onClose} title={t.title} subtitle={`${t.code} · ${t.stageName || 'Execution'}`} width={640}>
      <div className="col gap-4">
        {/* Delay / blocker banner — capability #4 */}
        {(overdue || blocked || blockingDeps.length > 0) && (
          <div className="col gap-2" style={{ padding: '10px 12px', borderRadius: 8, background: overdue ? 'var(--danger)0F' : 'var(--warning)0F', border: `1px solid ${overdue ? 'var(--danger)' : 'var(--warning)'}33` }}>
            {overdue && (
              <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--danger)', fontWeight: 600 }}>
                <AlertTriangle size={15} /> Overdue by {Math.abs(dLeft)} day{Math.abs(dLeft) === 1 ? '' : 's'} — due {fmtDate(t.plannedEnd)}
              </span>
            )}
            {blocked && (
              <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--warning)', fontWeight: 600 }}>
                <Ban size={15} /> Marked as blocked
              </span>
            )}
            {blockingDeps.length > 0 && (
              <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--warning)' }}>
                <Clock size={15} /> Waiting on {blockingDeps.length} unfinished {blockingDeps.length === 1 ? 'dependency' : 'dependencies'}: {blockingDeps.map((d) => d.code).join(', ')}
              </span>
            )}
            {t.extensionRequest?.reason && (
              <span className="tiny muted">Root cause on record: “{t.extensionRequest.reason}”</span>
            )}
          </div>
        )}

        {t.description && <p className="sm muted" style={{ margin: 0 }}>{t.description}</p>}

        <div className="row gap-4 wrap">
          <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="label">Status</label>
            <select className="select" value={t.status} onChange={(e) => patch({ status: e.target.value })}>
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
            </select>
          </div>
          <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="label">Priority</label>
            <select className="select" value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {Object.keys(PRIORITY_META).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Assignee</label>
          <select className="select" value={t.assignee?._id || ''} onChange={(e) => patch({ assignee: e.target.value || null })}>
            <option value="">Unassigned</option>
            {(users.data || []).map((u) => (
              <option key={u._id} value={u._id}>{u.name} · {u.title || u.role}</option>
            ))}
          </select>
        </div>

        {/* Progress — capability #1 (completion %) */}
        <div className="col gap-1">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label" style={{ marginBottom: 0 }}>Progress</span>
            <span className="tiny muted">{progress}%{checklist.length ? ` · ${doneCount}/${checklist.length} checklist` : ''}</span>
          </div>
          <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gradient-primary)' }} />
          </div>
        </div>

        <div className="row gap-5 sm wrap" style={{ padding: '12px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div className="col"><span className="tiny subtle upper">Department</span><span>{t.department ? <Badge color={dm.color}>{dm.label}</Badge> : '—'}</span></div>
          <div className="col"><span className="tiny subtle upper">Status</span><span><Badge color={st.color} soft={st.soft} dot>{st.label || t.status}</Badge></span></div>
          <div className="col"><span className="tiny subtle upper">Planned start</span><span>{fmtDate(t.plannedStart)}</span></div>
          <div className="col"><span className="tiny subtle upper">Due</span><span>{fmtDate(t.plannedEnd)}</span></div>
          <div className="col"><span className="tiny subtle upper">Est. hours</span><span>{t.estimatedHours || 0}h</span></div>
        </div>

        {/* Dependencies — capability #3 */}
        <div className="col gap-2">
          <span className="label row gap-2" style={{ alignItems: 'center', marginBottom: 0 }}><Link2 size={14} /> Dependencies</span>
          {deps.length === 0 ? (
            <span className="tiny muted">No dependencies — this task can start independently.</span>
          ) : (
            <div className="col gap-1">
              {deps.map((d) => {
                const ds = TASK_STATUS_META[d.status] || {};
                const isBlocking = d.status && d.status !== 'done';
                return (
                  <div key={d._id} className="row gap-2" style={{ alignItems: 'center', padding: '6px 8px', borderRadius: 6, background: 'var(--surface-2)' }}>
                    {d.status === 'done' ? <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} /> : <Clock size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
                    <span className="tiny" style={{ fontWeight: 600 }}>{d.code}</span>
                    <span className="sm grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || ''}</span>
                    {d.status && <Badge color={ds.color} soft={ds.soft} dot>{ds.label || d.status}</Badge>}
                    {isBlocking && <span className="tiny" style={{ color: 'var(--warning)', fontWeight: 600, flexShrink: 0 }}>Blocking</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Attachments — capability #2 */}
        <div className="col gap-2">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="label row gap-2" style={{ alignItems: 'center', marginBottom: 0 }}><Paperclip size={14} /> Attachments ({attachments.length})</span>
            <button type="button" className="btn btn-subtle btn-sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              <Upload size={13} style={{ marginRight: 6 }} /> {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv" style={{ display: 'none' }} onChange={onPickFiles} />
          </div>
          <span className="tiny muted" style={{ marginTop: -4 }}>Site images, compliance receipts, technical blueprints (images, PDF, Office docs).</span>
          {uploadPct != null && (
            <div style={{ height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--gradient-primary)', transition: 'width .2s' }} />
            </div>
          )}
          {uploadErr && <span className="tiny" style={{ color: 'var(--danger)' }}>{uploadErr}</span>}
          {attachments.length === 0 ? (
            <div className="row gap-2 tiny muted" style={{ alignItems: 'center', padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 8 }}>
              <ImageIcon size={16} /> No attachments yet — upload site evidence, receipts or blueprints.
            </div>
          ) : (
            <div className="col gap-2">
              {attachments.map((a) => (
                <AttachmentRow key={a._id} a={a} onDelete={onDeleteAttachment} deleting={removeAttachment.isPending} />
              ))}
            </div>
          )}
        </div>

        {/* Checklist */}
        {checklist.length > 0 && (
          <div className="col gap-2">
            <span className="label" style={{ marginBottom: 0 }}>Checklist</span>
            {checklist.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <label key={i} className="row gap-2 sm" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={!!c.done} onChange={() => toggleCheck(i)} />
                <span style={{ textDecoration: c.done ? 'line-through' : 'none', color: c.done ? 'var(--text-subtle)' : 'var(--text)' }}>
                  {c.label}{c.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default TaskDetailModal;
