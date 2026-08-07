import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ClipboardList, MapPin, ChevronUp } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate, daysUntil } from '../../lib/format.js';
import { TASK_STATUS_META, PRIORITY_META } from '../../lib/ui.js';
import { ClampText } from '../../components/ui/ClampText.jsx';

/** "Overdue by 3 days" — always overdue on this page, so no "N days left" branch. */
function overdueLabel(plannedEnd) {
  const days = daysUntil(plannedEnd);
  if (days == null) return '—';
  return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
}

/**
 * Drill-down from the Dashboard's "Overdue Tasks" KPI card — every task,
 * across every project, that is past its planned end date and not yet
 * delivered. Reuses the same `/pms/tasks?overdue=true` filter the dashboard
 * KPI count itself is built from (task.service.js `buildFilter`), so the
 * count here always matches what the card showed.
 */
export function OverdueTasksPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useTasks({ overdue: true, limit: 200 });
  const tasks = data?.data || [];

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate('/')} aria-label="Back to Dashboard">
              <ArrowLeft size={16} />
            </button>
            Overdue Tasks
          </span>
        }
        subtitle="Every task past its planned end date, across all projects"
      />
      <div className="content page-compact">
        <div className="content-wide col gap-3 fade-in">
          {isLoading ? (
            <SkPropertyIdentification />
          ) : (
            <SectionCard title={`Overdue Tasks (${tasks.length})`}>
              {isError ? (
                <EmptyState title="Couldn't load overdue tasks" hint="Something went wrong fetching this list — try again." />
              ) : tasks.length === 0 ? (
                <EmptyState title="Nothing overdue" hint="Every task across the portfolio is on schedule." />
              ) : (
                <table className="table table-clickable">
                  <thead>
                    <tr>
                      <th>Task Details</th>
                      <th>Project</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => {
                      const pr = PRIORITY_META[t.priority] || {};
                      const st = TASK_STATUS_META[t.status] || {};
                      const escalated = t.priority === 'high' || t.priority === 'critical';
                      return (
                        <tr key={t._id} onClick={() => navigate(`/projects/${t.project?._id}/tasks/${t.code}`)}>
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
                                  onMore={() => navigate(`/projects/${t.project?._id}/tasks/${t.code}`)}
                                >
                                  {t.title}
                                </ClampText>
                                <span className="tiny muted">{t.code}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="col">
                              <span className="sm" style={{ fontWeight: 600 }}>{t.project?.name || '—'}</span>
                              <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}>
                                <MapPin size={11} /> {t.project?.city || '—'}
                              </span>
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
                          <td>
                            {st.label && <Badge color={st.color} soft={st.soft} dot>{st.label}</Badge>}
                          </td>
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
                              <span className="tiny" style={{ color: 'var(--danger)' }}>{overdueLabel(t.plannedEnd)}</span>
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

export default OverdueTasksPage;
