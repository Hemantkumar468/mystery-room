import { useRef, useState } from 'react';
import {
  CalendarRange,
  Database,
  FileText,
  History,
  ListChecks,
  Paperclip,
  Play,
  RotateCcw,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar, Badge } from '../../components/ui/primitives.jsx';
import { SkeletonRow, SkeletonTileGrid, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useProjectActivity } from '../../app/api/projectsApi.js';
import {
  useBoard,
  useUpdateTaskStatus,
  useUploadTaskAttachment,
  useDeleteTaskAttachment,
} from '../../app/api/tasksApi.js';
import { DEPT_META, PRIORITY_META, STAGE_STATUS_META, TASK_STATUS_META } from '../../lib/ui.js';
import { fmtCurrency, fmtDate, fromNow } from '../../lib/format.js';
import dayjs from '../../lib/dayjs.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';

const EMPTY = 'Data not available';

// Statuses the doer control exposes, in workflow order. A task sitting in a
// board-only state (blocked/review) keeps that value shown as the current option.
const DOER_STATUSES = ['todo', 'in_progress', 'done'];

/**
 * Client-side mirror of the server's doer check (task.service.js): the assigned
 * User, a login account whose employeeId matches the roster primary/backup/
 * assignees, or a manager/admin. UI-only — the API re-checks and returns 403.
 */
function canChangeTaskStatus(user, task) {
  if (!user) return false;
  if (can.decide(user.role)) return true;
  const uid = String(user._id || user.id || '');
  const assigneeId = task.assignee?._id || task.assignee;
  if (assigneeId && String(assigneeId) === uid) return true;
  const emp = user.employeeId;
  return Boolean(
    emp
    && (emp === task.primaryAssignee
      || emp === task.backupAssignee
      || (task.assignees || []).includes(emp)),
  );
}

function TaskStatusControl({ task, projectId, canChange }) {
  const updateStatus = useUpdateTaskStatus(projectId);
  const options = DOER_STATUSES.includes(task.status)
    ? DOER_STATUSES
    : [task.status, ...DOER_STATUSES];
  const disabled = !canChange || updateStatus.isPending;
  return (
    <div className="col gap-1" style={{ minWidth: 140 }}>
      <select
        className="select"
        value={task.status}
        disabled={disabled}
        title={canChange
          ? 'Change task status'
          : 'Only the assigned doer can change this task’s status'}
        onChange={(e) => updateStatus.mutate({ id: task._id, status: e.target.value })}
        style={{
          padding: '6px 10px',
          fontSize: 13,
          opacity: disabled ? 0.65 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {options.map((s) => (
          <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>
        ))}
      </select>
      {updateStatus.isError && (
        <span className="tiny" style={{ color: 'var(--danger)' }}>Update failed — try again</span>
      )}
    </div>
  );
}

const isImageAttachment = (att) => (att.mimetype || '').startsWith('image/');
const isVideoAttachment = (att) => (att.mimetype || '').startsWith('video/');

// File-picker accept list — kept in lockstep with the backend Multer filter.
const ACCEPT_TYPES = 'image/*,video/mp4,video/quicktime,video/webm,application/pdf';

/** Modal preview for an image or video attachment (others open in a new tab). */
function AttachmentPreview({ attachment, onClose }) {
  if (!attachment) return null;
  return (
    <Modal open onClose={onClose} title={attachment.originalName || 'Attachment'} width={760}>
      <div className="center" style={{ maxHeight: '72vh' }}>
        {isImageAttachment(attachment) && (
          <img
            src={attachment.url}
            alt={attachment.originalName}
            style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 8 }}
          />
        )}
        {isVideoAttachment(attachment) && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={attachment.url}
            controls
            autoPlay
            style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 8, background: '#000' }}
          />
        )}
      </div>
    </Modal>
  );
}

/**
 * File upload + attachment list for one task. Supports multiple images / videos /
 * PDFs with per-file progress, a clear failure reason + retry, and click-to-preview.
 * Upload/delete are gated to the task's doer (`canManage`); the backend re-checks.
 */
function TaskAttachments({ task, projectId, canManage }) {
  const upload = useUploadTaskAttachment(projectId);
  const remove = useDeleteTaskAttachment(projectId);
  const inputRef = useRef(null);
  const idRef = useRef(0);
  const [uploads, setUploads] = useState([]); // in-flight: [{ id, name, file, progress, error }]
  const [preview, setPreview] = useState(null);

  const attachments = task.attachments || [];

  const runUpload = async (file, uid) => {
    setUploads((u) => u.map((x) => (x.id === uid ? { ...x, progress: 0, error: null } : x)));
    try {
      await upload.mutateAsync({
        taskId: task._id,
        file,
        onProgress: (p) =>
          setUploads((u) => u.map((x) => (x.id === uid ? { ...x, progress: p } : x))),
      });
      setUploads((u) => u.filter((x) => x.id !== uid)); // clear on success
    } catch (err) {
      // Surface the real reason from the API instead of a bare "Failed".
      const reason =
        err?.response?.data?.message || err?.message || 'Upload failed — please try again';
      setUploads((u) => u.map((x) => (x.id === uid ? { ...x, error: reason } : x)));
    }
  };

  const onPick = (e) => {
    const files = [...e.target.files];
    e.target.value = ''; // allow re-picking the same file later
    for (const file of files) {
      const uid = (idRef.current += 1);
      setUploads((u) => [...u, { id: uid, name: file.name, file, progress: 0, error: null }]);
      runUpload(file, uid);
    }
  };

  const dismiss = (uid) => setUploads((u) => u.filter((x) => x.id !== uid));

  const openAttachment = (att) => {
    if (isImageAttachment(att) || isVideoAttachment(att)) setPreview(att);
    else window.open(att.url, '_blank', 'noopener,noreferrer'); // PDFs / other → new tab
  };

  const thumbStyle = {
    width: 36,
    height: 36,
    borderRadius: 6,
    flexShrink: 0,
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    background: 'var(--surface-hover)',
  };

  return (
    <div className="col gap-2" style={{ padding: '4px 0 12px' }}>
      <div className="row between">
        <span className="tiny subtle upper">Attachments</span>
        {canManage && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_TYPES}
              style={{ display: 'none' }}
              onChange={onPick}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip size={14} /> Attach File
            </button>
          </>
        )}
      </div>

      {!attachments.length && !uploads.length && (
        <span className="tiny muted">
          {canManage ? 'No files yet — attach images, videos or PDFs.' : 'No files uploaded.'}
        </span>
      )}

      <div className="col gap-2">
        {attachments.map((att) => (
          <div
            key={att._id}
            className="row gap-2"
            style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}
          >
            <button
              type="button"
              className="center"
              style={thumbStyle}
              title="Preview"
              onClick={() => openAttachment(att)}
            >
              {isImageAttachment(att) ? (
                <img
                  src={att.url}
                  alt={att.originalName}
                  style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }}
                />
              ) : isVideoAttachment(att) ? (
                <Play size={18} style={{ color: 'var(--text)' }} />
              ) : (
                <FileText size={18} className="subtle" />
              )}
            </button>
            <button
              type="button"
              className="sm grow"
              onClick={() => openAttachment(att)}
              style={{
                fontWeight: 600,
                wordBreak: 'break-all',
                color: 'var(--text)',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {att.originalName || 'file'}
            </button>
            {canManage && (
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                title="Remove attachment"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ taskId: task._id, attachmentId: att._id })}
              >
                <Trash2 size={14} style={{ color: 'var(--danger)' }} />
              </button>
            )}
          </div>
        ))}

        {uploads.map((u) => (
          <div key={u.id} className="col gap-1" style={{ padding: 6, border: '1px dashed var(--border)', borderRadius: 8 }}>
            <div className="row between tiny gap-2">
              <span className="muted grow" style={{ wordBreak: 'break-all' }}>{u.name}</span>
              {u.error ? (
                <span className="row gap-1" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => runUpload(u.file, u.id)}
                    title="Retry upload"
                  >
                    <RotateCcw size={12} /> Retry
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => dismiss(u.id)}
                    title="Dismiss"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{u.progress}%</span>
              )}
            </div>
            {u.error ? (
              <span className="tiny" style={{ color: 'var(--danger)', wordBreak: 'break-word' }}>{u.error}</span>
            ) : (
              <div className="progress" style={{ height: 5 }}>
                <div className="progress-bar" style={{ width: `${u.progress}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <AttachmentPreview attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

const pluralDays = (n) => `${n} ${Number(n) === 1 ? 'day' : 'days'}`;

function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.max(0, dayjs(end).startOf('day').diff(dayjs(start).startOf('day'), 'day'));
}

function timingForStage(stage) {
  const slaDays = Number(stage.slaDays) || 0;
  const actualStart = stage.startedAt || null;
  const actualEnd = stage.completedAt || null;
  const fallbackStart = actualStart || stage.plannedStart;
  const fallbackEnd = actualEnd || (stage.status === 'completed' ? stage.plannedEnd : null);
  const completed = stage.status === 'completed';

  if (completed && fallbackStart && fallbackEnd) {
    const days = daysBetween(fallbackStart, fallbackEnd);
    const verdict = days > slaDays ? 'Delayed' : days < slaDays ? 'Ahead' : 'On time';
    const color = verdict === 'Delayed' ? 'var(--danger)' : 'var(--success)';
    return {
      label: `Completed in ${pluralDays(days)} (SLA: ${pluralDays(slaDays)}) - ${verdict}`,
      color,
    };
  }

  if ((stage.status === 'in_progress' || stage.status === 'blocked') && actualStart) {
    const days = daysBetween(actualStart, new Date());
    const verdict = days > slaDays ? 'Delayed' : 'On time';
    return {
      label: `In progress for ${pluralDays(days)} (SLA: ${pluralDays(slaDays)}) - ${verdict}`,
      color: verdict === 'Delayed' ? 'var(--danger)' : 'var(--success)',
    };
  }

  const plannedDays = daysBetween(stage.plannedStart, stage.plannedEnd);
  return {
    label:
      plannedDays == null
        ? `Actual time not available (SLA: ${pluralDays(slaDays)})`
        : `Actual time not available (planned ${pluralDays(plannedDays)}, SLA: ${pluralDays(slaDays)})`,
    color: 'var(--text-muted)',
  };
}

function flattenBoard(board) {
  return board?.columns?.flatMap((column) => column.tasks || []) || [];
}

function stageOrderLabel(stage) {
  return Number.isFinite(stage.order) ? `Stage ${stage.order + 1}` : 'Stage';
}

function personFromUser(user, detail = '') {
  if (!user?.name) return null;
  return {
    key: `user:${user._id || user.name}`,
    name: user.name,
    color: user.avatarColor,
    detail: detail || user.title || user.role || '',
  };
}

function personFromEmployeeId(id, detail = '') {
  if (!id) return null;
  const employee = getEmployeeById(id);
  if (!employee) return null;
  return {
    key: `employee:${employee.id}`,
    name: employee.name,
    color: employee.avatarColor,
    detail: detail || employee.role,
  };
}

function taskPrimaryPerson(task) {
  return personFromUser(task.assignee, 'Task assignee')
    || personFromEmployeeId(task.primaryAssignee, 'Primary doer')
    || personFromEmployeeId(task.assignees?.[0], 'Task assignee');
}

function buildContributors(stage, tasks, activities) {
  const people = new Map();
  const add = (person) => {
    if (!person) return;
    if (!people.has(person.key)) people.set(person.key, person);
  };

  add(personFromUser(stage.completedBy, 'Completed stage'));
  tasks.forEach((task) => {
    add(personFromUser(task.assignee, 'Task assignee'));
    add(personFromEmployeeId(task.primaryAssignee, 'Primary doer'));
    add(personFromEmployeeId(task.backupAssignee, 'Backup'));
    (task.assignees || []).forEach((id) => add(personFromEmployeeId(id, 'Task assignee')));
  });
  activities.forEach((activity) => {
    add(personFromUser(activity.actor, 'Activity'));
  });

  return [...people.values()];
}

function isEmptyValue(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function formatMasterValue(field, value) {
  if (isEmptyValue(value)) return EMPTY;
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'Yes' : 'No';
    case 'currency':
      return fmtCurrency(value);
    case 'date':
      return fmtDate(value);
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'user': {
      const employee = getEmployeeById(value);
      return employee?.name || String(value);
    }
    default:
      return String(value);
  }
}

function DetailSection({ icon: Icon, title, children }) {
  return (
    <section className="col gap-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
      <div className="row gap-2">
        <Icon size={15} className="subtle" />
        <span className="section-title" style={{ fontSize: 14 }}>{title}</span>
      </div>
      {children}
    </section>
  );
}

function InfoCell({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 150 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value}</span>
    </div>
  );
}

function EmptyLine({ children = EMPTY }) {
  return <div className="empty sm" style={{ padding: '16px 12px' }}>{children}</div>;
}

function filterStageActivity(activities, stage, tasks) {
  const taskIds = new Set(tasks.map((task) => String(task._id)));
  return (activities || []).filter((activity) => (
    activity.meta?.stageKey === stage.key
    || (activity.entityType === 'task' && taskIds.has(String(activity.entityId)))
  ));
}

export function StageDetailModal({ project, stage, onClose }) {
  const templateId = project.template?.ref?._id || project.template?.ref;
  const { data: board, isLoading: tasksLoading } = useBoard(project._id);
  const { data: activities, isLoading: activityLoading } = useProjectActivity(project._id);
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const currentUser = useAppSelector(selectCurrentUser);

  if (!stage) return null;

  const stageMeta = STAGE_STATUS_META[stage.status] || { label: stage.status || 'Unknown', color: '#7c7784' };
  const timing = timingForStage(stage);
  const tasks = flattenBoard(board).filter((task) => task.stageKey === stage.key);
  const activity = filterStageActivity(activities, stage, tasks);
  const contributors = buildContributors(stage, tasks, activity);
  const templateStage = template?.stages?.find((item) => item.key === stage.key);
  const masterSchema = [...(templateStage?.masterDataSchema || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const masterValues = project.masterData?.[stage.key] || {};

  return (
    <Modal
      open={!!stage}
      onClose={onClose}
      title={stage.name}
      subtitle={`${stageOrderLabel(stage)}${DEPT_META[stage.ownerDepartment] ? ` - ${DEPT_META[stage.ownerDepartment]}` : ''}`}
      width={820}
    >
      <div className="col gap-5">
        <div className="row between wrap gap-3">
          <div className="row gap-3">
            <span className="badge-dot" style={{ background: stage.color, width: 12, height: 12 }} />
            <div className="col gap-1">
              <span className="tiny subtle upper">Stage Status</span>
              <Badge color={stageMeta.color}>{stageMeta.label}</Badge>
            </div>
          </div>
          <div className="sm" style={{ color: timing.color, fontWeight: 650 }}>{timing.label}</div>
        </div>

        <DetailSection icon={CalendarRange} title="Timeline">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' }}>
            <InfoCell label="Start Date" value={fmtDate(stage.plannedStart)} />
            <InfoCell label="End Date" value={fmtDate(stage.plannedEnd)} />
            <InfoCell label="SLA Duration" value={pluralDays(stage.slaDays || 0)} />
            <InfoCell label="Actual Start" value={fmtDate(stage.startedAt)} />
            <InfoCell label="Actual End" value={fmtDate(stage.completedAt)} />
            <InfoCell label="Actual Time" value={timing.label} tone={timing.color} />
          </div>
        </DetailSection>

        <DetailSection icon={UserRound} title="Assigned Employee/User">
          {contributors.length ? (
            <div className="row gap-3 wrap">
              {contributors.map((person) => (
                <span key={person.key} className="row gap-2" style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
                  <Avatar name={person.name} color={person.color} size={26} />
                  <span className="col" style={{ gap: 1 }}>
                    <span className="sm" style={{ fontWeight: 650 }}>{person.name}</span>
                    {person.detail && <span className="tiny muted">{person.detail}</span>}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <EmptyLine>Not available</EmptyLine>
          )}
        </DetailSection>

        <DetailSection icon={ListChecks} title="Relevant Tasks">
          {tasksLoading ? (
            <div className="col gap-3">
              <SkeletonRow cells={['15%', '45%', '15%', '15%']} />
              <SkeletonRow cells={['15%', '45%', '15%', '15%']} />
              <SkeletonRow cells={['15%', '45%', '15%', '15%']} />
            </div>
          ) : tasks.length ? (
            <div className="col">
              {tasks.map((task) => {
                const priorityMeta = PRIORITY_META[task.priority] || PRIORITY_META.medium;
                const assignee = taskPrimaryPerson(task);
                const canManage = canChangeTaskStatus(currentUser, task);
                return (
                  <div key={task._id} className="col" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="row between gap-3 wrap" style={{ padding: '12px 0' }}>
                      <div className="col gap-1 grow" style={{ minWidth: 220 }}>
                        <span className="mono tiny subtle">{task.code}</span>
                        <span className="sm" style={{ fontWeight: 650 }}>{task.title}</span>
                        <span className="tiny muted">
                          Due {fmtDate(task.plannedEnd)} - {assignee?.name || 'Unassigned'}
                        </span>
                      </div>
                      <div className="row gap-2 wrap" style={{ alignItems: 'flex-start' }}>
                        <Badge color={priorityMeta.color}>{priorityMeta.label}</Badge>
                        <TaskStatusControl
                          task={task}
                          projectId={project._id}
                          canChange={canManage}
                        />
                      </div>
                    </div>
                    <TaskAttachments task={task} projectId={project._id} canManage={canManage} />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLine>No stage-linked tasks available</EmptyLine>
          )}
        </DetailSection>

        <DetailSection icon={Database} title="Master Data">
          {templateLoading ? <SkeletonTileGrid count={4} /> : masterSchema.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--space-4)' }}>
              {masterSchema.map((field) => {
                const value = formatMasterValue(field, masterValues[field.key]);
                const missing = value === EMPTY;
                return (
                  <div key={field.key} className="col gap-1" style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <span className="tiny subtle upper">{field.label}</span>
                    <span className="sm" style={{ color: missing ? 'var(--text-muted)' : 'var(--text)', fontWeight: missing ? 500 : 650 }}>
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLine>No master-data fields configured for this stage</EmptyLine>
          )}
        </DetailSection>

        <DetailSection icon={History} title="Activity">
          {activityLoading ? <SkeletonActivity rows={3} /> : activity.length ? (
            <div className="col gap-3">
              {activity.map((item) => (
                <div key={item._id} className="row gap-3">
                  <Avatar name={item.actor?.name || 'System'} color={item.actor?.avatarColor || 'var(--ink-500)'} size={28} />
                  <div className="col grow">
                    <div className="sm"><b>{item.actor?.name || 'System'}</b> <span className="muted">{item.message}</span></div>
                    <div className="tiny muted">{fromNow(item.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine>No stage-linked activity available</EmptyLine>
          )}
        </DetailSection>
      </div>
    </Modal>
  );
}

export default StageDetailModal;
