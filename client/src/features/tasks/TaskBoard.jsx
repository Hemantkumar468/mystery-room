import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, AlertCircle, CheckSquare, GripVertical } from 'lucide-react';
import { useBoard, useUpdateTaskStatus } from '../../app/api/tasksApi.js';
import { TASK_STATUS_META, TASK_STATUS_ORDER, PRIORITY_META, isLegalTaskTransition } from '../../lib/ui.js';
import { Avatar, PriorityBadge } from '../../components/ui/primitives.jsx';
import { SkBoard } from '../../components/ui/Skeletons.jsx';
import { fmtDateShort, daysUntil } from '../../lib/format.js';

function TaskCard({ task, onDragStart, onOpen }) {
  const dleft = daysUntil(task.plannedEnd);
  const overdue = task.status !== 'done' && dleft != null && dleft < 0;
  const checklistTotal = task.checklist?.length || 0;
  const checklistDone = task.checklist?.filter((c) => c.done).length || 0;

  return (
    <div
      className="task-card"
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onOpen(task)}
    >
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="mono tiny subtle">{task.code}</span>
        <PriorityBadge value={task.priority} />
      </div>
      {/* Three-line clamp, no "Read more": the whole card already opens the
          task on click, so a second affordance inside it would be noise. The
          clamp is what stops one long title stretching a column to the height
          of the board. */}
      <div
        title={task.title}
        style={{
          fontWeight: 600,
          fontSize: 13.5,
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {task.title}
      </div>
      <div className="row gap-1 tiny muted" style={{ marginTop: 6 }}>
        <span
          className="badge-dot"
          style={{ background: PRIORITY_META[task.priority]?.color || 'var(--ink-400)' }}
        />
        {task.stageName}
      </div>

      <div className="row between" style={{ marginTop: 12 }}>
        <div className="row gap-2">
          {checklistTotal > 0 && (
            <span className="row gap-1 tiny muted"><CheckSquare size={12} />{checklistDone}/{checklistTotal}</span>
          )}
          <span
            className="row gap-1 tiny"
            style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)' }}
          >
            {overdue ? <AlertCircle size={12} /> : <Clock size={12} />}
            {fmtDateShort(task.plannedEnd)}
          </span>
        </div>
        {task.assignee ? (
          <Avatar name={task.assignee.name} color={task.assignee.avatarColor} size={24} />
        ) : (
          <span className="tiny subtle">Unassigned</span>
        )}
      </div>
    </div>
  );
}

/** Group a flat task list into the same `{ columns, total }` shape the
 * server's board() endpoint returns, for callers that already have a
 * (possibly stage-scoped) task list loaded and want the Kanban view without
 * a second, unscoped fetch. */
function boardFromTasks(tasks) {
  return {
    total: tasks.length,
    columns: TASK_STATUS_ORDER.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) })),
  };
}

/**
 * `tasks`, when passed, is rendered as-is (grouped client-side) instead of
 * fetching `/pms/tasks/board` — which has no stage filter and would pull in
 * every phase's tasks. Execution's own Kanban tab passes its already-loaded,
 * p6-scoped task list this way, so the board matches the Task List tab right
 * next to it instead of showing the whole project. Omit `tasks` (as
 * ProjectDetailPage's project-wide Task Board tab does) to keep the original
 * unscoped fetch.
 */
export function TaskBoard({ projectId, tasks: tasksProp }) {
  const navigate = useNavigate();
  const { data: fetchedData, isLoading } = useBoard(tasksProp ? undefined : projectId);
  const data = tasksProp ? boardFromTasks(tasksProp) : fetchedData;
  const updateStatus = useUpdateTaskStatus(projectId);
  const [dragOver, setDragOver] = useState(null);
  const openTaskDetail = (task) => navigate(`/projects/${projectId}/tasks/${encodeURIComponent(task.code)}`);

  const onDragStart = (e, task) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: task._id, status: task.status }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e, status) => {
    e.preventDefault();
    setDragOver(null);
    const { id, status: from } = JSON.parse(e.dataTransfer.getData('text/plain'));
    // Pre-check the same legality task.service.js#update enforces server-side
    // — without this, dropping e.g. a Waiting Approval card into any other
    // column always fired a doomed PATCH (that status has no legal direct
    // target at all), just to have the card snap back a round-trip later.
    if (from !== status && isLegalTaskTransition(from, status)) updateStatus.mutate({ id, status });
  };

  if (isLoading || !data) return <SkBoard />;

  const colMap = Object.fromEntries(data.columns.map((c) => [c.status, c.tasks]));

  return (
    <>
      <div className="board">
        {TASK_STATUS_ORDER.map((status) => {
          const meta = TASK_STATUS_META[status];
          const tasks = colMap[status] || [];
          return (
            <div
              key={status}
              className={`board-col ${dragOver === status ? 'drop-target' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
              onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
              onDrop={(e) => onDrop(e, status)}
            >
              <div className="board-col-head">
                <span className="badge-dot" style={{ background: meta.color, width: 8, height: 8 }} />
                {meta.label}
                <span className="nav-badge" style={{ marginLeft: 'auto', background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                  {tasks.length}
                </span>
              </div>
              {tasks.map((t) => (
                <TaskCard key={t._id} task={t} onDragStart={onDragStart} onOpen={openTaskDetail} />
              ))}
              {!tasks.length && (
                <div className="tiny subtle center" style={{ padding: 16, gap: 6 }}>
                  <GripVertical size={13} /> Drop here
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default TaskBoard;
