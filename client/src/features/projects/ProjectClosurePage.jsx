import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock, XCircle, Circle, Search, Archive,
  Wallet, Users, Landmark, PackageCheck, BookOpen, ClipboardCheck, TrendingUp,
  Gauge, ShieldCheck, Building2, Star, Lightbulb, Activity as ActivityIcon,
  Percent, AlertTriangle, ArrowRight, FileText, FileSpreadsheet, Lock,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, ProgressRing } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision,
} from '../../app/api/recordsApi.js';
import {
  useProject, useProjectActivity, useClosureReadiness, useArchiveProject, useLogClosureAudit,
} from '../../app/api/projectsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime, fmtCurrency } from '../../lib/format.js';
import { HEALTH_META, PROJECT_STATUS_META, deptMeta, isTaskDelayed } from '../../lib/ui.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { buildRecordMeta, submissionNoOf, remarksOf } from './records/recordUi.js';
import { exportXls, exportPdf } from './comparison/exportUtils.js';
import { PhaseTimeline } from './closure/PhaseTimeline.jsx';
import { ClosureKpiCard, InfoTile, ScoreRingTile, AwaitingData } from './closure/ClosureKit.jsx';
import {
  BudgetAnalysisTab, TimelineAnalysisTab, VendorPerformanceTab,
  DepartmentPerformanceTab, HealthReportPanel,
} from './closure/ClosureAnalyticsTabs.jsx';
import {
  LessonsLearnedTab, DocumentsTab, ApprovalsTab, ReportCenterTab, ArchivePanelTab, AuditLogTab,
} from './closure/ClosureGovernanceTabs.jsx';
import {
  closureRecordsOf, moduleStatusKey, MODULE_STATUS_META, checklistPct, latestApprovedOf, approvedOf,
  buildBudget, buildSchedule, buildPhases, buildVendors, buildDepartments, buildDepartmentDelays,
  buildLessons, buildDocuments, buildSignOffs, buildFinancials, buildHealth, buildAuditTrail,
  meanOf, num, clampPct, scoreTone, scoreLabel,
} from './closure/closureAnalytics.js';

const STAGE_KEY = 'p10';

/** URL segment ⇄ tab. The overview lives at the bare phase path. */
const TABS = [
  { key: 'overview', path: '', label: 'Closure Overview' },
  { key: 'modules', path: 'modules', label: 'Closure Modules' },
  { key: 'budget', path: 'budget', label: 'Budget Analysis' },
  { key: 'timeline', path: 'timeline', label: 'Timeline Analysis' },
  { key: 'vendors', path: 'vendors', label: 'Vendor Performance' },
  { key: 'departments', path: 'departments', label: 'Department Performance' },
  { key: 'lessons', path: 'lessons', label: 'Lessons Learned' },
  { key: 'documents', path: 'documents', label: 'Documents' },
  { key: 'approvals', path: 'approvals', label: 'Final Approvals' },
  { key: 'reports', path: 'reports', label: 'Report Center' },
  { key: 'archive', path: 'archive', label: 'Archive' },
  { key: 'audit', path: 'audit', label: 'Audit Log' },
];

/** Icon + accent per closure module, keyed off its assessmentType so a template reorder can't desync the visuals. */
const MODULE_VISUALS = {
  budget_analysis: { Icon: Wallet, color: '#7C3AED' },
  delay_analysis: { Icon: Clock, color: '#D97706' },
  vendor_performance: { Icon: Users, color: '#059669' },
  financial_closure: { Icon: Landmark, color: '#2563EB' },
  asset_handover: { Icon: PackageCheck, color: '#8B5CF6' },
  document_archive: { Icon: Archive, color: '#EA580C' },
  lessons_learned: { Icon: BookOpen, color: '#10B981' },
  project_sign_off: { Icon: ClipboardCheck, color: '#0D9488' },
};
const FALLBACK_VISUAL = { Icon: Circle, color: '#6B7280' };

/** Which tab a given module's analytics live on — the card's "View Analysis" deep-link. */
const MODULE_TAB = {
  budget_analysis: 'budget',
  delay_analysis: 'timeline',
  vendor_performance: 'vendors',
  financial_closure: 'budget',
  document_archive: 'documents',
  lessons_learned: 'lessons',
  project_sign_off: 'approvals',
};

const pctFmt = (n) => `${Math.round(n)}`;
const oneDp = (n) => n.toFixed(1);

/**
 * One module card in the Closure Workspace — status, checklist progress, and
 * both actions. `locked` (no property resolved, or the project is archived)
 * turns the primary action into a read-only one rather than letting a
 * submission be filed that could never be attributed to a property.
 */
function ModuleCard({ type, module, onOpenModule, onViewAnalysis, readOnly, locked, lockedHint }) {
  const { Icon, color } = MODULE_VISUALS[type.key] || FALLBACK_VISUAL;
  const smeta = module.statusMeta;
  return (
    <div className="card pcc-module-card" style={{ '--module-color': color }}>
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="pcc-module-icon"><Icon size={16} strokeWidth={2.1} /></span>
        <Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge>
      </div>
      <div className="col gap-1">
        <span className="pcc-module-title" title={type.name}>{type.name}</span>
        <span className="pcc-module-desc">{type.subtitle}</span>
      </div>
      {module.checklistPct != null && (
        <div className="col gap-1">
          <ProgressBar value={module.checklistPct} height={5} gradient={color} />
          <span className="tiny muted">{Math.round(module.checklistPct)}% of checklist verified</span>
        </div>
      )}
      <span className="tiny muted">
        {module.total} submission{module.total === 1 ? '' : 's'}
        {module.pendingReview > 0 ? ` · ${module.pendingReview} awaiting review` : ''}
      </span>
      <div className="row gap-2" style={{ marginTop: 'auto', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-sm ${readOnly || locked ? 'btn-subtle' : 'btn-primary'}`}
          onClick={onOpenModule}
          disabled={locked}
          title={locked ? lockedHint : undefined}
        >
          {readOnly ? 'View Module' : 'Open Module'}
        </button>
        {onViewAnalysis && (
          <button type="button" className="btn btn-subtle btn-sm" onClick={onViewAnalysis}>
            View Analysis
          </button>
        )}
      </div>
    </div>
  );
}

/** Icon + colour for one activity row, read off its message text. */
function activityMeta(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: '#DC2626' };
  if (m.includes('archived')) return { Icon: Archive, color: '#7C3AED' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: '#059669' };
  if (m.includes('exported') || m.includes('generated')) return { Icon: FileText, color: '#0EA5E9' };
  if (m.includes('submitted')) return { Icon: Clock, color: '#D97706' };
  return { Icon: Circle, color: 'var(--text-subtle)' };
}

/**
 * Project Closure (Phase 10) — the Closure Command Center.
 *
 * One routed shell (`/projects/:id/project-closure/:tab`) over twelve tabs that
 * are all client-side slices of the same real data: the project's own stages,
 * budget and status; every project Task; the eight p10 closure Records; and the
 * project activity trail. The eight module forms, their approval flow and the
 * records table are the original workspace, preserved intact as the "Closure
 * Modules" tab — the analytics tabs read those same submissions rather than
 * introducing a parallel store.
 *
 * Every derivation lives in closure/closureAnalytics.js. A metric with no
 * approved submission behind it renders "—", never a zero — see that file's
 * contract.
 */
export function ProjectClosurePage({ tab: tabProp }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  // 200 covers the full closure trail for the Audit Log; the server caps at 500.
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id, 200);
  // Department performance aggregates every task on the project, so this asks
  // for the whole list (the API caps a page at 1000). `meta.total` is the
  // unpaginated count — if it ever exceeds what came back, the scorecards say
  // so rather than quietly reporting a partial figure as the real one.
  const { data: tasksResp } = useTasks({ project: id, limit: 1000 });
  const allTasks = tasksResp?.data || tasksResp || [];
  const taskTotal = tasksResp?.meta?.total ?? allTasks.length;
  const tasksTruncated = taskTotal > allTasks.length;

  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: launchRecords } = useStageRecords(id, 'p9');
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: closureRecords, isLoading: recordsLoading } = useStageRecords(id, STAGE_KEY);
  const { data: gates, isLoading: gatesLoading } = useClosureReadiness(id);

  const createRecord = useCreateRecord(id, STAGE_KEY);
  const updateRecord = useUpdateRecord(id, STAGE_KEY);
  const decide = useRecordDecision(id, STAGE_KEY);
  const archiveProject = useArchiveProject(id);
  const logAudit = useLogClosureAudit(id);
  const markOpened = useMarkRecordOpened(id, 'p1');

  const user = useAppSelector(selectCurrentUser);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';
  const canArchive = canDecide;

  const [activeForm, setActiveForm] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [archiveRemarks, setArchiveRemarks] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const openLoggedRef = useRef(false);

  const activeTab = TABS.find((t) => t.key === tabProp) ? tabProp : 'overview';
  const goTab = (key) => {
    const t = TABS.find((x) => x.key === key);
    navigate(`/projects/${id}/project-closure${t?.path ? `/${t.path}` : ''}`);
  };

  const stage = project?.stages?.find((s) => s.key === STAGE_KEY);
  const isCompleted = stage?.status === 'completed';
  const isArchived = project?.status === 'archived';
  const assessmentTypes = useMemo(
    () => template?.stages?.find((s) => s.key === STAGE_KEY)?.assessmentTypes || [],
    [template],
  );

  /**
   * Which property this closure belongs to. Phase 9 is Task-based now, so
   * eligibility is no longer "every p9 module approved" — it's simply the
   * shortlisted property the project was actually built at. Resolved in
   * confidence order: whatever existing p10 records already point at, then a
   * property with an approved Store Launch submission, then the first
   * shortlisted one.
   */
  const property = useMemo(() => {
    const list = shortlisted || [];
    if (!list.length) return null;
    const parentOfClosure = (closureRecords || [])[0]?.parentRecordId;
    if (parentOfClosure) {
      const match = list.find((p) => String(p._id) === String(parentOfClosure));
      if (match) return match;
    }
    const launched = list.find((p) => (launchRecords || []).some(
      (r) => String(r.parentRecordId) === String(p._id) && r.status === 'approved',
    ));
    return launched || list[0];
  }, [shortlisted, closureRecords, launchRecords]);
  const propertyId = property?._id;

  /* ─────────────────────────── derived closure data ─────────────────────────── */

  const closureRecs = useMemo(() => closureRecordsOf(closureRecords, propertyId), [closureRecords, propertyId]);
  const phases = useMemo(() => buildPhases(project), [project]);
  const budget = useMemo(() => buildBudget(closureRecs, project), [closureRecs, project]);
  const schedule = useMemo(() => buildSchedule(closureRecs, project, phases), [closureRecs, project, phases]);
  const vendors = useMemo(() => buildVendors(closureRecs), [closureRecs]);
  const departments = useMemo(() => buildDepartments(allTasks), [allTasks]);
  const departmentDelays = useMemo(() => buildDepartmentDelays(allTasks), [allTasks]);
  const lessons = useMemo(() => buildLessons(closureRecs), [closureRecs]);
  const documents = useMemo(() => buildDocuments(closureRecs, assessmentTypes), [closureRecs, assessmentTypes]);
  const signOffs = useMemo(() => buildSignOffs(closureRecs), [closureRecs]);
  const financials = useMemo(() => buildFinancials(closureRecs), [closureRecs]);

  const criticalDelays = useMemo(
    () => allTasks
      .filter((t) => ['critical', 'high'].includes(t.priority) && isTaskDelayed(t))
      .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'critical' ? -1 : 1)),
    [allTasks],
  );

  /** One summary row per closure module — drives the workspace cards, the sidebar checklist and the approvals table. */
  const modules = useMemo(() => assessmentTypes.map((type) => {
    const own = closureRecs.filter((r) => r.assessmentType === type.key);
    const statusKey = moduleStatusKey(closureRecs, type.key);
    return {
      type,
      statusKey,
      statusMeta: MODULE_STATUS_META[statusKey],
      total: own.length,
      approved: own.filter((r) => r.status === 'approved').length,
      rejected: own.filter((r) => r.status === 'rejected').length,
      pendingReview: own.filter((r) => r.status === 'submitted').length,
      checklistPct: checklistPct(type, closureRecs),
    };
  }), [assessmentTypes, closureRecs]);

  const doneModules = modules.filter((m) => m.statusKey === 'approved').length;
  const modulesPct = modules.length ? (doneModules / modules.length) * 100 : null;

  // Quality / compliance read the boolean checklists of the modules that
  // actually evidence them — asset + document handover for quality, document
  // archive + sign-off for compliance.
  const qualityScore = useMemo(() => meanOf([
    checklistPct(assessmentTypes.find((t) => t.key === 'asset_handover'), closureRecs),
    checklistPct(assessmentTypes.find((t) => t.key === 'document_archive'), closureRecs),
  ]), [assessmentTypes, closureRecs]);
  const complianceScore = useMemo(() => meanOf([
    checklistPct(assessmentTypes.find((t) => t.key === 'document_archive'), closureRecs),
    checklistPct(assessmentTypes.find((t) => t.key === 'project_sign_off'), closureRecs),
  ]), [assessmentTypes, closureRecs]);

  // Customer readiness — the share of Store Readiness (p8) + Store Launch (p9)
  // checklist tasks that reached Approved. Real task data, no proxy.
  const customerReadiness = useMemo(() => {
    const rel = allTasks.filter((t) => t.stageKey === 'p8' || t.stageKey === 'p9');
    if (!rel.length) return null;
    return clampPct((rel.filter((t) => t.status === 'approved').length / rel.length) * 100);
  }, [allTasks]);

  const health = useMemo(() => buildHealth({
    budget, schedule, vendors, departments, modulesPct, quality: qualityScore, compliance: complianceScore, customerReadiness,
  }), [budget, schedule, vendors, departments, modulesPct, qualityScore, complianceScore, customerReadiness]);

  const vendorRating = useMemo(() => meanOf(vendors.map((v) => v.rating)), [vendors]);

  const auditTrail = useMemo(
    () => buildAuditTrail(activities, closureRecs.map((r) => r._id), propertyId),
    [activities, closureRecs, propertyId],
  );

  /* ───────────────────────────── project summary facts ──────────────────────── */

  const latestApprovedValue = (records, typeKey, field) => {
    const approved = (records || []).filter((r) => r.assessmentType === typeKey && r.status === 'approved');
    const latest = approved.sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0];
    return latest?.values?.[field];
  };
  const p4Recs = (projectCreationRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const p9Recs = (launchRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));

  const projectManager = project?.owner?.name || latestApprovedValue(p4Recs, 'manager_assignment', 'project_manager') || null;
  const launchMasterData = project?.masterData?.p9 || {};
  const regionalManager = launchMasterData.regionalHead || null;
  const storeManager = latestApprovedValue(p9Recs, 'go_live_approval', 'store_manager') || null;

  const signOffRecord = latestApprovedOf(closureRecs, 'project_sign_off');
  const overallRating = num(signOffRecord?.values?.overall_rating);
  const closureDate = approvedOf(closureRecs, 'project_sign_off')
    .map((r) => r.values?.sign_off_date)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;

  const lastPhaseCompletedAt = phases.map((p) => p.completedAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  const actualCompletionDate = project?.archivedAt || project?.actualEndDate || lastPhaseCompletedAt || null;

  const healthMeta = HEALTH_META[project?.health] || HEALTH_META.on_track;
  const statusMeta = PROJECT_STATUS_META[project?.status] || PROJECT_STATUS_META.active;

  /* ──────────────────────────────── effects ─────────────────────────────────── */

  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (closureRecs.length === 0) markOpened.mutate(propertyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  // NOTE: this stage is completed by the SERVER — approving a closure module
  // triggers it (record.service.js#decide's p10 branch) and completeStage's
  // own p10 gate decides whether everything else is genuinely in place
  // (every prior phase complete, store live, no open task). The old effect
  // here fired on "all modules approved" alone, which is only one of those
  // conditions.

  /* ──────────────────────────── record interactions ─────────────────────────── */

  /**
   * Open a module. Normally that starts a fresh submission; once the project is
   * archived nothing can be filed, so it opens that module's latest submission
   * read-only instead of an empty locked form.
   */
  const openNewSubmission = (type) => {
    // Every closure record hangs off the property being closed. Without one
    // resolved, a submission would be created with no parent and never appear
    // in this workspace again — so the action is blocked, not silently lost.
    if (!propertyId) return;
    if (isArchived) {
      const latest = closureRecs.find((r) => r.assessmentType === type.key) || null;
      setActiveForm({ type, record: latest, readOnly: true });
      return;
    }
    setActiveForm({ type, record: null, readOnly: false });
  };
  const openView = (record) => {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: true });
  };
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  const saveRecord = async (values, status) => {
    const { type, record } = activeForm;
    if (record && record.status !== 'approved') {
      await updateRecord.mutateAsync({ id: record._id, values, status });
    } else {
      await createRecord.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    }
    closeForm();
  };

  const doApprove = (record) => decide.mutate({ id: record._id, decision: 'approve' }, { onSuccess: closeForm });
  const doReject = (reason) => decide.mutate(
    { id: rejectTarget._id, decision: 'reject', reason },
    { onSuccess: () => { setRejectTarget(null); closeForm(); } },
  );

  /**
   * Inline status change from the records table (RecordsTable → StatusDropdown).
   * `verb` is already the decision verb the API expects — see DECISION_MAP in
   * record.service.js — so this just forwards it with any reject reason.
   */
  const onRecordDecide = (record, verb, extra = {}) =>
    decide.mutate({ id: record._id, decision: verb, reason: extra.reason, remarks: extra.remarks });

  const doArchive = () => {
    setArchiveError('');
    archiveProject.mutate(archiveRemarks, {
      onError: (err) => setArchiveError(err?.response?.data?.message || 'This project is not ready to archive yet.'),
    });
  };

  /* ────────────────────────────────── exports ───────────────────────────────── */

  const reportTitle = (name) => `${name} — ${project?.code || ''} ${project?.name || ''}`.trim();
  const fileBase = `${(project?.code || id).toLowerCase()}-closure`;

  /** Rows + columns per report — each reads the same derivations the tabs render. */
  const REPORT_DATA = {
    executive: () => ({
      name: 'Executive Summary',
      rows: [
        { metric: 'Project', value: `${project.code} · ${project.name}` },
        { metric: 'Status', value: statusMeta.label },
        { metric: 'Project Completion', value: `${project.progress ?? 0}%` },
        { metric: 'Overall Project Score', value: health.overall == null ? '—' : `${Math.round(health.overall)}/100` },
        { metric: 'Planned Budget', value: fmtCurrency(budget.planned) },
        { metric: 'Actual Cost', value: fmtCurrency(budget.actual) },
        { metric: 'Budget Variance', value: budget.variance == null ? '—' : `${fmtCurrency(budget.variance)} (${budget.variancePct.toFixed(2)}%)` },
        { metric: 'Planned Duration', value: schedule.planned == null ? '—' : `${schedule.planned} days` },
        { metric: 'Actual Duration', value: schedule.actual == null ? '—' : `${schedule.actual} days` },
        { metric: 'Delay', value: schedule.delayDays == null ? '—' : schedule.delayDays === 0 ? 'On time' : `${schedule.delayDays} days` },
        { metric: 'Vendors Evaluated', value: vendors.length },
        { metric: 'Lessons Captured', value: lessons.rows.length },
        { metric: 'Closure Modules Approved', value: `${doneModules}/${modules.length}` },
        { metric: 'Risk Index', value: health.riskIndex == null ? '—' : `${Math.round(health.riskIndex)}%` },
      ],
      columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }],
    }),
    budget: () => ({
      name: 'Budget Report',
      rows: [
        { item: 'Planned Budget', amount: fmtCurrency(budget.planned), note: '' },
        { item: 'Actual Cost', amount: fmtCurrency(budget.actual), note: '' },
        { item: 'Variance', amount: fmtCurrency(budget.variance), note: budget.variancePct == null ? '' : `${budget.variancePct.toFixed(2)}%` },
        { item: 'Budget Utilisation', amount: budget.utilizationPct == null ? '—' : `${budget.utilizationPct.toFixed(1)}%`, note: '' },
        { item: 'Total Invoiced', amount: fmtCurrency(financials.invoiced), note: '' },
        { item: 'Total Paid', amount: fmtCurrency(financials.paid), note: '' },
        { item: 'Pending Payment', amount: fmtCurrency(financials.pending), note: financials.certificateNo ? `Certificate ${financials.certificateNo}` : '' },
        ...vendors.filter((v) => v.cost != null).map((v) => ({ item: `Vendor — ${v.name}`, amount: fmtCurrency(v.cost), note: v.category })),
      ],
      columns: [{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount' }, { key: 'note', label: 'Note' }],
    }),
    delay: () => ({
      name: 'Delay Report',
      rows: phases.map((p) => ({
        phase: `Phase ${p.index} · ${p.name}`,
        planned: p.plannedDays != null ? `${p.plannedDays}d` : '—',
        actual: p.actualDays != null ? `${p.actualDays}d` : '—',
        slippage: p.slippageDays == null ? '—' : `${p.slippageDays > 0 ? '+' : ''}${p.slippageDays}d`,
        completed: p.completedAt ? fmtDate(p.completedAt) : '—',
      })),
      columns: [
        { key: 'phase', label: 'Phase' }, { key: 'planned', label: 'Planned' },
        { key: 'actual', label: 'Actual' }, { key: 'slippage', label: 'Slippage' },
        { key: 'completed', label: 'Completed On' },
      ],
    }),
    vendor: () => ({
      name: 'Vendor Performance Report',
      rows: vendors.map((v) => ({
        vendor: v.name, category: v.category,
        assigned: v.assigned ?? '—', completed: v.completed ?? '—', delayed: v.delayed ?? '—',
        quality: v.quality ?? '—', sla: v.sla == null ? '—' : `${v.sla}%`,
        rating: v.rating == null ? '—' : `${v.rating}/5`,
        cost: v.cost == null ? '—' : fmtCurrency(v.cost),
        payment: v.paymentStatus, grade: v.grade,
      })),
      columns: [
        { key: 'vendor', label: 'Vendor' }, { key: 'category', label: 'Category' },
        { key: 'assigned', label: 'Assigned' }, { key: 'completed', label: 'Completed' },
        { key: 'delayed', label: 'Delayed' }, { key: 'quality', label: 'Quality' },
        { key: 'sla', label: 'SLA' }, { key: 'rating', label: 'Rating' },
        { key: 'cost', label: 'Cost' }, { key: 'payment', label: 'Payment' }, { key: 'grade', label: 'Grade' },
      ],
    }),
    department: () => ({
      name: 'Department Performance Report',
      rows: departments.map((d) => ({
        department: d.label, tasks: d.total, approved: d.completed, delayed: d.delayed, rework: d.reworked,
        completion: d.completionPct == null ? '—' : `${Math.round(d.completionPct)}%`,
        quality: d.qualityPct == null ? '—' : `${Math.round(d.qualityPct)}%`,
        productivity: d.productivityPct == null ? '—' : `${Math.round(d.productivityPct)}%`,
        overall: d.overall == null ? '—' : Math.round(d.overall), grade: d.grade,
      })),
      columns: [
        { key: 'department', label: 'Department' }, { key: 'tasks', label: 'Tasks' },
        { key: 'approved', label: 'Approved' }, { key: 'delayed', label: 'Delayed' },
        { key: 'rework', label: 'Rework' }, { key: 'completion', label: 'Completion' },
        { key: 'quality', label: 'Quality' }, { key: 'productivity', label: 'Productivity' },
        { key: 'overall', label: 'Overall' }, { key: 'grade', label: 'Grade' },
      ],
    }),
    lessons: () => ({
      name: 'Lessons Learned Report',
      rows: lessons.rows.map((l) => ({
        category: l.category, title: l.title, impact: l.impactArea || '—',
        learnings: l.learnings || '—', recommendations: l.recommendations || '—',
        capturedBy: l.capturedBy, capturedOn: l.capturedAt ? fmtDate(l.capturedAt) : '—',
      })),
      columns: [
        { key: 'category', label: 'Category' }, { key: 'title', label: 'Title' },
        { key: 'impact', label: 'Impact Area' }, { key: 'learnings', label: 'Key Learnings' },
        { key: 'recommendations', label: 'Recommendations' },
        { key: 'capturedBy', label: 'Captured By' }, { key: 'capturedOn', label: 'Captured On' },
      ],
    }),
    audit: () => ({
      name: 'Closure Audit Log',
      rows: auditTrail.map((a) => ({
        activity: a.message, actor: a.actor?.name || 'System', at: fmtDateTime(a.createdAt),
      })),
      columns: [{ key: 'activity', label: 'Activity' }, { key: 'actor', label: 'Actor' }, { key: 'at', label: 'Date & Time' }],
    }),
    records: () => ({
      name: 'Project Closure Records',
      rows: closureRecs,
      columns: [
        { key: 'module', label: 'Module', get: (r) => assessmentTypes.find((t) => t.key === r.assessmentType)?.name || r.title },
        { key: 'submissionNo', label: 'Submission No.', get: (r) => `#${submissionNoOf(closureRecs, r)}` },
        { key: 'submittedBy', label: 'Submitted By', get: (r) => r.submittedBy?.name || '—' },
        { key: 'submittedOn', label: 'Submitted On', get: (r) => (r.submittedAt ? fmtDate(r.submittedAt) : '—') },
        { key: 'reviewedBy', label: 'Reviewed By', get: (r) => r.decidedBy?.name || '—' },
        { key: 'approvedOn', label: 'Approved On', get: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : '—') },
        { key: 'status', label: 'Status', get: (r) => (MODULE_STATUS_META[r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'in_progress'].label) },
        { key: 'remarks', label: 'Remarks', get: (r) => remarksOf(r) || '—' },
      ],
    }),
  };

  /**
   * The whitelisted audit event for one export. Reports that have their own
   * event use it for both formats (the format is already obvious from the
   * download); the generic ones fall back to the per-format event.
   */
  const auditEventFor = (reportKey, format) => (
    {
      budget: 'export_budget', delay: 'export_delay', vendor: 'export_vendor',
      department: 'export_department', lessons: 'export_lessons',
    }[reportKey] || (format === 'excel' ? 'export_excel' : 'export_pdf')
  );

  /** Run one report in one format and append the matching audit line. */
  const runExport = (reportKey, format) => {
    const build = REPORT_DATA[reportKey];
    if (!build) return;
    const { name, rows, columns } = build();
    if (format === 'excel') exportXls(rows, columns, `${fileBase}-${reportKey}.xls`);
    else exportPdf(reportTitle(name), rows, columns);
    logAudit.mutate(auditEventFor(reportKey, format));
  };

  const openFullReport = () => {
    logAudit.mutate('report_generated');
    navigate(`/projects/${id}/project-closure/report`);
  };

  /** Certificate of closure — same hidden-iframe print approach Phase 9's Go-Live certificate uses. */
  const printCertificate = () => {
    logAudit.mutate('certificate_generated');
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    const esc = (v) => String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    doc.open();
    doc.write(`
      <html><head><title>Certificate of Project Closure — ${esc(project.code)}</title>
      <style>
        body { font-family: Georgia, serif; padding: 48px; text-align: center; color: #1a1a1a; }
        .frame { border: 4px double #16a79a; padding: 40px; }
        h1 { font-size: 26px; margin-bottom: 4px; }
        h2 { font-size: 16px; font-weight: normal; color: #555; margin-top: 0; }
        .store { font-size: 22px; font-weight: bold; margin: 24px 0 4px; }
        .code { color: #555; margin-bottom: 24px; }
        table { margin: 24px auto; border-collapse: collapse; }
        td { padding: 6px 18px; text-align: left; font-size: 13px; }
        td.label { color: #777; }
      </style></head>
      <body><div class="frame">
        <h1>Certificate of Project Closure</h1>
        <h2>Mystery Rooms — Store Expansion Programme</h2>
        <div class="store">${esc(project.name)}</div>
        <div class="code">${esc(project.code)}</div>
        <table>
          <tr><td class="label">Closure Date</td><td>${esc(closureDate ? fmtDate(closureDate) : project.archivedAt ? fmtDate(project.archivedAt) : '—')}</td></tr>
          <tr><td class="label">Archived On</td><td>${esc(project.archivedAt ? fmtDateTime(project.archivedAt) : '—')}</td></tr>
          <tr><td class="label">Archived By</td><td>${esc(project.archivedBy?.name)}</td></tr>
          <tr><td class="label">Overall Project Score</td><td>${esc(health.overall == null ? '—' : `${Math.round(health.overall)} / 100`)}</td></tr>
          <tr><td class="label">Final Budget</td><td>${esc(fmtCurrency(budget.actual))}</td></tr>
          <tr><td class="label">Project Duration</td><td>${esc(schedule.actual == null ? '—' : `${schedule.actual} days`)}</td></tr>
          <tr><td class="label">Signed Off By</td><td>${esc(signOffRecord?.values?.digital_signature || signOffRecord?.values?.signed_off_by)}</td></tr>
        </table>
      </div></body></html>
    `);
    doc.close();
    iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => iframe.remove(), 1000); };
  };

  /* ──────────────────────────────── rendering ───────────────────────────────── */

  if (isLoading || !project) {
    return (<><Topbar title="Project Closure" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Project Closure</span>} />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Project Closure stage" hint="This project has no Project Closure stage." />
        </div>
      </>
    );
  }

  const q = search.trim().toLowerCase();
  const visibleModules = q
    ? modules.filter((m) => m.type.name.toLowerCase().includes(q) || (m.type.subtitle || '').toLowerCase().includes(q))
    : modules;
  const visibleRecords = q
    ? closureRecs.filter((r) => {
      const moduleName = assessmentTypes.find((t) => t.key === r.assessmentType)?.name || '';
      return [moduleName, r.submittedBy?.name, remarksOf(r)].some((v) => (v || '').toLowerCase().includes(q));
    })
    : closureRecs;

  const archiveGates = gates || [];
  const gatesPassed = archiveGates.filter((g) => g.passed).length;
  const archiveReady = archiveGates.length > 0 && gatesPassed === archiveGates.length;

  const nextAction = isArchived
    ? { label: 'Project archived — nothing further to do', tone: '#059669', Icon: CheckCircle2 }
    : archiveReady
      ? { label: 'Every closure gate has cleared — archive the project', tone: '#059669', Icon: Archive }
      : doneModules < modules.length
        ? { label: `Complete ${modules.length - doneModules} remaining closure module${modules.length - doneModules === 1 ? '' : 's'}`, tone: '#D97706', Icon: ClipboardList }
        : { label: `Clear ${archiveGates.length - gatesPassed} outstanding archive gate${archiveGates.length - gatesPassed === 1 ? '' : 's'}`, tone: '#D97706', Icon: Lock };

  const loadingCore = propertiesLoading || templateLoading || recordsLoading;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            Phase 10: {stage.name}
            <Badge color={statusMeta.color} soft={statusMeta.soft} dot>{statusMeta.label}</Badge>
          </span>
        }
        subtitle={`${project.code} · ${project.name}${property?.title ? ` · ${property.title}` : ''} · ${project.city || ''}`}
        actions={
          <div className="filter-search" style={{ minWidth: 210 }}>
            <Search size={14} className="muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search modules, submissions…" />
          </div>
        }
      />

      <div className="content">
        <div className="se-page se-page--tight-top project-closure-page col gap-3 fade-in">
          <div className="tabs pcc-tabs">
            {TABS.map((t) => (
              <button key={t.key} type="button" className={`tab${activeTab === t.key ? ' active' : ''}`} onClick={() => goTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {loadingCore ? (
            <SkPropertyIdentification />
          ) : !assessmentTypes.length ? (
            <EmptyState
              icon={ClipboardList}
              title="No closure modules configured"
              hint="Add assessment types to the Project Closure stage in this project's template."
            />
          ) : (
            <>
              {!propertyId && (
                <div className="pcc-banner" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
                  <Lock size={18} />
                  <div className="col gap-1 grow">
                    <span className="sm" style={{ fontWeight: 700 }}>No property linked to this closure</span>
                    <span className="tiny muted">
                      Closure submissions are filed against the shortlisted property this store was built at, and none
                      is shortlisted in Phase 1 yet. The analytics below still read live project, task and phase data —
                      only new module submissions are blocked.
                    </span>
                  </div>
                </div>
              )}

              {isArchived && (
                <div className="pcc-banner pcc-banner-archived">
                  <Archive size={18} />
                  <div className="col gap-1 grow">
                    <span className="sm" style={{ fontWeight: 700 }}>Project Archived — Read Only</span>
                    <span className="tiny muted">
                      Closed {project.archivedAt ? fmtDateTime(project.archivedAt) : '—'}
                      {project.archivedBy?.name ? ` by ${project.archivedBy.name}` : ''}. Every phase is preserved for reference and can no longer be edited.
                    </span>
                  </div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={printCertificate}>
                    <FileText size={14} style={{ marginRight: 6 }} /> Closure Certificate
                  </button>
                </div>
              )}

              {/* ─────────────────────────── Overview ─────────────────────────── */}
              {activeTab === 'overview' && (
                <>
                  <div className="pcc-kpi-grid">
                    <ClosureKpiCard icon={Percent} label="Project Completion" value={project.progress ?? null} suffix="%" format={pctFmt} color="#2563EB" progress={project.progress ?? 0} badge={`${project.progress ?? 0}%`} />
                    <ClosureKpiCard icon={Star} label="Overall Project Score" value={health.overall} suffix="/100" format={pctFmt} color={scoreTone(health.overall)} progress={health.overall ?? 0} badge={scoreLabel(health.overall)} onClick={() => goTab('reports')} />
                    <ClosureKpiCard icon={Wallet} label="Budget Utilisation" value={budget.utilizationPct} suffix="%" format={oneDp} color="#7C3AED" progress={budget.utilizationPct == null ? 0 : Math.min(100, budget.utilizationPct)} hint={fmtCurrency(budget.actual)} onClick={() => goTab('budget')} />
                    <ClosureKpiCard icon={TrendingUp} label="Budget Variance" value={budget.variance == null ? null : Math.abs(budget.variance)} format={(n) => fmtCurrency(n)} color={budget.variance != null && budget.variance < 0 ? '#DC2626' : '#059669'} trend={budget.variancePct} trendSuffix="%" trendGoodWhenPositive hint={budget.variance != null && budget.variance < 0 ? 'Over budget' : 'Under budget'} onClick={() => goTab('budget')} />
                    <ClosureKpiCard icon={Gauge} label="Timeline Performance" value={schedule.efficiencyPct} suffix="%" format={pctFmt} color="#0EA5E9" progress={schedule.efficiencyPct == null ? 0 : Math.min(100, schedule.efficiencyPct)} onClick={() => goTab('timeline')} />
                    <ClosureKpiCard icon={Clock} label="Delay Days" value={schedule.delayDays == null ? null : Math.abs(schedule.delayDays)} format={pctFmt} color={schedule.delayDays > 0 ? '#DC2626' : '#059669'} badge={schedule.delayDays == null ? undefined : schedule.delayDays === 0 ? 'On Time' : schedule.delayDays > 0 ? 'Delayed' : 'Ahead'} badgeColor={schedule.delayDays > 0 ? '#DC2626' : '#059669'} onClick={() => goTab('timeline')} />
                    <ClosureKpiCard icon={Users} label="Vendor Rating" value={vendorRating} suffix="/5" format={oneDp} color="#059669" progress={vendorRating == null ? 0 : (vendorRating / 5) * 100} hint={`${vendors.length} evaluated`} onClick={() => goTab('vendors')} />
                    <ClosureKpiCard icon={Building2} label="Department Performance" value={health.departmentScore} suffix="/100" format={pctFmt} color={scoreTone(health.departmentScore)} progress={health.departmentScore ?? 0} hint={`${departments.length} departments`} onClick={() => goTab('departments')} />
                    <ClosureKpiCard icon={AlertTriangle} label="Final Risk Score" value={health.riskIndex} suffix="%" format={pctFmt} color={health.riskIndex == null ? '#6B7280' : scoreTone(100 - health.riskIndex)} progress={health.riskIndex ?? 0} badge={health.riskIndex == null ? undefined : health.riskIndex <= 10 ? 'Low' : health.riskIndex <= 25 ? 'Moderate' : 'High'} badgeColor={health.riskIndex == null ? '#6B7280' : health.riskIndex <= 25 ? '#059669' : '#DC2626'} />
                    <ClosureKpiCard icon={ShieldCheck} label="Customer Readiness" value={customerReadiness} suffix="%" format={pctFmt} color="#16A79A" progress={customerReadiness ?? 0} hint="Phase 8 + 9 checklists" />
                    <ClosureKpiCard icon={Lightbulb} label="Lessons Captured" value={lessons.rows.length} format={pctFmt} color="#8B5CF6" hint={`${lessons.byCategory.filter((c) => c.items.length).length} categories`} onClick={() => goTab('lessons')} />
                    <ClosureKpiCard icon={ActivityIcon} label="Project Health" value={health.overall} suffix="/100" format={pctFmt} color={healthMeta.color} badge={healthMeta.label} badgeColor={healthMeta.color} progress={health.overall ?? 0} />
                  </div>

                  <SectionCard title="Project Summary" subtitle="Facts of record for this closure">
                    <div className="pcc-summary-grid">
                      <InfoTile label="Project Start Date" value={fmtDate(project.actualStartDate || project.plannedStartDate)} />
                      <InfoTile label="Store Launch Date" value={project.storeLiveAt ? fmtDate(project.storeLiveAt) : null} />
                      <InfoTile label="Actual Completion Date" value={actualCompletionDate ? fmtDate(actualCompletionDate) : null} />
                      <InfoTile label="Total Duration" value={schedule.planned == null ? null : `${schedule.planned} days`} mono />
                      <InfoTile label="Actual Duration" value={schedule.actual == null ? null : `${schedule.actual} days`} mono />
                      <InfoTile label="Project Manager" value={projectManager} />
                      <InfoTile label="Regional Manager" value={regionalManager} />
                      <InfoTile label="Store Manager" value={storeManager} />
                      <InfoTile
                        label="Overall Project Rating"
                        value={overallRating == null ? null : `${overallRating}/100`}
                        tone={scoreTone(overallRating)}
                        mono
                      />
                    </div>
                  </SectionCard>

                  <SectionCard title="Project Timeline" subtitle="All ten phases, with the real completion date, owning team and elapsed duration of each">
                    <PhaseTimeline phases={phases} />
                  </SectionCard>

                  <div className="pcc-overview-layout">
                    <div className="col gap-3">
                      <SectionCard
                        title="Closure Workspace"
                        subtitle="Open a module to file its submission, or jump to its analysis"
                        action={<Badge color="#2563EB" soft="#DBEAFE">{doneModules}/{modules.length} complete</Badge>}
                      >
                        {visibleModules.length === 0 ? (
                          <AwaitingData icon={Search} title="No modules match your search" hint="Clear the search box in the header." />
                        ) : (
                          <div className="pcc-module-grid">
                            {visibleModules.map((m) => (
                              <ModuleCard
                                key={m.type.key}
                                type={m.type}
                                module={m}
                                readOnly={isArchived}
                                locked={!propertyId}
                                lockedHint="No shortlisted property is linked to this project, so a closure submission could not be attributed to one."
                                onOpenModule={() => openNewSubmission(m.type)}
                                onViewAnalysis={MODULE_TAB[m.type.key] ? () => goTab(MODULE_TAB[m.type.key]) : null}
                              />
                            ))}
                          </div>
                        )}
                      </SectionCard>

                      <SectionCard
                        title="Recent Activity"
                        subtitle="Latest closure events"
                        action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => goTab('audit')}>View full audit log</button>}
                      >
                        {activitiesLoading ? (
                          <div className="empty sm">Loading activity…</div>
                        ) : auditTrail.length === 0 ? (
                          <AwaitingData icon={ActivityIcon} title="No closure activity yet" hint="Events appear here as modules are filed and reviewed." />
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table className="table">
                              <thead><tr><th>#</th><th>Activity</th><th>Department</th><th>Updated By</th><th>Date</th><th>Remarks</th></tr></thead>
                              <tbody>
                                {auditTrail.slice(0, 8).map((a, i) => {
                                  const { Icon, color } = activityMeta(a.message);
                                  const dept = a.actor?.department ? deptMeta(a.actor.department) : null;
                                  return (
                                    <tr key={a._id}>
                                      <td className="tiny muted tabular">{i + 1}</td>
                                      <td className="sm">
                                        <span className="row gap-2" style={{ alignItems: 'center' }}>
                                          <Icon size={13} style={{ color, flexShrink: 0 }} /> {a.message}
                                        </span>
                                      </td>
                                      <td>{dept ? <Badge color={dept.color}>{dept.label}</Badge> : <span className="tiny muted">—</span>}</td>
                                      <td className="sm">{a.actor?.name || 'System'}</td>
                                      <td className="sm muted">{fmtDateTime(a.createdAt)}</td>
                                      <td className="tiny muted">{a.meta?.remarks || '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </SectionCard>
                    </div>

                    {/* Right rail */}
                    <div className="col gap-3">
                      <div className="card pcc-rail-card">
                        <span className="tiny subtle upper">Project Completion</span>
                        <div className="pcc-rail-ring">
                          <ProgressRing value={project.progress ?? 0} size={104} stroke={9} color="#2563EB" />
                          <span className="pcc-rail-ring-value">{project.progress ?? 0}%</span>
                        </div>
                        <div className="col gap-2" style={{ width: '100%' }}>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                            <span className="sm">Final Status</span>
                            <Badge color={statusMeta.color} soft={statusMeta.soft} dot>{statusMeta.label}</Badge>
                          </div>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                            <span className="sm">Archive Status</span>
                            <Badge color={isArchived ? '#7C3AED' : archiveReady ? '#059669' : '#6B7280'} soft={isArchived ? '#EDE9FE' : archiveReady ? '#DCFCE7' : '#F3F4F6'} dot>
                              {isArchived ? 'Archived' : archiveReady ? 'Ready to Archive' : `${gatesPassed}/${archiveGates.length} gates`}
                            </Badge>
                          </div>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                            <span className="sm">Closure Date</span>
                            <span className="sm" style={{ fontWeight: 650 }}>{closureDate ? fmtDate(closureDate) : '—'}</span>
                          </div>
                        </div>
                      </div>

                      <SectionCard
                        title="Closure Checklist"
                        action={<Badge color={doneModules === modules.length ? '#059669' : '#D97706'} soft={doneModules === modules.length ? '#DCFCE7' : '#FEF3C7'}>{doneModules}/{modules.length}</Badge>}
                      >
                        <div className="col gap-2">
                          {modules.map((m) => (
                            <button key={m.type.key} type="button" className="pcc-checklist-row" onClick={() => openNewSubmission(m.type)}>
                              <span className="pcc-checklist-icon" data-done={m.statusKey === 'approved'}>
                                {m.statusKey === 'approved' ? <CheckCircle2 size={15} /> : m.statusKey === 'rejected' ? <XCircle size={15} /> : <Circle size={15} />}
                              </span>
                              <span className="sm grow" style={{ textAlign: 'left' }}>{m.type.name}</span>
                              <Badge color={m.statusMeta.color} soft={m.statusMeta.soft}>{m.statusMeta.label}</Badge>
                            </button>
                          ))}
                        </div>
                      </SectionCard>

                      <SectionCard title="Project Health Report" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => goTab('reports')}>Reports</button>}>
                        <HealthReportPanel health={health} compact />
                      </SectionCard>

                      <SectionCard title="Next Action">
                        <div className="col gap-3">
                          <span className="sm row gap-2" style={{ alignItems: 'flex-start', color: nextAction.tone, fontWeight: 600 }}>
                            <nextAction.Icon size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {nextAction.label}
                          </span>
                          <button
                            type="button"
                            className={`btn btn-sm ${isArchived ? 'btn-subtle' : 'btn-primary'}`}
                            onClick={() => goTab(isArchived ? 'reports' : archiveReady ? 'archive' : 'modules')}
                            style={{ alignSelf: 'flex-start' }}
                          >
                            {isArchived ? 'Open Report Center' : archiveReady ? 'Go to Archive' : 'Open Closure Modules'}
                            <ArrowRight size={13} style={{ marginLeft: 6 }} />
                          </button>
                        </div>
                      </SectionCard>
                    </div>
                  </div>

                  <SectionCard title="Project Score Breakdown" subtitle="Each axis is scored only where an approved submission backs it">
                    <div className="pcc-ring-strip">
                      {health.axes.map((a) => <ScoreRingTile key={a.key} label={a.label} value={a.value} />)}
                      <div className="pcc-overall-ring">
                        <ProgressRing value={health.overall ?? 0} size={86} stroke={8} color={scoreTone(health.overall)} />
                        <div className="col gap-1" style={{ alignItems: 'center' }}>
                          <span className="pcc-overall-ring-value" style={{ color: scoreTone(health.overall) }}>
                            {health.overall == null ? '—' : `${Math.round(health.overall)}/100`}
                          </span>
                          <span className="tiny muted">{scoreLabel(health.overall)}</span>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                </>
              )}

              {/* ───────────────────────── Closure Modules ────────────────────── */}
              {activeTab === 'modules' && (
                <div className="col gap-3">
                  <SectionCard
                    title="Closure Workspace"
                    subtitle="Pick a module to fill and submit its record — unlimited resubmissions per module"
                    action={<Badge color="#2563EB" soft="#DBEAFE">{doneModules}/{modules.length} complete</Badge>}
                  >
                    {visibleModules.length === 0 ? (
                      <AwaitingData icon={Search} title="No modules match your search" hint="Clear the search box in the header." />
                    ) : (
                      <div className="pcc-module-grid">
                        {visibleModules.map((m) => (
                          <ModuleCard
                            key={m.type.key}
                            type={m.type}
                            module={m}
                            readOnly={isArchived}
                            locked={!propertyId}
                            lockedHint="No shortlisted property is linked to this project, so a closure submission could not be attributed to one."
                            onOpenModule={() => openNewSubmission(m.type)}
                            onViewAnalysis={MODULE_TAB[m.type.key] ? () => goTab(MODULE_TAB[m.type.key]) : null}
                          />
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <RecordsTable
                    title="Project Closure Records"
                    typeColumnLabel="Module"
                    records={visibleRecords}
                    assessmentTypes={assessmentTypes}
                    canDecide={canDecide && !isArchived}
                    decidePending={decide.isPending}
                    onView={openView}
                    onDecide={onRecordDecide}
                    showReviewedBy
                    showApprovedOn
                    showAttachments
                    statusMetaFor={(record) => MODULE_STATUS_META[
                      record.status === 'approved' ? 'approved' : record.status === 'rejected' ? 'rejected' : 'in_progress'
                    ]}
                    emptyTitle={q ? 'No records match this search' : 'No records filed yet'}
                    emptyHint={q ? 'Clear the search to see every submission.' : 'Use Open Module on a card above to file one.'}
                  />

                  <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-subtle btn-sm" onClick={() => runExport('records', 'pdf')}>
                      <FileText size={13} style={{ marginRight: 5 }} /> Export Records PDF
                    </button>
                    <button type="button" className="btn btn-subtle btn-sm" onClick={() => runExport('records', 'excel')}>
                      <FileSpreadsheet size={13} style={{ marginRight: 5 }} /> Export Records Excel
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'budget' && (
                <BudgetAnalysisTab
                  budget={budget}
                  financials={financials}
                  vendors={vendors}
                  onExportPdf={() => runExport('budget', 'pdf')}
                  onExportExcel={() => runExport('budget', 'excel')}
                />
              )}

              {activeTab === 'timeline' && (
                <TimelineAnalysisTab
                  schedule={schedule}
                  phases={phases}
                  departmentDelays={departmentDelays}
                  criticalDelays={criticalDelays}
                  onExportPdf={() => runExport('delay', 'pdf')}
                  onExportExcel={() => runExport('delay', 'excel')}
                />
              )}

              {activeTab === 'vendors' && (
                <VendorPerformanceTab
                  vendors={vendors}
                  onOpenRecord={openView}
                  onExportPdf={() => runExport('vendor', 'pdf')}
                  onExportExcel={() => runExport('vendor', 'excel')}
                />
              )}

              {activeTab === 'departments' && (
                <DepartmentPerformanceTab
                  departments={departments}
                  truncatedNote={tasksTruncated ? `Scorecards cover ${allTasks.length} of ${taskTotal} tasks — this project exceeds one page of the task API.` : null}
                  onOpenDepartment={(d) => navigate(`/projects/${id}/department-planning/${d.key}`)}
                  onExportPdf={() => runExport('department', 'pdf')}
                  onExportExcel={() => runExport('department', 'excel')}
                />
              )}

              {activeTab === 'lessons' && (
                <LessonsLearnedTab
                  lessons={lessons}
                  onOpenRecord={openView}
                  onExportPdf={() => runExport('lessons', 'pdf')}
                  onExportExcel={() => runExport('lessons', 'excel')}
                />
              )}

              {activeTab === 'documents' && (
                <DocumentsTab
                  documents={documents}
                  archiveSummary={approvedOf(closureRecs, 'document_archive').map((r) => ({
                    id: r._id,
                    category: r.values?.document_category || 'Other',
                    count: num(r.values?.documents_count),
                    by: r.submittedBy?.name || '—',
                    at: r.approvedAt || r.createdAt,
                  }))}
                />
              )}

              {activeTab === 'approvals' && (
                <ApprovalsTab signOffs={signOffs} modules={modules} onOpenRecord={openView} />
              )}

              {activeTab === 'reports' && (
                <div className="col gap-3">
                  <ReportCenterTab
                    onOpenFullReport={openFullReport}
                    onExport={runExport}
                    onCertificate={printCertificate}
                    canCertify={isArchived}
                  />
                  <SectionCard title="Project Health Report" subtitle="The eight-axis score behind every report above">
                    <HealthReportPanel health={health} />
                  </SectionCard>
                </div>
              )}

              {activeTab === 'archive' && (
                <ArchivePanelTab
                  gates={archiveGates}
                  gatesLoading={gatesLoading}
                  isArchived={isArchived}
                  project={project}
                  canArchive={canArchive}
                  archiving={archiveProject.isPending}
                  archiveError={archiveError}
                  remarks={archiveRemarks}
                  onRemarksChange={setArchiveRemarks}
                  onArchive={doArchive}
                />
              )}

              {activeTab === 'audit' && (
                <AuditLogTab
                  trail={auditTrail}
                  onExportPdf={() => runExport('audit', 'pdf')}
                  onExportExcel={() => runExport('audit', 'excel')}
                />
              )}
            </>
          )}
        </div>
      </div>

      {activeForm && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={activeForm.type.masterDataSchema}
          recordNoun={activeForm.type.name}
          initialValues={activeForm.record?.values || null}
          submitLabel="Submit Record"
          saving={activeForm.record ? updateRecord.isPending : createRecord.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, closureRecs, activeForm.type.name) : null}
          activity={activeForm.readOnly ? (activities || []).filter((a) => a.meta?.recordId === String(activeForm.record?._id)) : null}
          onEdit={activeForm.readOnly && activeForm.record && activeForm.record.status !== 'approved' && !isArchived ? switchToEdit : null}
          onApprove={activeForm.readOnly && canDecide && !isArchived && activeForm.record?.status === 'submitted' ? () => doApprove(activeForm.record) : null}
          onReject={activeForm.readOnly && canDecide && !isArchived && activeForm.record?.status === 'submitted' ? () => setRejectTarget(activeForm.record) : null}
          decidePending={decide.isPending}
          onSaveDraft={({ values }) => saveRecord(values, 'draft')}
          onSubmit={({ values }) => saveRecord(values, 'submitted')}
        />
      )}

      <RejectDialog
        open={!!rejectTarget}
        title={`Reject ${rejectTarget ? rejectTarget.title : ''}`}
        onClose={() => setRejectTarget(null)}
        onConfirm={doReject}
        pending={decide.isPending}
        placeholder="Why is this record being rejected?"
      />
    </>
  );
}

export default ProjectClosurePage;
