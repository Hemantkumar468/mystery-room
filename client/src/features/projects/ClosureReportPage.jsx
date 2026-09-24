import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime, fmtCurrency } from '../../lib/format.js';
import { PROJECT_STATUS_META, isTaskDelayed } from '../../lib/ui.js';
import {
  closureRecordsOf, moduleStatusKey, MODULE_STATUS_META, checklistPct,
  buildBudget, buildSchedule, buildPhases, buildVendors, buildDepartments,
  buildLessons, buildSignOffs, buildFinancials, buildHealth, buildAuditTrail,
  meanOf, num, clampPct, scoreLabel, latestApprovedOf,
} from './closure/closureAnalytics.js';

const STAGE_KEY = 'p10';

const Row = ({ label, value }) => (
  <div className="row between">
    <span className="report-title-label">{label}</span>
    <span className="report-value-text">{value ?? '—'}</span>
  </div>
);

/**
 * Project Closure Report — the printable, one-document version of the Phase 10
 * Command Center, using the same `.report-sheet` layout every other phase's
 * summary report uses (see ReadinessSummaryReportPage.jsx).
 *
 * Every figure is recomputed live from the same closure derivations the
 * dashboard renders, so the report can never be a stale snapshot — and, as
 * there, a section with no approved submission behind it says so instead of
 * printing zeroes.
 */
export function ClosureReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: tasksResp } = useTasks({ project: id, limit: 1000 });
  const allTasks = tasksResp?.data || tasksResp || [];
  const { data: activities } = useProjectActivity(id, 200);
  const { data: closureRecords, isLoading: recordsLoading } = useStageRecords(id, STAGE_KEY);

  const assessmentTypes = template?.stages?.find((s) => s.key === STAGE_KEY)?.assessmentTypes || [];
  const propertyId = (closureRecords || [])[0]?.parentRecordId;

  const closureRecs = useMemo(() => closureRecordsOf(closureRecords, propertyId), [closureRecords, propertyId]);
  const phases = useMemo(() => buildPhases(project), [project]);
  const budget = useMemo(() => buildBudget(closureRecs, project), [closureRecs, project]);
  const schedule = useMemo(() => buildSchedule(closureRecs, project, phases), [closureRecs, project, phases]);
  const vendors = useMemo(() => buildVendors(closureRecs), [closureRecs]);
  const departments = useMemo(() => buildDepartments(allTasks), [allTasks]);
  const lessons = useMemo(() => buildLessons(closureRecs), [closureRecs]);
  const signOffs = useMemo(() => buildSignOffs(closureRecs), [closureRecs]);
  const financials = useMemo(() => buildFinancials(closureRecs), [closureRecs]);

  const modules = assessmentTypes.map((type) => {
    const statusKey = moduleStatusKey(closureRecs, type.key);
    return { type, statusKey, statusMeta: MODULE_STATUS_META[statusKey] };
  });
  const doneModules = modules.filter((m) => m.statusKey === 'approved').length;
  const modulesPct = modules.length ? (doneModules / modules.length) * 100 : null;

  const qualityScore = meanOf([
    checklistPct(assessmentTypes.find((t) => t.key === 'asset_handover'), closureRecs),
    checklistPct(assessmentTypes.find((t) => t.key === 'document_archive'), closureRecs),
  ]);
  const complianceScore = meanOf([
    checklistPct(assessmentTypes.find((t) => t.key === 'document_archive'), closureRecs),
    checklistPct(assessmentTypes.find((t) => t.key === 'project_sign_off'), closureRecs),
  ]);
  const readinessTasks = allTasks.filter((t) => t.stageKey === 'p8' || t.stageKey === 'p9');
  const customerReadiness = readinessTasks.length
    ? clampPct((readinessTasks.filter((t) => t.status === 'approved').length / readinessTasks.length) * 100)
    : null;

  const health = buildHealth({
    budget, schedule, vendors, departments, modulesPct, quality: qualityScore, compliance: complianceScore, customerReadiness,
  });

  const auditTrail = useMemo(
    () => buildAuditTrail(activities, closureRecs.map((r) => r._id), propertyId),
    [activities, closureRecs, propertyId],
  );

  const criticalDelays = allTasks.filter((t) => ['critical', 'high'].includes(t.priority) && isTaskDelayed(t));
  const signOffRecord = latestApprovedOf(closureRecs, 'project_sign_off');
  const overallRating = num(signOffRecord?.values?.overall_rating);

  if (isLoading || recordsLoading || !project) {
    return (<><Topbar title="Project Closure Report" /><div className="content"><SkDetail /></div></>);
  }

  const statusMeta = PROJECT_STATUS_META[project.status] || PROJECT_STATUS_META.active;
  const stage = project.stages?.find((s) => s.key === STAGE_KEY);

  // Recommendations are statements of fact about this project's own closure
  // state — never generic advice.
  const recommendations = [];
  if (doneModules < modules.length) {
    recommendations.push(`${modules.length - doneModules} of ${modules.length} closure modules are not yet approved — the project cannot be archived until each has an approved submission.`);
  }
  if (budget.variance != null && budget.variance < 0) {
    recommendations.push(`The project closed ${fmtCurrency(Math.abs(budget.variance))} over budget (${Math.abs(budget.variancePct).toFixed(2)}%) — carry the variance notes into the next outlet's budget baseline.`);
  } else if (budget.savings) {
    recommendations.push(`The project closed ${fmtCurrency(budget.savings)} under budget (${Math.abs(budget.variancePct).toFixed(2)}%) — record the saving levers as reusable best practice.`);
  }
  if (schedule.delayDays != null && schedule.delayDays > 0) {
    recommendations.push(`Delivery ran ${schedule.delayDays} day(s) past plan${schedule.rootCause ? ` (root cause: ${schedule.rootCause})` : ''} — factor this into the next project's schedule.`);
  }
  if (criticalDelays.length) {
    recommendations.push(`${criticalDelays.length} high or critical priority task(s) overran their planned end date.`);
  }
  const weakVendors = vendors.filter((v) => v.overall != null && v.overall < 60);
  if (weakVendors.length) {
    recommendations.push(`${weakVendors.length} vendor(s) scored below 60 — review before re-engaging: ${weakVendors.map((v) => v.name).join(', ')}.`);
  }
  if (financials.pending) {
    recommendations.push(`${fmtCurrency(financials.pending)} of vendor payment remains outstanding — financial closure is incomplete until it settles.`);
  }
  if (!lessons.rows.length) {
    recommendations.push('No lessons learned have been captured — the retrospective is the main reusable output of this closure.');
  }
  if (project.status === 'archived') {
    recommendations.push(`The project was formally archived on ${fmtDateTime(project.archivedAt)} and is now read-only.`);
  }
  if (!recommendations.length) {
    recommendations.push('Closure is on track — every gate reviewed so far has cleared with no outstanding exceptions.');
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3 no-print">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={16} /></button>
            Project Closure Report
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />

      <div className="content" style={{ background: '#F8FAFC', minHeight: 'calc(100vh - var(--topbar-height))', padding: '24px 0 80px 0' }}>
        <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto 16px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={15} /> Back
          </button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileDown size={15} /> Print / Save PDF
          </button>
        </div>

        <div className="report-sheet">
          {/* I. Executive Summary */}
          <div className="report-section">
            <h2 className="report-h2">I. Executive Summary</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <Row label="Project" value={`${project.code} · ${project.name}`} />
              <Row label="City" value={project.city} />
              <Row label="Phase" value={`Phase 10 · ${stage?.name || 'Project Closure'}`} />
              <Row label="Project Status" value={<Badge color={statusMeta.color} soft={statusMeta.soft}>{statusMeta.label}</Badge>} />
              <Row label="Project Completion" value={`${project.progress ?? 0}%`} />
              <Row label="Closure Modules Approved" value={`${doneModules} / ${modules.length}`} />
              <Row
                label="Overall Project Score"
                value={health.overall == null ? '—' : `${Math.round(health.overall)} / 100 (${scoreLabel(health.overall)})`}
              />
              <Row label="Risk Index" value={health.riskIndex == null ? '—' : `${Math.round(health.riskIndex)}%`} />
              <Row label="Project Manager" value={project.owner?.name} />
              <Row label="Overall Project Rating" value={overallRating == null ? '—' : `${overallRating} / 100`} />
            </div>
          </div>

          {/* II. Project Timeline */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">II. Phase Timeline</h2>
            <hr className="report-divider" />
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>#</th><th>Phase</th><th>Owner</th><th>Planned</th><th>Actual</th><th>Slippage</th><th>Completed On</th></tr></thead>
              <tbody>
                {phases.map((p) => (
                  <tr key={p.key}>
                    <td>{p.index}</td>
                    <td>{p.name}</td>
                    <td>{p.ownerDepartment || '—'}</td>
                    <td>{p.plannedDays != null ? `${p.plannedDays}d` : '—'}</td>
                    <td>{p.actualDays != null ? `${p.actualDays}d` : '—'}</td>
                    <td>{p.slippageDays == null ? '—' : `${p.slippageDays > 0 ? '+' : ''}${p.slippageDays}d`}</td>
                    <td>{p.completedAt ? fmtDate(p.completedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* III. Budget Analysis */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">III. Budget Analysis</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <Row label="Planned Budget" value={fmtCurrency(budget.planned)} />
              <Row label="Actual Cost" value={fmtCurrency(budget.actual)} />
              <Row label="Variance" value={budget.variance == null ? '—' : `${fmtCurrency(budget.variance)} (${budget.variancePct.toFixed(2)}%)`} />
              <Row label="Budget Utilisation" value={budget.utilizationPct == null ? '—' : `${budget.utilizationPct.toFixed(1)}%`} />
              <Row label="Total Invoiced" value={fmtCurrency(financials.invoiced)} />
              <Row label="Total Paid" value={fmtCurrency(financials.paid)} />
              <Row label="Pending Payment" value={fmtCurrency(financials.pending)} />
              <Row label="Closure Certificate No." value={financials.certificateNo} />
            </div>
            {budget.notes && <p className="report-value-text" style={{ marginTop: 10 }}><strong>Variance notes:</strong> {budget.notes}</p>}
          </div>

          {/* IV. Delay Analysis */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">IV. Delay Analysis</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <Row label="Planned Duration" value={schedule.planned == null ? '—' : `${schedule.planned} days`} />
              <Row label="Actual Duration" value={schedule.actual == null ? '—' : `${schedule.actual} days`} />
              <Row label="Delay" value={schedule.delayDays == null ? '—' : schedule.delayDays === 0 ? 'On time' : `${schedule.delayDays} days`} />
              <Row label="Timeline Efficiency" value={schedule.efficiencyPct == null ? '—' : `${schedule.efficiencyPct.toFixed(1)}%`} />
              <Row label="Root Cause" value={schedule.rootCause} />
              <Row label="Critical Delays" value={criticalDelays.length} />
            </div>
            {schedule.reason && <p className="report-value-text" style={{ marginTop: 10 }}><strong>Delay reason:</strong> {schedule.reason}</p>}
            {schedule.recovery && <p className="report-value-text"><strong>Recovery actions:</strong> {schedule.recovery}</p>}
          </div>

          {/* V. Vendor Performance */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">V. Vendor Performance</h2>
            <hr className="report-divider" />
            {vendors.length ? (
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Vendor</th><th>Category</th><th>Assigned</th><th>Completed</th><th>Delayed</th><th>Quality</th><th>SLA</th><th>Rating</th><th>Cost</th><th>Payment</th><th>Grade</th></tr></thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td>{v.category}</td>
                      <td>{v.assigned ?? '—'}</td>
                      <td>{v.completed ?? '—'}</td>
                      <td>{v.delayed ?? '—'}</td>
                      <td>{v.quality ?? '—'}</td>
                      <td>{v.sla == null ? '—' : `${v.sla}%`}</td>
                      <td>{v.rating == null ? '—' : `${v.rating}/5`}</td>
                      <td>{v.cost == null ? '—' : fmtCurrency(v.cost)}</td>
                      <td>{v.paymentStatus}</td>
                      <td>{v.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty sm">No vendor evaluations approved yet.</div>}
          </div>

          {/* VI. Department Performance */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VI. Department Performance</h2>
            <hr className="report-divider" />
            {departments.length ? (
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Department</th><th>Tasks</th><th>Approved</th><th>Delayed</th><th>Completion</th><th>Quality</th><th>Productivity</th><th>Overall</th><th>Grade</th></tr></thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      <td>{d.total}</td>
                      <td>{d.completed}</td>
                      <td>{d.delayed}</td>
                      <td>{d.completionPct == null ? '—' : `${Math.round(d.completionPct)}%`}</td>
                      <td>{d.qualityPct == null ? '—' : `${Math.round(d.qualityPct)}%`}</td>
                      <td>{d.productivityPct == null ? '—' : `${Math.round(d.productivityPct)}%`}</td>
                      <td>{d.overall == null ? '—' : Math.round(d.overall)}</td>
                      <td>{d.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty sm">No departmental tasks on this project.</div>}
          </div>

          {/* VII. Project Health */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VII. Project Health Report</h2>
            <hr className="report-divider" />
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>Axis</th><th>Score</th><th>Rating</th></tr></thead>
              <tbody>
                {health.axes.map((a) => (
                  <tr key={a.key}>
                    <td>{a.label}</td>
                    <td>{a.value == null ? '—' : `${Math.round(a.value)} / 100`}</td>
                    <td>{scoreLabel(a.value)}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Overall</strong></td>
                  <td><strong>{health.overall == null ? '—' : `${Math.round(health.overall)} / 100`}</strong></td>
                  <td><strong>{scoreLabel(health.overall)}</strong></td>
                </tr>
              </tbody>
            </table>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Axes without an approved submission are excluded from the overall score rather than counted as zero.
            </p>
          </div>

          {/* VIII. Lessons Learned */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VIII. Lessons Learned</h2>
            <hr className="report-divider" />
            {lessons.rows.length ? (
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Category</th><th>Title</th><th>Impact</th><th>Key Learnings</th><th>Recommendations</th></tr></thead>
                <tbody>
                  {lessons.rows.map((l) => (
                    <tr key={l.id}>
                      <td>{l.category}</td>
                      <td>{l.title}</td>
                      <td>{l.impactArea || '—'}</td>
                      <td>{l.learnings || '—'}</td>
                      <td>{l.recommendations || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty sm">No learnings captured yet.</div>}
          </div>

          {/* IX. Final Approvals */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">IX. Final Approvals</h2>
            <hr className="report-divider" />
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Authority</th><th>Approved By</th><th>Approved On</th><th>Digital Signature</th><th>Remarks</th><th>Status</th></tr></thead>
              <tbody>
                {signOffs.map((s) => (
                  <tr key={`${s.role}-${s.record?._id || 'pending'}`}>
                    <td>{s.role}</td>
                    <td>{s.signedBy || '—'}</td>
                    <td>{s.signedAt ? fmtDate(s.signedAt) : '—'}</td>
                    <td>{s.signature || '—'}</td>
                    <td>{s.remarks || '—'}</td>
                    <td>{s.status === 'approved' ? 'Approved' : 'Pending'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* X. Audit Trail */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">X. Audit Trail</h2>
            <hr className="report-divider" />
            {auditTrail.length ? (
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Date</th><th>Actor</th><th>Activity</th></tr></thead>
                <tbody>
                  {auditTrail.slice(0, 40).map((a) => (
                    <tr key={a._id}>
                      <td className="tiny muted">{fmtDateTime(a.createdAt)}</td>
                      <td>{a.actor?.name || 'System'}</td>
                      <td>{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty sm">No closure activity recorded yet.</div>}
          </div>

          {/* XI. Recommendations */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">XI. Recommendations</h2>
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

export default ClosureReportPage;
