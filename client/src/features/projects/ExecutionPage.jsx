import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock, AlertTriangle,
  Search, ChevronUp, ChevronDown, CalendarDays, ListTodo, Download, Plus, Filter,
  MessageCircle, Paperclip, FileUp, Flag, Link2, Timer, TrendingUp,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, Avatar, ProgressRing } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { DonutChart, TrendArea } from '../../components/charts/chartkit.jsx';
import {
  useProject, useStageRecords, useCompleteStage, useTasks, useTemplate,
  useUpdateTaskStatus, useDeleteTask, useCreateTask,
} from '../../lib/queries.js';
import { fmtDateTime, fmtDate, daysUntil } from '../../lib/format.js';
import { TASK_STATUS_META, TASK_STATUS_ORDER, PRIORITY_META, DEPT_META, deptMeta } from '../../lib/ui.js';
import { DeadlinesPanel, ActivityPanel, AllocateTaskModal } from './DepartmentPlanningPage.jsx';
import { FilterField, RowActionsMenu } from './DepartmentTasksPage.jsx';
import { TaskDetailModal } from '../tasks/TaskDetailModal.jsx';

const EXEC_STAGE = 'p6';
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const EMPTY_FILTERS = { search: '', department: '', status: '', priority: '', assignee: '', dueBefore: '', sortBy: 'dueDate' };

/** Client-side CSV export of the tasks currently loaded — real data, no server round trip. */
function exportTasksCsv(tasks, projectCode) {
  const header = ['Code', 'Title', 'Department', 'Priority', 'Status', 'Assignee', 'Due Date', 'Progress %'];
  const rows = tasks.map((t) => [
    t.code || '', t.title || '', DEPT_META[t.department] || t.department || '', PRIORITY_META[t.priority]?.label || t.priority || '',
    TASK_STATUS_META[t.status]?.label || t.status || '', t.assignee?.name || 'Unassigned',
    t.plannedEnd ? fmtDate(t.plannedEnd) : '', t.checklistProgress ?? 0,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectCode || 'execution'}-tasks.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

/** One tile in the Phase 6 overview strip — label heading, icon + big number,
 * then either a rate (%) + thin progress bar, or a plain subtitle. */
function ExecStatCard({ icon: Icon, label, value, color, pct, sub }) {
  return (
    <div className="card" style={{ padding: '10px 12px', flex: '1 1 0', minWidth: 110, display: 'flex', flexDirection: 'column' }}>
      <span className="tiny muted" style={{ fontWeight: 600 }}>{label}</span>
      <div className="row gap-2" style={{ alignItems: 'center', marginTop: 6 }}>
        {Icon && (
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}1A`, color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon size={13} strokeWidth={2.2} />
          </span>
        )}
        <span style={{ fontSize: 19, fontWeight: 750, lineHeight: 1 }}>{value}</span>
        {pct != null && <span className="tiny" style={{ marginLeft: 'auto', color, fontWeight: 700 }}>{pct}%</span>}
      </div>
      {sub && <span className="tiny muted" style={{ marginTop: 6 }}>{sub}</span>}
    </div>
  );
}

/**
 * Execution Records — every allocated task across every department. Reads
 * the same `Task` documents Department Planning's "Allocate Task" creates
 * (stageKey 'p6') — a task shows up here the instant it's allocated.
 * Same rich table/filter/bulk-action pattern as the Department drill-down
 * page (DepartmentTasksPage) — reuses its FilterField/RowActionsMenu rather
 * than a second copy — plus a Department column, since this spans all of them.
 */
/** One compact filter control — small label and value sharing a single bordered box. */
function FilterBox({ label, icon: Icon, children }) {
  return (
    <div className="filter-box">
      <span className="filter-box-label">{label}</span>
      <div className="filter-box-value">
        {children}
        <Icon size={13} />
      </div>
    </div>
  );
}

function ExecutionRecordsTable({ tasks, projectId, projectCode, onOpenTask, onNewTask }) {
  const navigate = useNavigate();
  const updateStatus = useUpdateTaskStatus(projectId);
  const deleteTask = useDeleteTask(projectId);

  const [f, setF] = useState(EMPTY_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [selected, setSelected] = useState(() => new Set());
  const setField = (k) => (e) => { setPage(1); setF((old) => ({ ...old, [k]: e.target.value })); };
  const filtersActive = Object.entries(f).some(([k, v]) => v !== EMPTY_FILTERS[k]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDocClick = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [moreOpen]);

  const deptOptions = useMemo(() => [...new Set(tasks.map((t) => t.department).filter(Boolean))].sort(), [tasks]);
  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    for (const t of tasks) if (t.assignee?._id) seen.set(t.assignee._id, t.assignee.name);
    return [...seen.entries()];
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (q && !t.title?.toLowerCase().includes(q) && !t.code?.toLowerCase().includes(q)) return false;
      if (f.department && t.department !== f.department) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.assignee && String(t.assignee?._id || '') !== f.assignee) return false;
      if (f.dueBefore && (!t.plannedEnd || new Date(t.plannedEnd) > new Date(`${f.dueBefore}T23:59:59`))) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (f.sortBy === 'priority') return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (f.sortBy === 'status') return TASK_STATUS_ORDER.indexOf(a.status) - TASK_STATUS_ORDER.indexOf(b.status);
      if (f.sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
      return new Date(a.plannedEnd || 0) - new Date(b.plannedEnd || 0);
    });
  }, [tasks, f]);

  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTasks = visibleTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  /** Windowed page numbers with "…" gaps — first, last, and a run around the current page. */
  const pageList = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set([1, 2, pageCount - 1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
    const nums = [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < nums.length; i += 1) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) out.push('…');
      out.push(nums[i]);
    }
    return out;
  }, [pageCount, currentPage]);
  const allPagedSelected = pagedTasks.length > 0 && pagedTasks.every((t) => selected.has(t._id));
  const toggleSelectAll = () => setSelected((s) => {
    const next = new Set(s);
    if (allPagedSelected) pagedTasks.forEach((t) => next.delete(t._id));
    else pagedTasks.forEach((t) => next.add(t._id));
    return next;
  });
  const toggleSelected = (taskId) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
    return next;
  });

  const onDelete = (task) => {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    deleteTask.mutate(task._id, { onError: (err) => window.alert(err?.response?.data?.message || 'Could not delete this task — try again.') });
  };
  const bulkSetStatus = (status) => { for (const taskId of selected) updateStatus.mutate({ id: taskId, status }); setSelected(new Set()); };
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} selected task${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return;
    for (const taskId of selected) deleteTask.mutate(taskId, { onError: (err) => window.alert(err?.response?.data?.message || 'Could not delete one of the selected tasks — try again.') });
    setSelected(new Set());
  };

  return (
    <div className="col gap-3">
      {tasks.length > 0 && (
        <div className="filter-toolbar">
          <div className="filter-search">
            <Search size={14} className="muted" />
            <input value={f.search} onChange={setField('search')} placeholder="Search tasks by name, ID…" />
          </div>
          <FilterBox label="Department" icon={ChevronDown}>
            <select value={f.department} onChange={setField('department')}>
              <option value="">All</option>
              {deptOptions.map((d) => <option key={d} value={d}>{DEPT_META[d] || d}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Status" icon={ChevronDown}>
            <select value={f.status} onChange={setField('status')}>
              <option value="">All</option>
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Priority" icon={ChevronDown}>
            <select value={f.priority} onChange={setField('priority')}>
              <option value="">All</option>
              {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Assignee" icon={ChevronDown}>
            <select value={f.assignee} onChange={setField('assignee')}>
              <option value="">All</option>
              {assigneeOptions.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Due Date" icon={CalendarDays}>
            <input type="date" value={f.dueBefore} onChange={setField('dueBefore')} />
          </FilterBox>

          <div ref={moreRef} style={{ position: 'relative' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoreOpen((v) => !v)}>
              <Filter size={13} style={{ marginRight: 6 }} /> Filters
            </button>
            {moreOpen && (
              <div className="card" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, minWidth: 200, padding: 10 }}>
                <FilterField label="Sort By">
                  <select className="select" value={f.sortBy} onChange={setField('sortBy')}>
                    <option value="dueDate">Due Date (Soonest)</option>
                    <option value="priority">Priority</option>
                    <option value="status">Status</option>
                    <option value="title">Title</option>
                  </select>
                </FilterField>
                {filtersActive && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    onClick={() => { setF(EMPTY_FILTERS); setMoreOpen(false); }}
                  >
                    Clear All
                  </button>
                )}
              </div>
            )}
          </div>

          <button type="button" className="btn btn-primary btn-sm" style={{ padding: '2px 6px', flexShrink: 0 }} onClick={onNewTask}>
            <Plus size={14} style={{ marginRight: 4 }} /> New Task
          </button>
        </div>
      )}

      <ExecutionToolbar projectId={projectId} tasks={tasks} projectCode={projectCode} />

      <SectionCard title={`Task List (${visibleTasks.length})`} subtitle={`${tasks.length} tasks filed in total`}>
        {tasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Allocate tasks from Department Planning — they show up here automatically." />
        ) : visibleTasks.length === 0 ? (
          <EmptyState title="No tasks match these filters" hint="Try clearing a filter." />
        ) : (
          <div className="col gap-2">
            {selected.size > 0 && (
              <div className="row gap-2" style={{ alignItems: 'center', padding: '8px 10px', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)' }}>
                <span className="sm grow" style={{ fontWeight: 600 }}>{selected.size} selected</span>
                <select className="select" defaultValue="" onChange={(e) => { if (e.target.value) bulkSetStatus(e.target.value); e.target.value = ''; }} style={{ padding: '4px 8px', fontSize: 13 }}>
                  <option value="" disabled>Set status to…</option>
                  {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={bulkDelete}>Delete selected</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}><input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAll} /></th>
                    <th>Task Details</th><th>Department</th><th>Priority</th><th>Status</th>
                    <th>Assignee</th><th>Due Date</th><th>Progress</th><th>Dependencies</th><th>Updated</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTasks.map((t) => {
                    const pr = PRIORITY_META[t.priority] || {};
                    const st = TASK_STATUS_META[t.status] || {};
                    const dm = deptMeta(t.department);
                    const overdue = t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date();
                    const escalated = t.priority === 'high' || t.priority === 'critical';
                    const progress = t.checklistProgress ?? 0;
                    const dLeft = t.plannedEnd ? daysUntil(t.plannedEnd) : null;
                    return (
                      <tr key={t._id}>
                        <td><input type="checkbox" checked={selected.has(t._id)} onChange={() => toggleSelected(t._id)} /></td>
                        <td>
                          <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                            <div className="list-row-icon" style={{ width: 30, height: 30, borderRadius: 'var(--radius-sm)', background: `${pr.color || 'var(--text-subtle)'}1A`, color: pr.color || 'var(--text-subtle)', flexShrink: 0 }}>
                              <ClipboardList size={14} />
                            </div>
                            <div className="col" style={{ minWidth: 140 }}>
                              <button
                                type="button"
                                onClick={() => onOpenTask?.(t)}
                                style={{ fontWeight: 600, textAlign: 'left', color: 'var(--text)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = 'var(--primary)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = 'var(--text)'; }}
                                title="Open task details"
                              >
                                {t.title}
                              </button>
                              <span className="tiny muted">{t.code}</span>
                              <span className="row gap-3" style={{ alignItems: 'center', marginTop: 2 }}>
                                <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><MessageCircle size={11} /> {t.comments?.length || 0}</span>
                                <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><Paperclip size={11} /> {t.attachments?.length || 0}</span>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{t.department ? <Badge color={dm.color}>{dm.label}</Badge> : <span className="tiny muted">—</span>}</td>
                        <td>
                          {pr.label && (
                            <Badge color={pr.color} soft={pr.soft}>
                              {escalated && <ChevronUp size={11} style={{ marginRight: 2, verticalAlign: '-1px' }} />}
                              {pr.label}
                            </Badge>
                          )}
                        </td>
                        <td><Badge color={st.color} soft={st.soft} dot>{st.label || t.status}</Badge></td>
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
                            <span className="row gap-1 sm" style={{ alignItems: 'center', whiteSpace: 'nowrap' }}><CalendarDays size={13} className="muted" /> {fmtDate(t.plannedEnd)}</span>
                            {dLeft != null && t.status !== 'done' && (
                              <span className="tiny" style={{ color: dLeft < 0 ? 'var(--danger)' : dLeft <= 2 ? 'var(--warning)' : 'var(--success)' }}>
                                {dLeft < 0
                                  ? `Overdue by ${Math.abs(dLeft)} day${Math.abs(dLeft) === 1 ? '' : 's'}`
                                  : dLeft === 0 ? 'Due today' : `${dLeft} day${dLeft === 1 ? '' : 's'} left`}
                              </span>
                            )}
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
                          {t.dependencies?.length ? (
                            <div className="row gap-1 wrap">
                              {t.dependencies.map((d) => (
                                <span key={d._id || d.code} className="tiny" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap' }}>
                                  {d.code}
                                </span>
                              ))}
                            </div>
                          ) : <span className="tiny muted">—</span>}
                        </td>
                        <td className="tiny muted">{fmtDate(t.updatedAt)}</td>
                        <td>
                          <RowActionsMenu task={t} onStatusChange={(s) => updateStatus.mutate({ id: t._id, status: s })} onDelete={() => onDelete(t)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="tiny muted">
                Showing {visibleTasks.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, visibleTasks.length)} of {visibleTasks.length} tasks
              </span>
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                {pageList.map((p, i) => (
                  p === '…'
                    ? <span key={`gap-${i}`} className="tiny muted" style={{ padding: '0 4px' }}>…</span>
                    : (
                      <button
                        key={p}
                        className={`btn btn-icon btn-sm ${p === currentPage ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    )
                ))}
                <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
                <select className="select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ padding: '4px 8px', fontSize: 13, marginLeft: 6 }}>
                  {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * Cumulative completion % over the trailing 7 days, ending today — read off
 * each task's real `actualEnd` (set server-side the moment a task is marked
 * done). No fabricated trend line: days with no completions just repeat the
 * prior day's cumulative %.
 */
function ProgressOverviewPanel({ tasks }) {
  const totalTasks = tasks.length;
  const data = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(23, 59, 59, 999);
      return d;
    });
    return days.map((d) => {
      const doneBy = tasks.filter((t) => t.actualEnd && new Date(t.actualEnd) <= d).length;
      return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), pct: totalTasks ? Math.round((doneBy / totalTasks) * 100) : 0 };
    });
  }, [tasks, totalTasks]);

  return (
    <SectionCard title="Progress Overview" subtitle="This Week">
      {totalTasks === 0 ? (
        <EmptyState title="No tasks yet" hint="The trend line fills in once tasks start completing." />
      ) : (
        <TrendArea data={data} dataKey="pct" name="Complete" height={180} suffix="%" />
      )}
    </SectionCard>
  );
}

/** Real status counts across every allocated task — no fabricated trend, just today's actual mix. */
function TaskStatusBreakdown({ tasks }) {
  const data = TASK_STATUS_ORDER
    .map((s) => ({ name: TASK_STATUS_META[s]?.label || s, value: tasks.filter((t) => t.status === s).length, color: TASK_STATUS_META[s]?.color }))
    .filter((d) => d.value > 0);

  return (
    <SectionCard title="Task Status Breakdown">
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" hint="Allocate tasks to see the status mix here." />
      ) : (
        <>
          <DonutChart data={data} height={180} innerRadius={50} outerRadius={72} centerLabel={{ value: tasks.length, label: 'TASKS' }} />
          <div className="col gap-2" style={{ marginTop: 8 }}>
            {data.map((d) => (
              <div key={d.name} className="row gap-2" style={{ alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                <span className="sm grow">{d.name}</span>
                <span className="sm muted">{d.value} ({Math.round((d.value / tasks.length) * 100)}%)</span>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/**
 * Task List / Gantt / Kanban / Calendar view switcher, plus Export. New Task
 * lives in the filter toolbar below (ExecutionRecordsTable) instead of here.
 * Task List is this page; Kanban and Calendar hand off to the real pages that
 * already implement them (no second copy of that UI). Gantt has no real
 * implementation anywhere in the app yet, so it's disabled rather than faked.
 */
function ExecutionToolbar({ projectId, tasks, projectCode }) {
  const navigate = useNavigate();
  const TABS = [
    { key: 'list', label: 'Task List', active: true },
    { key: 'gantt', label: 'Gantt Chart', disabled: true, hint: 'Coming soon — Gantt view is a separate build' },
    { key: 'kanban', label: 'Kanban Board', onClick: () => navigate(`/projects/${projectId}?tab=${encodeURIComponent('Task Board')}`) },
    { key: 'calendar', label: 'Calendar', onClick: () => navigate('/calendar') },
    { key: 'workload', label: 'Workload', disabled: true, hint: 'Coming soon — Workload view is a separate build' },
    { key: 'timeline', label: 'Timeline', disabled: true, hint: 'Coming soon — Timeline view is a separate build' },
  ];
  return (
    <div className="row gap-3" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', overflowX: 'auto' }}>
      <div className="tabs" style={{ flexShrink: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab${t.active ? ' active' : ''}`}
            disabled={t.disabled}
            title={t.hint}
            onClick={t.onClick}
            style={t.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => exportTasksCsv(tasks, projectCode)}>
          <Download size={14} style={{ marginRight: 6 }} /> Export
        </button>
      </div>
    </div>
  );
}

/** Real overdue tasks, worst-first. */
function DelayedTasksPanel({ tasks, onOpen }) {
  const delayed = useMemo(() => (
    tasks
      .filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date())
      .map((t) => ({ ...t, daysLate: Math.abs(daysUntil(t.plannedEnd)) }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 5)
  ), [tasks]);

  return (
    <SectionCard title="Delayed Tasks">
      {delayed.length === 0 ? (
        <EmptyState title="Nothing delayed" hint="No overdue tasks right now." />
      ) : (
        <div className="col">
          {delayed.map((t) => (
            <div
              key={t._id}
              className="row gap-2"
              style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => onOpen(t.department)}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--danger)' }} />
              <span className="sm grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span className="tiny" style={{ color: 'var(--danger)', flexShrink: 0 }}>{t.daysLate} day{t.daysLate === 1 ? '' : 's'} late</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** Bottom-row overdue list — same data as the sidebar's Delayed Tasks, with
 * a priority badge alongside each row (richer, wider layout has room for it). */
function TopOverdueTasksPanel({ tasks, onOpen }) {
  const delayed = useMemo(() => (
    tasks
      .filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date())
      .map((t) => ({ ...t, daysLate: Math.abs(daysUntil(t.plannedEnd)) }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 5)
  ), [tasks]);

  return (
    <SectionCard title="Top Overdue Tasks">
      {delayed.length === 0 ? (
        <EmptyState title="Nothing overdue" hint="No overdue tasks right now." />
      ) : (
        <div className="col">
          {delayed.map((t) => {
            const pr = PRIORITY_META[t.priority] || {};
            return (
              <div
                key={t._id}
                className="row gap-2"
                style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => onOpen(t.department)}
              >
                <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span className="sm grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="tiny" style={{ color: 'var(--danger)', flexShrink: 0 }}>{t.daysLate} day{t.daysLate === 1 ? '' : 's'} overdue</span>
                {pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/** Real, working actions only — no dead buttons. Icon-grid layout for the bottom row. */
function ExecQuickActions({ onNewTask }) {
  const ACTIONS = [
    { icon: Plus, label: 'Add New Task', color: 'var(--success)', onClick: onNewTask },
    { icon: FileUp, label: 'Upload Document', color: 'var(--info)', disabled: true, hint: 'Attach files from a task instead — there’s no project-level document store yet' },
    { icon: Flag, label: 'Create Milestone', color: 'var(--warning)', disabled: true, hint: 'Coming soon — milestones aren’t a modeled concept yet' },
    { icon: Link2, label: 'Add Dependency', color: 'var(--text-subtle)', disabled: true, hint: 'Set dependencies while creating or editing a task' },
  ];
  return (
    <SectionCard title="Quick Actions">
      <div className="row gap-2 wrap">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            className="col gap-2"
            disabled={a.disabled}
            title={a.hint}
            onClick={a.onClick}
            style={{
              flex: '1 1 110px', alignItems: 'center', padding: '14px 8px', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'var(--surface)', cursor: a.disabled ? 'not-allowed' : 'pointer',
              opacity: a.disabled ? 0.5 : 1,
            }}
          >
            <div className="list-row-icon" style={{ width: 32, height: 32, background: `${a.color}1A`, color: a.color }}>
              <a.icon size={16} />
            </div>
            <span className="tiny" style={{ textAlign: 'center', fontWeight: 600 }}>{a.label}</span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * Execution — tracks the same Task documents Department Planning (p5)
 * allocates (stageKey 'p6'). Dashboard layout: stats, filter/sort, a
 * List/Gantt/Kanban/Calendar view switcher, the task table, then a sidebar
 * (progress trend, status mix, deadlines, overdue) plus a bottom row
 * (recent activity, top overdue, quick actions) — all reading the real
 * Task model, no separate Record-based copy of this data.
 */
export function ExecutionPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);

  const stageKey = EXEC_STAGE;

  // Property resolution is unchanged — Project Creation (p4) is still a
  // Record-based stage, so this part of the pipeline is untouched.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');

  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey, limit: 500 });
  const tasks = tasksResp?.data || tasksResp || [];

  const completeStage = useCompleteStage(id);
  const autoCompletedRef = useRef(false);

  // Department options for the "New Task" modal — same template lookup
  // Department Planning uses (departments live on the p5 stage template,
  // even though the tasks these create are tagged stageKey 'p6').
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const departments = (template?.stages?.find((s) => s.key === 'p5')?.assessmentTypes || [])
    .map((t) => ({ key: t.key, name: t.name, subtitle: t.subtitle }));
  const createTask = useCreateTask(id);
  const [modal, setModal] = useState(null);
  const [openTask, setOpenTask] = useState(null); // task row whose detail drawer is open
  const createNewTask = async (payload) => { await createTask.mutateAsync(payload); setModal(null); };

  // Eligibility: Department Planning (p5) must actually be complete — read
  // straight from the project's own stage status (what "Mark Done"/the p5
  // baseline sets), not from p5 Records, which the current Department
  // Planning flow never creates.
  const p5Stage = project?.stages?.find((s) => s.key === 'p5');
  const isPlanningComplete = p5Stage?.status === 'completed';

  const isProjectCreated = (propId) =>
    (projectCreationRecords || []).some((r) => String(r.parentRecordId) === String(propId) && (r.status === 'submitted' || r.status === 'approved'));
  const property = isPlanningComplete ? (shortlisted || []).find((p) => isProjectCreated(p._id)) || null : null;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'done').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date()).length;
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
  const todoTasks = tasks.filter((t) => t.status === 'todo').length;
  // Delayed = tasks that finished behind their planned end date (task.model.js
  // sets completedOnTime on completion) — distinct from Overdue, which is
  // tasks still open past their due date.
  const delayedTasks = tasks.filter((t) => t.status === 'done' && t.completedOnTime === false).length;
  const overallPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const completedPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const inProgressPct = totalTasks ? Math.round((inProgressTasks / totalTasks) * 100) : 0;
  const todoPct = totalTasks ? Math.round((todoTasks / totalTasks) * 100) : 0;
  const overduePct = totalTasks ? Math.round((overdueTasks / totalTasks) * 100) : 0;
  const delayedPct = totalTasks ? Math.round((delayedTasks / totalTasks) * 100) : 0;
  const progressStatus = !totalTasks ? null
    : overdueTasks === 0 ? { label: 'On Track', color: 'var(--success)' }
    : overduePct < 15 ? { label: 'At Risk', color: 'var(--warning)' }
    : { label: 'Behind Schedule', color: 'var(--danger)' };

  // Real, derivable "momentum" figure for the Overall Progress tile — count of
  // tasks whose actualEnd (set the moment a task is marked done) falls in the
  // trailing 7 days. No fabricated "% vs last week" comparison.
  const completedThisWeek = tasks.filter((t) => t.actualEnd && Date.now() - new Date(t.actualEnd).getTime() <= 7 * 86400000).length;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  // Every allocated task Done -> the stage completes itself and Phase 7
  // unlocks. Guarded so it only ever fires once per visit (completeStage is
  // idempotent server-side too).
  useEffect(() => {
    if (autoCompletedRef.current || !stage || isCompleted) return;
    if (totalTasks > 0 && completedTasks === totalTasks) {
      autoCompletedRef.current = true;
      completeStage.mutate(stageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalTasks, completedTasks, stage, isCompleted]);

  if (isLoading || !project) {
    return (<><Topbar title="Execution" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Execution</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Execution stage" hint="This project has no Execution stage." />
        </div>
      </>
    );
  }

  const ready = !propertiesLoading && !tasksLoading && isPlanningComplete && property;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            {stage.name}
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content page-compact">
        <div
          className="content-wide fade-in"
          style={{
            display: 'grid',
            gridTemplateColumns: ready ? 'minmax(0, 1fr) 240px' : '1fr',
            gap: 'var(--space-3)',
            alignItems: 'start',
          }}
        >
        <div className="col gap-3">
          {propertiesLoading || tasksLoading ? (
            <SectionCard title="Project Summary">
              <InfoTile label="Loading…" value="…" />
            </SectionCard>
          ) : !isPlanningComplete ? (
            <SectionCard title="Project Summary">
              <EmptyState
                icon={ClipboardList}
                title="This project is not yet eligible for Execution."
                hint="Complete Department Planning (Phase 5) — submit and get both approvals on the baseline — before starting Execution."
              />
            </SectionCard>
          ) : !property ? (
            <SectionCard title="Project Summary">
              <EmptyState icon={ClipboardList} title="No eligible property found" hint="Department Planning is complete, but no shortlisted property has a submitted Project Creation record." />
            </SectionCard>
          ) : (
            <>
              {/* Overview stats — Overall Progress ring first, then one ExecStatCard
                  per status, all in a single non-wrapping row. */}
              <div className="row gap-2" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
                <div className="card" style={{ padding: '10px 12px', flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' }}>
                  <span className="tiny muted" style={{ fontWeight: 600 }}>Overall Progress</span>
                  <div className="row gap-2" style={{ alignItems: 'center', marginTop: 6 }}>
                    <div style={{ flexShrink: 0 }}>
                      <ProgressRing value={overallPct} size={36} stroke={4} color={progressStatus?.color || 'var(--primary)'} />
                    </div>
                    <div className="col" style={{ gap: 1 }}>
                      <span style={{ fontSize: 19, fontWeight: 750, lineHeight: 1 }}>{overallPct}%</span>
                      {progressStatus && <span className="tiny" style={{ color: progressStatus.color, fontWeight: 650 }}>{progressStatus.label}</span>}
                      {completedThisWeek > 0 && (
                        <span className="tiny row gap-1" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 600 }}>
                          <TrendingUp size={11} /> +{completedThisWeek} this week
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ExecStatCard icon={ClipboardList} value={totalTasks} label="Total Tasks" color="var(--chart-3)" />
                <ExecStatCard icon={CheckCircle2} value={completedTasks} label="Completed" color="var(--success)" pct={completedPct} />
                <ExecStatCard icon={Clock} value={inProgressTasks} label="In Progress" color="var(--warning)" pct={inProgressPct} />
                <ExecStatCard icon={ListTodo} value={todoTasks} label="To Do" color="var(--chart-2)" pct={todoPct} />
                <ExecStatCard icon={AlertTriangle} value={overdueTasks} label="Overdue" color="var(--danger)" pct={overduePct} />
                <ExecStatCard icon={Timer} value={delayedTasks} label="Delayed" color="var(--warning)" />
              </div>

              <ExecutionRecordsTable tasks={tasks} projectId={id} projectCode={project.code} onOpenTask={setOpenTask} onNewTask={() => setModal(true)} />

              <div className="row gap-3" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}><ActivityPanel projectId={id} title="Recent Activity" /></div>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                  <TopOverdueTasksPanel tasks={tasks} onOpen={(dept) => navigate(`/projects/${id}/department-planning/${dept}`)} />
                </div>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}><ExecQuickActions onNewTask={() => setModal(true)} /></div>
              </div>
            </>
          )}
        </div>

        {ready && (
          <div className="col gap-3">
            <ProgressOverviewPanel tasks={tasks} />
            <TaskStatusBreakdown tasks={tasks} />
            <DeadlinesPanel tasks={tasks} onOpen={() => navigate('/calendar')} />
            <DelayedTasksPanel tasks={tasks} onOpen={(dept) => navigate(`/projects/${id}/department-planning/${dept}`)} />
          </div>
        )}
        </div>
      </div>

      <AllocateTaskModal
        open={!!modal}
        onClose={() => setModal(null)}
        projectId={id}
        departments={departments}
        presetDept=""
        onCreate={createNewTask}
        creating={createTask.isPending}
      />

      {openTask && (
        <TaskDetailModal
          task={openTask}
          projectId={id}
          allTasks={tasks}
          onClose={() => setOpenTask(null)}
        />
      )}
    </>
  );
}

export default ExecutionPage;
