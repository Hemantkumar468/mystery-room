import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CalendarDays, ChevronUp, Users,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate, daysUntil } from '../../lib/format.js';
import { PRIORITY_META, TASK_STATUS_META, DEPT_META } from '../../lib/ui.js';
import { DepartmentRow } from './DepartmentPlanningPage.jsx';

const EXEC_STAGE = 'p6'; // matches DepartmentPlanningPage — allocated tasks live under Execution's stageKey
const PLANNING_STAGE = 'p5';

/** Same three buckets DepartmentPlanningPage's KpiStrip counts are built from. */
const KPI_META = {
  allocated: { title: 'All Allocated Tasks', match: () => true },
  completed: { title: 'Tasks Completed', match: (t) => t.status === 'done' },
  pending: { title: 'Tasks Pending', match: (t, now) => t.status !== 'done' && !(t.plannedEnd && new Date(t.plannedEnd) < now) },
  overdue: { title: 'Tasks Overdue', match: (t, now) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < now },
  highPriority: { title: 'High Priority Tasks', match: (t) => t.priority === 'high' || t.priority === 'critical' },
};

/** "Overdue by 3 days" / "2 days left" / "Due today". */
function deadlineLabel(plannedEnd) {
  if (!plannedEnd) return { text: '—', tone: 'var(--text-subtle)' };
  const days = daysUntil(plannedEnd);
  if (days < 0) return { text: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`, tone: 'var(--danger)' };
  if (days === 0) return { text: 'Due today', tone: 'var(--warning)' };
  return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: 'var(--success)' };
}

function TaskListSection({ title, tasks, projectId }) {
  const navigate = useNavigate();
  return (
    <SectionCard title={`${title} (${tasks.length})`}>
      {tasks.length === 0 ? (
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
            {tasks.map((t) => {
              const pr = PRIORITY_META[t.priority] || {};
              const st = TASK_STATUS_META[t.status] || {};
              const escalated = t.priority === 'high' || t.priority === 'critical';
              const deadline = deadlineLabel(t.plannedEnd);
              return (
                <tr key={t._id} onClick={() => navigate(`/projects/${projectId}/tasks/${t.code}?from=department-planning`)}>
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
  );
}

function DepartmentsSection({ id, departments, tasksByDept, navigate }) {
  const deptKeys = Object.keys(tasksByDept).filter((k) => k !== 'unassigned').sort();
  return (
    <SectionCard title={`Departments (${departments.length})`}>
      {departments.length === 0 ? (
        <EmptyState icon={Users} title="No departments yet" hint="This template has no assessment types configured for Department Planning." />
      ) : (
        <div className="col">
          {departments.map((d) => (
            <DepartmentRow
              key={d.key}
              deptKey={d.key}
              subtitle={d.subtitle}
              taskList={tasksByDept[d.key] || []}
              onOpen={() => navigate(`/projects/${id}/department-planning/${d.key}`)}
            />
          ))}
          {!deptKeys.includes('unassigned') && (tasksByDept.unassigned || []).length > 0 && (
            <div className="row gap-3" style={{ alignItems: 'center', padding: '13px 14px', borderTop: '1px solid var(--border)' }}>
              <div style={{ width: 36, height: 36, flexShrink: 0 }} />
              <span className="sm grow muted">Unassigned</span>
              <Badge color="var(--text-subtle)" soft="var(--surface-hover)">{tasksByDept.unassigned.length} task{tasksByDept.unassigned.length === 1 ? '' : 's'}</Badge>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function TeamMembersSection({ tasks }) {
  const members = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      if (!t.assignee?._id) continue;
      const entry = map.get(t.assignee._id) || { user: t.assignee, total: 0, completed: 0, overdue: 0 };
      entry.total += 1;
      if (t.status === 'done') entry.completed += 1;
      else if (t.plannedEnd && new Date(t.plannedEnd) < new Date()) entry.overdue += 1;
      map.set(t.assignee._id, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [tasks]);

  return (
    <SectionCard title={`Team Members (${members.length})`}>
      {members.length === 0 ? (
        <EmptyState icon={Users} title="No one assigned yet" hint="Tasks allocated with a specific doer will show up here." />
      ) : (
        <div className="col">
          {members.map(({ user, total, completed, overdue }) => (
            <div key={user._id} className="row gap-3" style={{ alignItems: 'center', padding: '11px 14px', borderTop: '1px solid var(--border)' }}>
              <Avatar name={user.name} color={user.avatarColor} size={32} />
              <div className="col grow" style={{ minWidth: 0 }}>
                <span className="sm" style={{ fontWeight: 650 }}>{user.name}</span>
                {user.title && <span className="tiny muted">{user.title}</span>}
              </div>
              {overdue > 0 && <Badge color="var(--danger)" soft="var(--danger-soft)">{overdue} overdue</Badge>}
              <Badge color="var(--success)" soft="var(--success-soft)">{completed} done</Badge>
              <Badge color="var(--text-subtle)" soft="var(--surface-hover)">{total} task{total === 1 ? '' : 's'}</Badge>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Drill-down from Department Planning's KPI strip — one page per card
 * (Total Departments / All Allocated Tasks / Tasks Completed / Pending /
 * Overdue / High Priority / Team Members). Reuses the exact same task query
 * and derivation logic DepartmentPlanningPage's `stats` memo is built from,
 * so every count here always matches the card that linked to it.
 */
export function DepartmentPlanningKpiPage() {
  const { id, kpiKey } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading: projectLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: tasksResp, isLoading: tasksLoading, isError } = useTasks({ project: id, stageKey: EXEC_STAGE, limit: 500 });

  const tasks = tasksResp?.data || tasksResp || [];
  const departments = (template?.stages?.find((s) => s.key === PLANNING_STAGE)?.assessmentTypes || [])
    .map((t) => ({ key: t.key, name: t.name, subtitle: t.subtitle }));

  const tasksByDept = useMemo(() => {
    const map = {};
    for (const t of tasks) { const k = t.department || 'unassigned'; (map[k] = map[k] || []).push(t); }
    return map;
  }, [tasks]);

  const kpi = KPI_META[kpiKey];
  const now = new Date();
  const filteredTasks = kpi ? tasks.filter((t) => kpi.match(t, now)) : [];

  const title = kpiKey === 'departments' ? 'Total Departments'
    : kpiKey === 'teamMembers' ? 'Team Members'
    : kpi?.title || 'Department Planning';

  const loading = projectLoading || templateLoading || tasksLoading;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/department-planning`)} aria-label="Back to Department Planning">
              <ArrowLeft size={16} />
            </button>
            {title}
          </span>
        }
        subtitle={project ? `${project.code} · ${project.name}` : undefined}
      />
      <div className="content page-compact">
        <div className="content-wide col gap-3 fade-in">
          {loading ? (
            <SkPropertyIdentification />
          ) : isError ? (
            <EmptyState title="Couldn't load this view" hint="Something went wrong fetching Department Planning data — try again." />
          ) : kpiKey === 'departments' ? (
            <DepartmentsSection id={id} departments={departments} tasksByDept={tasksByDept} navigate={navigate} />
          ) : kpiKey === 'teamMembers' ? (
            <TeamMembersSection tasks={tasks} />
          ) : kpi ? (
            <TaskListSection title={kpi.title} tasks={filteredTasks} projectId={id} />
          ) : (
            <EmptyState title="Unknown view" hint="This KPI card doesn't map to a known view." />
          )}
        </div>
      </div>
    </>
  );
}

export default DepartmentPlanningKpiPage;
