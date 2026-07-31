import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, CalendarDays, ChevronUp } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate, daysUntil } from '../../lib/format.js';
import {
  PRIORITY_META, TASK_STATUS_META, DEPT_META, isTaskDelayed, TASK_WORK_DONE_STATUSES,
} from '../../lib/ui.js';

const EXEC_STAGE = 'p6';

/** Same 10 buckets ExecutionPage's KpiStrip counts are built from. */
const KPI_META = {
  total: { title: 'Total Tasks', match: () => true },
  completed: { title: 'Completed', match: (t) => TASK_WORK_DONE_STATUSES.includes(t.status) },
  inProgress: { title: 'In Progress', match: (t) => t.status === 'in_progress' },
  assigned: { title: 'Assigned', match: (t) => t.status === 'todo' },
  waitingApproval: { title: 'Waiting Approval', match: (t) => t.status === 'waiting_approval' },
  approved: { title: 'Approved', match: (t) => t.status === 'approved' },
  rejected: { title: 'Rejected', match: (t) => t.status === 'rejected' },
  blocked: { title: 'Blocked', match: (t) => t.status === 'blocked' },
  overdue: { title: 'Overdue', match: (t) => isTaskDelayed(t) },
  delayed: { title: 'Delayed', match: (t) => TASK_WORK_DONE_STATUSES.includes(t.status) && t.completedOnTime === false },
};

/** "Overdue by 3 days" / "2 days left" / "Due today". */
function deadlineLabel(plannedEnd) {
  if (!plannedEnd) return { text: '—', tone: 'var(--text-subtle)' };
  const days = daysUntil(plannedEnd);
  if (days < 0) return { text: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`, tone: 'var(--danger)' };
  if (days === 0) return { text: 'Due today', tone: 'var(--warning)' };
  return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: 'var(--success)' };
}

/**
 * Drill-down from Execution's KPI strip — one page per card (Total Tasks /
 * Completed / In Progress / Assigned / Waiting Approval / Approved /
 * Rejected / Blocked / Overdue / Delayed). Reuses the exact same `/pms/tasks`
 * query and status buckets ExecutionPage's own counters are built from, so
 * every number here always matches the card that linked to it.
 */
export function ExecutionKpiPage() {
  const { id, kpiKey } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: tasksResp, isLoading: tasksLoading, isError } = useTasks({ project: id, stageKey: EXEC_STAGE, limit: 500 });
  const tasks = tasksResp?.data || tasksResp || [];

  const kpi = KPI_META[kpiKey];
  const filteredTasks = kpi ? tasks.filter(kpi.match) : [];
  const loading = projectLoading || tasksLoading;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/execution`)} aria-label="Back to Execution">
              <ArrowLeft size={16} />
            </button>
            {kpi?.title || 'Execution'}
          </span>
        }
        subtitle={project ? `${project.code} · ${project.name}` : undefined}
      />
      <div className="content page-compact">
        <div className="content-wide col gap-3 fade-in">
          {loading ? (
            <SkPropertyIdentification />
          ) : isError ? (
            <EmptyState title="Couldn't load this view" hint="Something went wrong fetching Execution data — try again." />
          ) : !kpi ? (
            <EmptyState title="Unknown view" hint="This KPI card doesn't map to a known view." />
          ) : (
            <SectionCard title={`${kpi.title} (${filteredTasks.length})`}>
              {filteredTasks.length === 0 ? (
                <EmptyState icon={ClipboardList} title="Nothing here" hint="No tasks match this view yet." />
              ) : (
                <table className="table table-clickable">
                  <thead>
                    <tr>
                      <th>Task Details</th>
                      <th>Department</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map((t) => {
                      const pr = PRIORITY_META[t.priority] || {};
                      const st = TASK_STATUS_META[t.status] || {};
                      const escalated = t.priority === 'high' || t.priority === 'critical';
                      const deadline = deadlineLabel(t.plannedEnd);
                      return (
                        <tr key={t._id} onClick={() => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}?from=execution`)}>
                          <td>
                            <div className="col" style={{ minWidth: 140 }}>
                              <span style={{ fontWeight: 600 }}>{t.title}</span>
                              <span className="tiny muted">{t.code}</span>
                            </div>
                          </td>
                          <td><span className="sm">{DEPT_META[t.department] || t.department || '—'}</span></td>
                          <td>
                            {pr.label && (
                              <Badge color={pr.color} soft={pr.soft}>
                                {escalated && <ChevronUp size={11} style={{ marginRight: 2, verticalAlign: '-1px' }} />}
                                {pr.label}
                              </Badge>
                            )}
                          </td>
                          <td>{st.label && <Badge color={st.color} soft={st.soft} dot>{st.label}</Badge>}</td>
                          <td>
                            {t.assignee?.name ? (
                              <div className="row gap-2" style={{ alignItems: 'center' }}>
                                <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={26} />
                                <span className="sm">{t.assignee.name}</span>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}

export default ExecutionKpiPage;
