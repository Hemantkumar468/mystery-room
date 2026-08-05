import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, CalendarDays } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate } from '../../lib/format.js';
import { TASK_STATUS_META, DEPT_META } from '../../lib/ui.js';

const EXEC_STAGE = 'p6';

/** Same 4 buckets Approval Workflow's own KPI strip counts are built from. */
const KPI_META = {
  total: { title: 'Total Tasks', match: () => true },
  pending: { title: 'Pending Approval', match: (t) => t.status === 'waiting_management_approval' },
  approved: { title: 'Approved', match: (t) => t.status === 'approved' },
  rejected: { title: 'Rejected', match: (t) => t.status === 'rejected' },
};

/**
 * Drill-down from Approval Workflow's KPI strip — one page per card (Total
 * Tasks / Pending Approval / Approved / Rejected). Reuses the exact same
 * `/pms/tasks` query Approval Workflow's own task lists are built from, so
 * every number here always matches the card that linked to it. Read-only:
 * deciding a task still happens on the main Approval Workflow page (or the
 * task's own detail page) — this is purely a filtered, drillable view.
 */
export function ApprovalWorkflowKpiPage() {
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
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/approval-workflow`)} aria-label="Back to Approval Workflow">
              <ArrowLeft size={16} />
            </button>
            {kpi?.title || 'Approval Workflow'}
          </span>
        }
        subtitle={project ? `${project.code} · ${project.name}` : undefined}
      />
      <div className="content page-compact">
        <div className="content-wide col gap-3 fade-in">
          {loading ? (
            <SkPropertyIdentification />
          ) : isError ? (
            <EmptyState title="Couldn't load this view" hint="Something went wrong fetching Approval Workflow data — try again." />
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
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Decided On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map((t) => {
                      const st = TASK_STATUS_META[t.status] || {};
                      const decidedAt = t.status === 'approved' ? t.managementApprovedAt : t.status === 'rejected' ? t.rejectedAt : null;
                      return (
                        <tr key={t._id} onClick={() => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}`)}>
                          <td>
                            <div className="col" style={{ minWidth: 140 }}>
                              <span style={{ fontWeight: 600 }}>{t.title}</span>
                              <span className="tiny muted">{t.code}</span>
                            </div>
                          </td>
                          <td><span className="sm">{DEPT_META[t.department] || t.department || '—'}</span></td>
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
                            {decidedAt ? (
                              <span className="row gap-1 sm" style={{ alignItems: 'center' }}>
                                <CalendarDays size={13} className="muted" /> {fmtDate(decidedAt)}
                              </span>
                            ) : <span className="tiny muted">—</span>}
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

export default ApprovalWorkflowKpiPage;
