import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown } from 'lucide-react';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  TASK_STATUS_META, PRIORITY_META, isReworkStatus, isTaskDelayed,
  READINESS_CATEGORY_ORDER, readinessCategoryMeta,
} from '../../lib/ui.js';

const STAGE_KEY = 'p8';

/** Printable Readiness Summary Report — one page, same `.report-sheet`
 * pattern every other phase's Summary Report already uses (see
 * CommercialCompleteReportPage.jsx / PropertyAssessmentReportPage.jsx), so
 * this reads consistently with the rest of the app rather than inventing a
 * new report layout. Every figure is computed live from the same real
 * `stageKey:'p8'` Task list the dashboard itself reads — nothing here is a
 * separate, potentially-stale snapshot.
 */
export function ReadinessSummaryReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey: STAGE_KEY, limit: 1000 });
  const tasks = tasksResp?.data || tasksResp || [];
  const { data: activities } = useProjectActivity(id);

  if (projectLoading || tasksLoading || !project) {
    return (<><Topbar title="Readiness Summary Report" /><div className="content"><SkDetail /></div></>);
  }

  const stage = project.stages?.find((s) => s.key === STAGE_KEY);

  const categories = READINESS_CATEGORY_ORDER.map((key) => {
    const catTasks = tasks.filter((t) => t.taskCategory === key);
    const total = catTasks.length;
    const completed = catTasks.filter((t) => t.status === 'approved').length;
    const blocked = catTasks.filter((t) => t.status === 'blocked' || isReworkStatus(t.status)).length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    const status = total === 0 ? 'Not Started' : completed === total ? 'Completed' : blocked > 0 ? 'Blocked' : 'In Progress';
    return { key, ...readinessCategoryMeta(key), total, completed, blocked, pct, status };
  });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'approved').length;
  const overallPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked' || isReworkStatus(t.status)).length;

  const criticalIssues = tasks
    .filter((t) => ['critical', 'high'].includes(t.priority) && (t.status === 'blocked' || isReworkStatus(t.status) || isTaskDelayed(t)))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'critical' ? -1 : 1));
  const minorIssues = tasks.filter((t) => !['critical', 'high'].includes(t.priority) && (t.status === 'blocked' || isReworkStatus(t.status) || isTaskDelayed(t)));
  const exceptionRequests = tasks.filter((t) => t.extensionRequest);

  const deptVerified = tasks.filter((t) => ['waiting_management_approval', 'approved'].includes(t.status)).length;
  const mgmtVerified = completedTasks;
  const deptPct = totalTasks ? Math.round((deptVerified / totalTasks) * 100) : 0;
  const mgmtPct = totalTasks ? Math.round((mgmtVerified / totalTasks) * 100) : 0;
  const isCompleted = stage?.status === 'completed';

  const stageActivities = (activities || [])
    .filter((a) => a.meta?.stageKey === STAGE_KEY)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const recommendations = [];
  if (overallPct === 100 && criticalIssues.length === 0 && !isCompleted) {
    recommendations.push('Every checklist item is completed with no critical issues outstanding — ready for Final Approval and Phase 9: Store Launch.');
  }
  if (isCompleted) {
    recommendations.push('Store Readiness is complete and Final Approval has been given.');
  }
  const laggingCategories = categories.filter((c) => c.total > 0 && c.pct < 100);
  if (laggingCategories.length) {
    recommendations.push(`${laggingCategories.length} categor${laggingCategories.length === 1 ? 'y needs' : 'ies need'} attention: ${laggingCategories.map((c) => `${c.label} (${c.pct}%)`).join(', ')}.`);
  }
  if (criticalIssues.length) {
    recommendations.push(`${criticalIssues.length} critical issue${criticalIssues.length === 1 ? '' : 's'} must be resolved before this store can launch.`);
  }
  if (exceptionRequests.length) {
    recommendations.push(`${exceptionRequests.length} deadline-extension request${exceptionRequests.length === 1 ? '' : 's'} pending decision.`);
  }
  if (!recommendations.length) recommendations.push('No readiness data yet — checklist items are generated automatically when the project reaches Phase 8.');

  const handleBack = () => navigate(-1);
  const handlePrint = () => window.print();

  return (
    <>
      <Topbar
        title={<span className="row gap-3 no-print"><button className="btn btn-ghost btn-icon" onClick={handleBack} aria-label="Back"><ArrowLeft size={16} /></button>Readiness Summary Report</span>}
        subtitle={`${project.code} · ${project.name}`}
      />

      <div className="content" style={{ background: '#F8FAFC', minHeight: 'calc(100vh - var(--topbar-height))', padding: '24px 0 80px 0' }}>
        <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto 16px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={handleBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={15} /> Back
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileDown size={15} /> Print / Save PDF
          </button>
        </div>

        <div className="report-sheet">
          {/* I. Executive Summary */}
          <div className="report-section">
            <h2 className="report-h2">I. Executive Summary</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <div className="row between"><span className="report-title-label">Project</span><span className="report-value-text">{project.code} · {project.name}</span></div>
              <div className="row between"><span className="report-title-label">City</span><span className="report-value-text">{project.city || '—'}</span></div>
              <div className="row between"><span className="report-title-label">Phase</span><span className="report-value-text">Phase 8 · {stage?.name || 'Store Readiness Checklist'}</span></div>
              <div className="row between"><span className="report-title-label">Overall Readiness</span><span className="report-value-text"><Badge color={overallPct === 100 ? 'var(--success)' : 'var(--warning)'} soft={overallPct === 100 ? 'var(--success-soft)' : undefined}>{overallPct}% Ready</Badge></span></div>
              <div className="row between"><span className="report-title-label">Checklist Items</span><span className="report-value-text">{completedTasks} / {totalTasks} completed</span></div>
              <div className="row between"><span className="report-title-label">Critical Issues</span><span className="report-value-text">{criticalIssues.length}</span></div>
              <div className="row between"><span className="report-title-label">Final Approval</span><span className="report-value-text"><Badge color={isCompleted ? 'var(--success)' : 'var(--text-subtle)'}>{isCompleted ? 'Approved' : 'Pending'}</Badge></span></div>
            </div>
          </div>

          {/* II. Category Breakdown */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">II. Category Breakdown</h2>
            <hr className="report-divider" />
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>Category</th><th>Total Items</th><th>Completed</th><th>Progress</th><th>Status</th></tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td>{c.total}</td>
                    <td>{c.completed}</td>
                    <td>{c.pct}%</td>
                    <td><Badge color={c.color}>{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* III. Critical Issues */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">III. Critical Issues</h2>
            <hr className="report-divider" />
            {criticalIssues.length ? (
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>Checklist Item</th><th>Category</th><th>Priority</th><th>Status</th><th>Due Date</th></tr></thead>
                <tbody>
                  {criticalIssues.map((t) => {
                    const cat = readinessCategoryMeta(t.taskCategory);
                    const pr = PRIORITY_META[t.priority];
                    const st = TASK_STATUS_META[t.status];
                    return (
                      <tr key={t._id}>
                        <td>{t.title}</td>
                        <td><Badge color={cat.color}>{cat.label}</Badge></td>
                        <td><Badge color={pr?.color}>{pr?.label}</Badge></td>
                        <td><Badge color={st?.color}>{st?.label || t.status}</Badge></td>
                        <td>{t.plannedEnd ? fmtDate(t.plannedEnd) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="empty sm">No critical issues.</div>}
          </div>

          {/* IV. Issues & Exceptions Summary */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">IV. Issues & Exceptions Summary</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <div className="row between"><span className="report-title-label">Minor Issues</span><span className="report-value-text">{minorIssues.length}</span></div>
              <div className="row between"><span className="report-title-label">Blocked Items</span><span className="report-value-text">{blockedTasks}</span></div>
              <div className="row between"><span className="report-title-label">Exception Requests</span><span className="report-value-text">{exceptionRequests.length}</span></div>
            </div>
          </div>

          {/* V. Approval Status */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">V. Approval Status</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <div className="row between"><span className="report-title-label">Department Verification</span><span className="report-value-text">{deptPct}%</span></div>
              <div className="row between"><span className="report-title-label">Management Verification</span><span className="report-value-text">{mgmtPct}%</span></div>
              <div className="row between"><span className="report-title-label">Final Approval</span><span className="report-value-text">{isCompleted ? 'Approved' : 'Pending'}</span></div>
            </div>
          </div>

          {/* VI. Activity Timeline */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VI. Activity Timeline</h2>
            <hr className="report-divider" />
            {stageActivities.length ? (
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Date</th><th>Actor</th><th>Action</th></tr></thead>
                <tbody>
                  {stageActivities.slice(0, 25).map((a) => (
                    <tr key={a._id}>
                      <td className="tiny muted">{fmtDateTime(a.createdAt)}</td>
                      <td>{a.actor?.name || 'System'}</td>
                      <td>{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty sm">No activity yet.</div>}
          </div>

          {/* VII. Recommendations */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VII. Recommendations</h2>
            <hr className="report-divider" />
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {recommendations.map((r, i) => <li key={i} className="report-value-text" style={{ marginBottom: 6 }}>{r}</li>)}
            </ul>
          </div>

          <div className="tiny muted" style={{ marginTop: 32, textAlign: 'right' }}>
            Report generated {fmtDateTime(new Date().toISOString())}
          </div>
        </div>
      </div>
    </>
  );
}

export default ReadinessSummaryReportPage;
