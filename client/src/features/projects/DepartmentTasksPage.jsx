import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, List, Kanban, CalendarDays, Trash2, MoreVertical, ChevronUp, ClipboardList,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTasks, useUpdateTaskStatus, useDeleteTask } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime, daysUntil } from '../../lib/format.js';
import { DEPT_META, TASK_STATUS_META, PRIORITY_META, TASK_STATUS_ORDER, TASK_STATUS_SELECTABLE, CHART_COLORS } from '../../lib/ui.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCanDecide } from '../../app/slices/authSlice.js';
import { ClampText } from '../../components/ui/ClampText.jsx';

const EXEC_STAGE = 'p6'; // matches DepartmentPlanningPage — allocated tasks live under Execution's stageKey
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const DEPT_ORDER = Object.keys(DEPT_META);
const SORT_OPTIONS = [
  { key: 'dueDate', label: 'Due Date (Soonest)' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'title', label: 'Title' },
];
const EMPTY_FILTERS = { search: '', status: '', priority: '', assignee: '', dueBefore: '', sortBy: 'dueDate' };
const PAGE_SIZE_OPTIONS = [10, 25, 50];

/** "15 days left" / "Due today" / "Overdue by 3 days". */
function daysLeftLabel(days) {
  if (days == null) return { text: '—', tone: 'var(--text-subtle)' };
  if (days < 0) return { text: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`, tone: 'var(--danger)' };
  if (days === 0) return { text: 'Due today', tone: 'var(--warning)' };
  return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: 'var(--success)' };
}

/** A labeled filter control — small caption above a bordered box, matching the reference's filter bar. */
export function FilterField({ label, children, grow }) {
  return (
    <div className="col gap-1" style={{ flex: grow ? '1 1 220px' : '0 0 auto', minWidth: grow ? 200 : 150 }}>
      <span className="tiny muted" style={{ fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Per-row kebab menu: quick status change + delete. Closes on outside click.
 *
 * `canDelete` gates the Delete option (server: `DELETE /pms/tasks/:id`
 * requires `canManage`, admin|manager) — this page previously rendered it
 * for every role, 403'ing on click for a Doer/Viewer. Status changes stay
 * open to everyone the menu is shown to, matching the server's
 * `canChangeStatus` (doer-of-the-task, or manager/admin).
 */
export function RowActionsMenu({ task, onStatusChange, onDelete, canDelete, deleting }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-subtle btn-icon btn-sm" onClick={() => setOpen((o) => !o)} title="Actions">
        <MoreVertical size={15} />
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 20, minWidth: 180,
            padding: 6, boxShadow: 'var(--shadow-2)',
          }}
        >
          <div className="tiny muted upper" style={{ padding: '4px 8px', fontWeight: 700 }}>Set status</div>
          {TASK_STATUS_ORDER.map((s) => (
            <button
              key={s}
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', justifyContent: 'flex-start', fontWeight: task.status === s ? 700 : 400 }}
              onClick={() => { onStatusChange(s); setOpen(false); }}
            >
              <Badge color={TASK_STATUS_META[s]?.color} soft={TASK_STATUS_META[s]?.soft} dot>{TASK_STATUS_META[s]?.label || s}</Badge>
            </button>
          ))}
          {canDelete && (
            <>
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--danger)' }}
                disabled={deleting}
                onClick={() => { setOpen(false); onDelete(); }}
              >
                <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete task'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Drill-down from a Department Planning row: every task allocated to one
 * department. Reuses the same task-list query as the parent page — no
 * parallel data source, no new endpoint (the list endpoint already
 * supports `?department=`).
 */
export function DepartmentTasksPage() {
  const { id, departmentKey } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: tasksResp, isLoading: tasksLoading, isError } = useTasks({
    project: id,
    stageKey: EXEC_STAGE,
    department: departmentKey,
    limit: 500,
  });
  const tasks = tasksResp?.data || tasksResp || [];
  const deptName = DEPT_META[departmentKey] || departmentKey;
  const accent = CHART_COLORS[Math.max(0, DEPT_ORDER.indexOf(departmentKey)) % CHART_COLORS.length];

  const updateStatus = useUpdateTaskStatus(id);
  const deleteTask = useDeleteTask(id);
  const canDelete = useAppSelector(selectCanDecide);

  const [f, setF] = useState(EMPTY_FILTERS);
  const setField = (k) => (e) => { setPage(1); setF((old) => ({ ...old, [k]: e.target.value })); };
  const filtersActive = Object.entries(f).some(([k, v]) => v !== EMPTY_FILTERS[k]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  const [selected, setSelected] = useState(() => new Set());
  const toggleSelected = (taskId) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
    return next;
  });

  // Distinct assignees actually on this department's tasks — no separate
  // users query, the option list only ever shows people who could plausibly
  // have a task here.
  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    for (const t of tasks) if (t.assignee?._id) seen.set(t.assignee._id, t.assignee.name);
    return [...seen.entries()];
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const before = f.dueBefore ? new Date(f.dueBefore) : null;
    const filtered = tasks.filter((t) => {
      if (q && !t.title?.toLowerCase().includes(q) && !t.code?.toLowerCase().includes(q)) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.assignee && String(t.assignee?._id || '') !== f.assignee) return false;
      if (before && (!t.plannedEnd || new Date(t.plannedEnd) > before)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (f.sortBy === 'priority') return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (f.sortBy === 'status') return TASK_STATUS_ORDER.indexOf(a.status) - TASK_STATUS_ORDER.indexOf(b.status);
      if (f.sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
      return new Date(a.plannedEnd || 0) - new Date(b.plannedEnd || 0); // dueDate, default
    });
  }, [tasks, f]);

  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTasks = visibleTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const allPagedSelected = pagedTasks.length > 0 && pagedTasks.every((t) => selected.has(t._id));
  const toggleSelectAll = () => setSelected((s) => {
    const next = new Set(s);
    if (allPagedSelected) pagedTasks.forEach((t) => next.delete(t._id));
    else pagedTasks.forEach((t) => next.add(t._id));
    return next;
  });

  const back = () => navigate(`/projects/${id}/department-planning`);
  const onDelete = (task) => {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    deleteTask.mutate(task._id, {
      onError: (err) => window.alert(err?.response?.data?.message || 'Could not delete this task — try again.'),
    });
  };

  const bulkSetStatus = (status) => {
    for (const taskId of selected) updateStatus.mutate({ id: taskId, status });
    setSelected(new Set());
  };
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} selected task${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return;
    for (const taskId of selected) {
      deleteTask.mutate(taskId, {
        onError: (err) => window.alert(err?.response?.data?.message || 'Could not delete one of the selected tasks — try again.'),
      });
    }
    setSelected(new Set());
  };

  if (projectLoading || tasksLoading) {
    return (<><Topbar title={deptName} /><div className="content"><SkPropertyIdentification /></div></>);
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={back} aria-label="Back to Department Planning">
              <ArrowLeft size={16} />
            </button>
            {deptName}
          </span>
        }
        subtitle={project ? `${project.code} · ${project.name} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : undefined}
      />
      <div className="content page-compact">
        <div className="content-wide col gap-3 fade-in">
          {tasks.length > 0 && (
            <SectionCard
              title="Filter & Sort"
              action={filtersActive && <button className="btn btn-ghost btn-sm" onClick={() => setF(EMPTY_FILTERS)}>Clear All</button>}
            >
              <div className="row gap-2 wrap" style={{ alignItems: 'end' }}>
                <FilterField label="Search" grow>
                  <div className="row gap-2" style={{ alignItems: 'center', position: 'relative' }}>
                    <Search size={14} className="muted" style={{ position: 'absolute', left: 10 }} />
                    <input
                      className="input"
                      style={{ paddingLeft: 30 }}
                      value={f.search}
                      onChange={setField('search')}
                      placeholder="Search title or code…"
                    />
                  </div>
                </FilterField>
                <FilterField label="Status">
                  <select className="select" value={f.status} onChange={setField('status')}>
                    <option value="">All Statuses</option>
                    {Object.entries(TASK_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                </FilterField>
                <FilterField label="Priority">
                  <select className="select" value={f.priority} onChange={setField('priority')}>
                    <option value="">All Priorities</option>
                    {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                </FilterField>
                <FilterField label="Assignee">
                  <select className="select" value={f.assignee} onChange={setField('assignee')}>
                    <option value="">All Assignees</option>
                    {assigneeOptions.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
                  </select>
                </FilterField>
                <FilterField label="Due Date">
                  <input className="input" type="date" value={f.dueBefore} onChange={setField('dueBefore')} title="Due on or before" />
                </FilterField>
                <FilterField label="Sort By">
                  <select className="select" value={f.sortBy} onChange={setField('sortBy')}>
                    {SORT_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </FilterField>
              </div>
            </SectionCard>
          )}

          <SectionCard
            title={
              <span className="row gap-2" style={{ alignItems: 'center' }}>
                <span style={{ width: 4, height: 20, borderRadius: 2, background: accent, display: 'inline-block' }} />
                {deptName} — Allocated Tasks ({visibleTasks.length})
              </span>
            }
            action={
              <div className="row gap-1">
                <button className="btn btn-primary btn-sm"><List size={14} /> List View</button>
                <button className="btn btn-subtle btn-sm" onClick={() => navigate(`/projects/${id}?tab=${encodeURIComponent('Task Board')}`)} title="Opens the real Task Board (all departments) on the project overview page">
                  <Kanban size={14} /> Board View
                </button>
                <button className="btn btn-subtle btn-sm" onClick={() => navigate('/calendar')} title="Opens the real Calendar (all projects' deadlines, not scoped to this department)">
                  <CalendarDays size={14} /> Calendar View
                </button>
              </div>
            }
          >
            {isError ? (
              <EmptyState title="Couldn't load tasks" hint="Something went wrong fetching this department's tasks — try again." />
            ) : tasks.length === 0 ? (
              <EmptyState title="No tasks yet" hint="Nothing has been allocated to this department yet." />
            ) : visibleTasks.length === 0 ? (
              <EmptyState title="No tasks match these filters" hint="Try clearing a filter — the department itself isn't empty." />
            ) : (
              <div className="col gap-2">
                {selected.size > 0 && (
                  <div className="row gap-2" style={{ alignItems: 'center', padding: '8px 10px', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)' }}>
                    <span className="sm grow" style={{ fontWeight: 600 }}>{selected.size} selected</span>
                    <select className="select" defaultValue="" onChange={(e) => { if (e.target.value) bulkSetStatus(e.target.value); e.target.value = ''; }} style={{ padding: '4px 8px', fontSize: 13 }}>
                      <option value="" disabled>Set status to…</option>
                      {TASK_STATUS_SELECTABLE.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
                    </select>
                    {canDelete && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={bulkDelete}>
                        <Trash2 size={13} /> Delete selected
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
                  </div>
                )}
                <table className="table table-clickable">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAll} />
                      </th>
                      <th>Task Details</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Due Date</th>
                      <th>Progress</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTasks.map((t) => {
                      const pr = PRIORITY_META[t.priority] || {};
                      const deadline = daysLeftLabel(t.plannedEnd ? daysUntil(t.plannedEnd) : null);
                      const progress = t.checklistProgress ?? 0;
                      const escalated = t.priority === 'high' || t.priority === 'critical';
                      return (
                        <tr key={t._id} onClick={() => navigate(`/projects/${id}/tasks/${t.code}?from=department-planning`)}>
                          <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(t._id)} onChange={() => toggleSelected(t._id)} /></td>
                          <td>
                            <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                              <div className="list-row-icon" style={{ width: 30, height: 30, borderRadius: 'var(--radius-sm)', background: `${pr.color || 'var(--text-subtle)'}1A`, color: pr.color || 'var(--text-subtle)', flexShrink: 0 }}>
                                <ClipboardList size={14} />
                              </div>
                              <div className="col task-title-cell">
                                <ClampText
                                  lines={2}
                                  as="span"
                                  className="task-title-text"
                                  title={t.title}
                                  onMore={() => navigate(`/projects/${id}/tasks/${t.code}?from=department-planning`)}
                                >
                                  {t.title}
                                </ClampText>
                                <span className="tiny muted">{t.code}</span>
                                <span className="tiny muted">Assigned by {t.createdBy?.name || '—'} · {fmtDateTime(t.createdAt)}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            {pr.label && (
                              <Badge color={pr.color} soft={pr.soft}>
                                {escalated && <ChevronUp size={11} style={{ marginRight: 2, verticalAlign: '-1px' }} />}
                                {pr.label}
                              </Badge>
                            )}
                          </td>
                          {/* Department Planning's job ends at allocation — every row
                              here reads "Assigned" regardless of how far Execution has
                              since taken the task (in progress/waiting approval/done/etc). */}
                          <td><Badge color="var(--success)" soft="var(--success-soft)" dot>Assigned</Badge></td>
                          <td>
                            {t.assignee?.name ? (
                              <div className="row gap-2" style={{ alignItems: 'center' }}>
                                <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={26} />
                                <div className="col">
                                  <span className="sm">{t.assignee.name}</span>
                                  {t.assignee.title && <span className="tiny muted">{t.assignee.title}</span>}
                                </div>
                              </div>
                            ) : <span className="tiny muted">Unassigned</span>}
                          </td>
                          <td>
                            <div className="col">
                              <span className="row gap-1 sm" style={{ alignItems: 'center' }}>
                                <CalendarDays size={13} className="muted" /> {fmtDate(t.plannedEnd)}
                              </span>
                              <span className="tiny" style={{ color: deadline.tone }}>{deadline.text}</span>
                            </div>
                          </td>
                          <td style={{ minWidth: 90 }}>
                            <div className="col gap-1">
                              <span className="tiny muted">{progress}%</span>
                              <div style={{ height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gradient-primary)' }} />
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="col">
                              <span className="tiny">{fmtDate(t.updatedAt)}</span>
                              <span className="tiny muted">{fmtDateTime(t.updatedAt).split(', ')[1]}</span>
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <RowActionsMenu
                              task={t}
                              onStatusChange={(s) => updateStatus.mutate({ id: t._id, status: s })}
                              onDelete={() => onDelete(t)}
                              canDelete={canDelete}
                              deleting={deleteTask.isPending}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="tiny muted">
                    Showing {visibleTasks.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, visibleTasks.length)} of {visibleTasks.length} tasks
                  </span>
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <select
                      className="select"
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                      style={{ padding: '4px 8px', fontSize: 13 }}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}/page</option>)}
                    </select>
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                    <span className="tiny" style={{ minWidth: 24, textAlign: 'center' }}>{currentPage}</span>
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}

export default DepartmentTasksPage;
