import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useUpdateTask, useUsers } from '../../lib/queries.js';
import { TASK_STATUS_META, TASK_STATUS_ORDER, PRIORITY_META, DEPT_META } from '../../lib/ui.js';
import { fmtDate } from '../../lib/format.js';

export function TaskDetailModal({ task, projectId, onClose }) {
  const update = useUpdateTask(projectId);
  const users = useUsers();
  const [checklist, setChecklist] = useState([]);

  useEffect(() => {
    setChecklist(task?.checklist?.map((c) => ({ ...c })) || []);
  }, [task]);

  if (!task) return null;

  const patch = (body) => update.mutate({ id: task._id, ...body });

  const toggleCheck = (idx) => {
    const next = checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    setChecklist(next);
    patch({ checklist: next.map(({ label, done, required }) => ({ label, done, required })) });
  };

  return (
    <Modal open={!!task} onClose={onClose} title={task.title} subtitle={`${task.code} · ${task.stageName}`} width={600}>
      <div className="col gap-4">
        {task.description && <p className="sm muted">{task.description}</p>}

        <div className="row gap-4 wrap">
          <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="label">Status</label>
            <select className="select" defaultValue={task.status} onChange={(e) => patch({ status: e.target.value })}>
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
            </select>
          </div>
          <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="label">Priority</label>
            <select className="select" defaultValue={task.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {Object.keys(PRIORITY_META).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Assignee</label>
          <select
            className="select"
            defaultValue={task.assignee?._id || ''}
            onChange={(e) => patch({ assignee: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {(users.data || []).map((u) => (
              <option key={u._id} value={u._id}>{u.name} · {u.title || u.role}</option>
            ))}
          </select>
        </div>

        <div className="row gap-5 sm" style={{ padding: '12px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div className="col"><span className="tiny subtle upper">Department</span><span>{DEPT_META[task.department] || '—'}</span></div>
          <div className="col"><span className="tiny subtle upper">Planned start</span><span>{fmtDate(task.plannedStart)}</span></div>
          <div className="col"><span className="tiny subtle upper">Due</span><span>{fmtDate(task.plannedEnd)}</span></div>
          <div className="col"><span className="tiny subtle upper">Est. hours</span><span>{task.estimatedHours}h</span></div>
        </div>

        {checklist.length > 0 && (
          <div className="col gap-2">
            <span className="label">Checklist</span>
            {checklist.map((c, i) => (
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
