import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, PieChart, CalendarCheck,
  CheckCircle2, XCircle, Clock, UserCog, Eye, FilePenLine, Circle,
  Wallet, Users, Landmark, PackageCheck, Archive, BookOpen, ClipboardCheck,
  FileText, FileSpreadsheet,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, ProgressRing } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate,
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision, useCompleteStage,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow, fmtDate } from '../../lib/format.js';
import { useAuthStore } from '../../store/authStore.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { approvedTypeCount, isTypeApproved, propertyNo, buildRecordMeta, matchesStatusFilter, submissionNoOf, remarksOf } from './records/recordUi.js';
import { exportXls, exportPdf } from './comparison/exportUtils.js';

/** Icon + accent color per module, keyed off its assessmentType key so a template reorder never desyncs the visuals. */
const MODULE_VISUALS = {
  budget_analysis: { Icon: Wallet, color: 'var(--pjc-purple)' },
  delay_analysis: { Icon: Clock, color: 'var(--pjc-orange)' },
  vendor_performance: { Icon: Users, color: 'var(--pjc-green)' },
  financial_closure: { Icon: Landmark, color: 'var(--pjc-blue)' },
  asset_handover: { Icon: PackageCheck, color: 'var(--pjc-purple)' },
  document_archive: { Icon: Archive, color: 'var(--pjc-orange)' },
  lessons_learned: { Icon: BookOpen, color: 'var(--pjc-green)' },
  project_sign_off: { Icon: ClipboardCheck, color: 'var(--pjc-teal)' },
};
const FALLBACK_VISUAL = { Icon: Circle, color: 'var(--pjc-gray)' };

/** One module card's own display status — same four-word vocabulary every module-based workspace page uses. */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: 'var(--pjc-gray)', soft: 'var(--surface-hover)' },
  in_progress: { label: 'In Progress', color: 'var(--pjc-blue)', soft: 'rgba(37,99,235,0.12)' },
  approved: { label: 'Completed', color: 'var(--pjc-green)', soft: 'rgba(34,197,94,0.12)' },
  rejected: { label: 'Rejected', color: 'var(--pjc-red)', soft: 'rgba(239,68,68,0.12)' },
};

function moduleStatusKey(type, records, propertyId) {
  if (isTypeApproved(records, propertyId, type)) return 'approved';
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  return 'in_progress';
}

/** The same module's latest *approved* record (or null) — used for facts that should only reflect a signed-off submission. */
function latestApprovedRecordOf(type, records, propertyId) {
  const approved = (records || []).filter(
    (r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key && r.status === 'approved',
  );
  return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
}

/** "done/total" boolean-checklist completion for a module's latest approved record, as a 0–100 percentage (or null if it has no checklist). */
function checklistPct(type, records, propertyId) {
  if (!type) return null;
  const boolFields = (type.masterDataSchema || []).filter((f) => f.type === 'boolean');
  if (!boolFields.length) return null;
  const record = latestApprovedRecordOf(type, records, propertyId);
  const done = record ? boolFields.filter((f) => record.values?.[f.key] === true).length : 0;
  return (done / boolFields.length) * 100;
}

/** Icon + color for one activity-timeline entry, read off its message text. */
function timelineMetaFor(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--pjc-red)' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--pjc-green)' };
  if (m.includes('submitted')) return { Icon: Clock, color: 'var(--pjc-orange)' };
  if (m.includes('assigned')) return { Icon: UserCog, color: 'var(--pjc-blue)' };
  if (m.includes('opened')) return { Icon: Eye, color: 'var(--text-subtle)' };
  if (m.includes('created') || m.includes('updated') || m.includes('draft')) return { Icon: FilePenLine, color: 'var(--pjc-blue)' };
  return { Icon: Circle, color: 'var(--text-subtle)' };
}

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

const fmtBudget = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));
const clamp = (n) => Math.max(0, Math.min(100, n));
const scoreTone = (score) => (score == null ? 'var(--pjc-gray)' : score >= 90 ? 'var(--pjc-green)' : score >= 75 ? 'var(--pjc-blue)' : score >= 60 ? 'var(--pjc-orange)' : 'var(--pjc-red)');
const performanceLabelOf = (score) => (score == null ? '—' : score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Average' : 'Needs Improvement');

/** One Project Closure Workspace card — colored icon, module name, status badge, short subtitle, and an "Open Module" button (pinned bottom) that always starts a brand-new submission. Simplified work-first: no record count. */
function ModuleCard({ type, statusKey, onOpenModule }) {
  const smeta = MODULE_STATUS_META[statusKey];
  const { Icon, color } = MODULE_VISUALS[type.key] || FALLBACK_VISUAL;
  return (
    <div className="card pc-module-card">
      <div className="pc-module-head">
        <span className="pjc-module-icon" style={{ background: color }}><Icon size={15} /></span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div><Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge></div>
      <span className="pc-module-desc">{type.subtitle}</span>
      <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
        <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onOpenModule}>
          Open Module
        </button>
      </div>
    </div>
  );
}

/** One ring in the Project Score Breakdown strip. */
function ScoreRing({ label, value }) {
  return (
    <div className="pjc-score-ring">
      <div className="pjc-score-ring-visual">
        <ProgressRing value={value ?? 0} size={56} stroke={5} color={scoreTone(value)} />
        <span className="pjc-score-ring-value">{value != null ? Math.round(value) : '—'}</span>
      </div>
      <span className="pjc-score-ring-label">{label}</span>
    </div>
  );
}

/**
 * Project Closure — Phase 10's dedicated workspace, the final stage of the
 * lifecycle. Same "no property picker" shape as every other module-based
 * phase page: it always resolves to the one property that's fully cleared
 * Store Launch (every one of p9's modules Approved) and loads its closure
 * workspace directly.
 *
 * Layout follows a specific enterprise reference: Project Summary + an
 * Overall Closure Progress/Project Status sidebar (75/25), a full-width
 * Project Closure Workspace row of eight modules, Project Closure Records +
 * Activity Timeline (75/25), then a Project Closure Analytics + Report panel
 * split (70/30) with a six-ring score breakdown. No manual "Mark Done" —
 * completing every module automatically completes the stage, same as Store
 * Launch.
 */
export function ProjectClosurePage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p10';

  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: launchRecords } = useStageRecords(id, 'p9');
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: closureRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAuthStore((s) => s.user);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [activeForm, setActiveForm] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const openLoggedRef = useRef(false);
  const autoCompletedRef = useRef(false);

  const launchTypes = template?.stages?.find((s) => s.key === 'p9')?.assessmentTypes || [];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Only properties whose every Store Launch module has at least one
  // Approved record ever qualify.
  const isReady = (propId) =>
    launchTypes.length > 0 && approvedTypeCount(launchRecords, propId, launchTypes) === launchTypes.length;
  const properties = (shortlisted || []).filter((p) => isReady(p._id));
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = (closureRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const steps = assessmentTypes.map((type) => {
    const statusKey = moduleStatusKey(type, closureRecords, propertyId);
    const recordCount = propertyRecords.filter((r) => r.assessmentType === type.key).length;
    return { type, statusKey, recordCount };
  });
  const doneCount = approvedTypeCount(closureRecords, propertyId, assessmentTypes);
  const rejectedModuleCount = steps.filter((s) => s.statusKey === 'rejected').length;
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const closureProgressPct = assessmentTypes.length ? Math.round((doneCount / assessmentTypes.length) * 100) : 0;

  const typeOf = (key) => assessmentTypes.find((t) => t.key === key) || null;
  const budgetType = typeOf('budget_analysis');
  const delayType = typeOf('delay_analysis');
  const assetType = typeOf('asset_handover');
  const documentType = typeOf('document_archive');
  const signOffType = typeOf('project_sign_off');

  const budgetApproved = budgetType ? latestApprovedRecordOf(budgetType, closureRecords, propertyId) : null;
  const delayApproved = delayType ? latestApprovedRecordOf(delayType, closureRecords, propertyId) : null;
  const signOffApproved = signOffType ? latestApprovedRecordOf(signOffType, closureRecords, propertyId) : null;

  const vendorApprovedRecords = propertyRecords.filter((r) => r.assessmentType === 'vendor_performance' && r.status === 'approved');
  const financialApprovedRecords = propertyRecords.filter((r) => r.assessmentType === 'financial_closure' && r.status === 'approved');
  const documentApprovedRecords = propertyRecords.filter((r) => r.assessmentType === 'document_archive' && r.status === 'approved');

  const plannedBudget = budgetApproved?.values?.planned_budget;
  const actualCost = budgetApproved?.values?.actual_cost;
  const budgetVariance = plannedBudget != null && actualCost != null ? plannedBudget - actualCost : null;
  const budgetVariancePct = budgetVariance != null && plannedBudget ? (budgetVariance / plannedBudget) * 100 : null;
  const budgetVarianceLabel = budgetVariance == null ? '—' : `${fmtBudget(budgetVariance)} (${budgetVariancePct.toFixed(2)}%)`;
  const budgetOverrunAmt = plannedBudget != null && actualCost != null ? Math.max(0, actualCost - plannedBudget) : null;
  const budgetOverrunPct = budgetOverrunAmt != null && plannedBudget ? (budgetOverrunAmt / plannedBudget) * 100 : null;
  const budgetOverrunLabel = budgetOverrunAmt == null ? '—' : `${fmtBudget(budgetOverrunAmt)} (${budgetOverrunPct.toFixed(2)}%)`;

  const plannedDuration = delayApproved?.values?.planned_duration_days;
  const actualDuration = delayApproved?.values?.actual_duration_days;
  const delayDays = plannedDuration != null && actualDuration != null ? actualDuration - plannedDuration : null;
  const delayDaysLabel = delayDays == null ? '—' : delayDays === 0 ? 'On Time' : `${delayDays > 0 ? '+' : ''}${delayDays} Days`;

  const vendorRatings = vendorApprovedRecords.map((r) => Number(r.values?.rating)).filter((n) => !Number.isNaN(n));
  const avgVendorRating = vendorRatings.length ? vendorRatings.reduce((a, b) => a + b, 0) / vendorRatings.length : null;
  const totalVendors = vendorApprovedRecords.length;

  const latestFinancial = financialApprovedRecords.length
    ? [...financialApprovedRecords].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0]
    : null;
  const pendingPayment = latestFinancial?.values?.pending_payment;

  const documentsArchived = documentApprovedRecords.reduce((sum, r) => sum + (Number(r.values?.documents_count) || 0), 0);

  const budgetScore = budgetVariancePct != null ? clamp(100 - Math.abs(budgetVariancePct)) : null;
  const timelineScore = delayDays != null ? clamp(100 - Math.abs(delayDays) * 2) : null;
  const vendorScore = avgVendorRating != null ? clamp((avgVendorRating / 5) * 100) : null;
  const executionScore = assessmentTypes.length ? clamp(closureProgressPct) : null;
  const assetChecklist = checklistPct(assetType, closureRecords, propertyId);
  const documentChecklist = checklistPct(documentType, closureRecords, propertyId);
  const signOffChecklist = checklistPct(signOffType, closureRecords, propertyId);
  const qualityInputs = [assetChecklist, documentChecklist].filter((v) => v != null);
  const qualityScore = qualityInputs.length ? clamp(qualityInputs.reduce((a, b) => a + b, 0) / qualityInputs.length) : null;
  const complianceInputs = [documentChecklist, signOffChecklist].filter((v) => v != null);
  const complianceScore = complianceInputs.length ? clamp(complianceInputs.reduce((a, b) => a + b, 0) / complianceInputs.length) : null;

  const scoreList = [budgetScore, timelineScore, vendorScore, executionScore, qualityScore, complianceScore].filter((v) => v != null);
  const overallScore = scoreList.length ? Math.round(scoreList.reduce((a, b) => a + b, 0) / scoreList.length) : null;
  const performanceLabel = performanceLabelOf(overallScore);

  // Project Creation / Store Launch facts for the Project Summary — same
  // latest-approved-record lookup every later phase page uses.
  const p4Records = (projectCreationRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const latestApprovedOfType = (recs, key) => {
    const approved = recs.filter((r) => r.assessmentType === key && r.status === 'approved');
    return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
  };
  const projectManager = latestApprovedOfType(p4Records, 'manager_assignment')?.values?.project_manager;

  const p9Records = (launchRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const goLiveApproved = latestApprovedOfType(p9Records, 'go_live_approval');
  const storeManager = goLiveApproved?.values?.store_manager;
  const openingDate = goLiveApproved?.values?.actual_opening_date;
  const closureDate = signOffApproved?.values?.sign_off_date;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  const projectStatusLabel = isCompleted ? 'Completed' : rejectedModuleCount > 0 ? 'Needs Attention' : doneCount > 0 ? 'In Progress' : 'Pending';
  const projectStatusColor = isCompleted ? 'var(--pjc-green)' : rejectedModuleCount > 0 ? 'var(--pjc-red)' : doneCount > 0 ? 'var(--pjc-blue)' : 'var(--pjc-gray)';
  const projectStatusSoft = isCompleted ? 'rgba(34,197,94,0.12)' : rejectedModuleCount > 0 ? 'rgba(239,68,68,0.12)' : doneCount > 0 ? 'rgba(37,99,235,0.12)' : 'var(--surface-hover)';

  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  useEffect(() => {
    if (autoCompletedRef.current || !stage || isCompleted) return;
    if (assessmentTypes.length > 0 && doneCount === assessmentTypes.length) {
      autoCompletedRef.current = true;
      completeStage.mutate(stageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, assessmentTypes.length, stage, isCompleted]);

  if (isLoading || !project) {
    return (<><Topbar title="Project Closure" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Project Closure</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Project Closure stage" hint="This project has no Project Closure stage." />
        </div>
      </>
    );
  }

  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const openNewSubmission = (type) => setActiveForm({ type, record: null, readOnly: false });
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

  const doApprove = (record) => {
    decide.mutate({ id: record._id, decision: 'approve' }, { onSuccess: () => closeForm() });
  };
  const openReject = (record) => setRejectTarget(record);
  const doReject = (reason) => {
    decide.mutate(
      { id: rejectTarget._id, decision: 'reject', reason },
      { onSuccess: () => { setRejectTarget(null); closeForm(); } },
    );
  };

  const reportRows = statusFilter ? allRecords.filter((r) => matchesStatusFilter(r, statusFilter)) : allRecords;
  const reportColumns = [
    { key: 'module', label: 'Module', get: (r) => assessmentTypes.find((t) => t.key === r.assessmentType)?.name || r.title },
    { key: 'submissionNo', label: 'Submission No.', get: (r) => `#${submissionNoOf(allRecords, r)}` },
    { key: 'submittedBy', label: 'Submitted By', get: (r) => r.submittedBy?.name || '—' },
    { key: 'submittedOn', label: 'Submitted On', get: (r) => (r.submittedAt ? fmtDate(r.submittedAt) : '—') },
    { key: 'reviewedBy', label: 'Reviewed By', get: (r) => r.decidedBy?.name || '—' },
    { key: 'approvedOn', label: 'Approved On', get: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : '—') },
    { key: 'status', label: 'Status', get: (r) => MODULE_STATUS_META[r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'in_progress'].label },
    { key: 'remarks', label: 'Remarks', get: (r) => remarksOf(r) || '—' },
  ];
  const reportTitle = `Project Closure Report — ${project.name}`;
  const reportFilenameBase = `project-closure-${project.code || id}`;
  const doPreview = () => exportPdf(reportTitle, reportRows, reportColumns);
  const doExportPdf = () => exportPdf(reportTitle, reportRows, reportColumns);
  const doExportExcel = () => exportXls(reportRows, reportColumns, `${reportFilenameBase}.xls`);

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/store-launch`)} aria-label="Back to Store Launch">
              <ArrowLeft size={16} />
            </button>
            {stage.name}
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
        actions={
          <Badge color={isCompleted ? 'var(--pjc-green)' : 'var(--pjc-orange)'} soft={isCompleted ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)'} dot>
            {isCompleted ? 'Project Completed' : 'Closure In Progress'}
          </Badge>
        }
      />
      <div className="content page-compact project-closure-page">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Project Summary">
              <div className="pjc-summary-row1"><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="Project Summary">
              <EmptyState
                icon={ClipboardList}
                title="This property is not yet eligible for Project Closure."
                hint="Complete every Store Launch module before starting Project Closure."
              />
            </SectionCard>
          ) : (
            <>
              {/* Top: Project Summary (75%) / Overall Closure Progress + Project Status (25%).
                  Reordered below the work (order 3) and the summary collapsed by
                  default — a doer opens the phase to act, not to read a dashboard. */}
              <div className="pjc-top-grid" style={{ order: 3 }}>
                <SectionCard title="Project Summary" collapsible defaultCollapsed>
                  <div className="col gap-3">
                    <div className="pjc-summary-row1">
                      <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                      <InfoTile label="Property Name" value={property.title} />
                      <InfoTile label="Project Name" value={project.name} />
                      <InfoTile label="Store Code" value={project.code} />
                      <InfoTile label="City" value={property.values?.city} />
                      <InfoTile label="Locality" value={property.values?.locality} />
                      <InfoTile label="Commercial Type" value={property.values?.commercial_type} />
                    </div>
                    <div className="pjc-summary-row2">
                      <InfoTile label="Project Manager" value={projectManager || '—'} />
                      <InfoTile label="Store Manager" value={storeManager || '—'} />
                      <InfoTile label="Opening Date" value={openingDate ? fmtDate(openingDate) : '—'} />
                      <InfoTile label="Closure Date" value={closureDate ? fmtDate(closureDate) : '—'} />
                      <div className="col gap-1">
                        <span className="tiny subtle upper">Project Status</span>
                        <div><Badge color={projectStatusColor} soft={projectStatusSoft} dot>{projectStatusLabel}</Badge></div>
                      </div>
                      <div className="col gap-1">
                        <span className="tiny subtle upper">Completion</span>
                        <ProgressBar value={closureProgressPct} height={7} gradient="var(--pjc-blue)" />
                        <span className="tiny muted">{closureProgressPct}%</span>
                      </div>
                    </div>
                    <div className="pjc-summary-row3">
                      <InfoTile label="Budget" value={fmtBudget(plannedBudget)} />
                      <InfoTile label="Actual Cost" value={fmtBudget(actualCost)} />
                      <InfoTile label="Budget Variance" value={budgetVarianceLabel} />
                      <InfoTile label="Execution Days" value={actualDuration != null ? `${actualDuration} Days` : '—'} />
                      <InfoTile label="Delay Days" value={delayDaysLabel} />
                      <InfoTile label="Overall Score" value={overallScore != null ? `${overallScore} / 100` : '—'} tone={scoreTone(overallScore)} />
                      <div className="col gap-1">
                        <span className="tiny subtle upper">Store Performance</span>
                        <div><Badge color={scoreTone(overallScore)} dot>{performanceLabel}</Badge></div>
                      </div>
                      <InfoTile label="Project Completion" value={`${closureProgressPct}%`} />
                    </div>
                  </div>
                </SectionCard>

                <div className="pjc-sidebar">
                  <div className="card pjc-progress-card">
                    <div className="pjc-progress-head">
                      <span className="pjc-progress-icon"><PieChart size={15} /></span>
                      <span className="pjc-progress-title">Overall Closure Progress</span>
                    </div>
                    <div className="col gap-1" style={{ alignItems: 'center' }}>
                      <span className="pjc-progress-value">{closureProgressPct}%</span>
                      <ProgressBar value={closureProgressPct} height={7} gradient="var(--pjc-blue)" />
                      <span className="pjc-progress-sub">{doneCount} / {assessmentTypes.length || 0} Completed</span>
                    </div>
                  </div>
                  <div className="card pjc-status-card">
                    <span className="pjc-status-icon-wrap"><CheckCircle2 size={18} /></span>
                    <div className="col gap-1">
                      <span className="pjc-status-title">{isCompleted ? 'Completed' : projectStatusLabel}</span>
                      <span className="pjc-status-sub">{isCompleted ? 'Closed Successfully' : 'Project closure in progress'}</span>
                      {isCompleted && (
                        <span className="pjc-status-date"><CalendarCheck size={12} /> {closureDate ? fmtDate(closureDate) : '—'}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Full-width Project Closure Workspace — the actual work, first. */}
              <SectionCard
                title="Project Closure Workspace"
                subtitle="Pick a module to fill and submit its record"
                bodyClass="card-body-compact"
                style={{ order: 1 }}
              >
                {assessmentTypes.length ? (
                  <div className="project-closure-grid">
                    {steps.map(({ type, statusKey }) => (
                      <ModuleCard
                        key={type.key}
                        type={type}
                        statusKey={statusKey}
                        onOpenModule={() => openNewSubmission(type)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No modules configured" hint="Add assessment types to the Project Closure stage in the template." />
                )}
              </SectionCard>

              {/* Project Closure Records (75%) / Activity Timeline (25%) — right under
                  the work (order 2) so a reviewer can open any filed row. Records +
                  Timeline stay coupled to preserve their 75/25 layout. */}
              <div className="pjc-bottom-grid" style={{ order: 2 }}>
                <RecordsTable
                  title="Project Closure Records"
                  typeColumnLabel="Module"
                  records={reportRows}
                  assessmentTypes={assessmentTypes}
                  canDecide={canDecide}
                  decidePending={decide.isPending}
                  onView={openView}
                  onApprove={doApprove}
                  onReject={openReject}
                  showReviewedBy
                  showApprovedOn
                  showAttachments
                  statusMetaFor={(record) => {
                    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                    return MODULE_STATUS_META[type ? moduleStatusKey(type, closureRecords, propertyId) : 'pending'];
                  }}
                  emptyTitle={statusFilter ? 'No records match this filter' : 'No records filed yet'}
                  emptyHint={statusFilter ? 'Clear the filter to see every record.' : 'Use Open Module on a card above to see it here.'}
                />

                <SectionCard title="Activity Timeline">
                  {activitiesLoading ? (
                    <SkeletonActivity rows={4} />
                  ) : propertyActivity.length ? (
                    <div className="col gap-3">
                      <div className="pc-timeline">
                        {propertyActivity.map((a, i) => {
                          const { Icon, color } = timelineMetaFor(a.message);
                          return (
                            <div key={a._id} className="pc-timeline-item">
                              <div className="pc-timeline-rail">
                                <span className="pc-timeline-icon" style={{ color }}>
                                  <Icon size={14} />
                                </span>
                                {i < propertyActivity.length - 1 && <span className="pc-timeline-rail-line" />}
                              </div>
                              <div className="pc-timeline-body">
                                <div className="sm" style={{ fontWeight: 600 }}>{a.message}</div>
                                <div className="tiny muted">{a.actor?.name || 'System'}</div>
                                <div className="tiny subtle">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" className="btn btn-subtle btn-sm" style={{ width: '100%' }} onClick={() => navigate(`/projects/${id}`)}>
                        View Full Timeline
                      </button>
                    </div>
                  ) : (
                    <div className="empty sm" style={{ padding: '16px 12px' }}>No activity yet</div>
                  )}
                </SectionCard>
              </div>

              {/* Project Closure Analytics (70%) / Project Closure Report (30%) —
                  heavy dashboard + report, moved last (order 7). */}
              <div className="pjc-analytics-grid" style={{ order: 7 }}>
                <SectionCard title="Project Closure Analytics">
                  <div className="col gap-3">
                    <div className="sl-analytics-row">
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Total Budget</span><span className="sl-analytics-value">{fmtBudget(plannedBudget)}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Actual Cost</span><span className="sl-analytics-value">{fmtBudget(actualCost)}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Budget Overrun</span><span className="sl-analytics-value" style={{ color: budgetOverrunAmt ? 'var(--pjc-red)' : 'var(--pjc-green)' }}>{budgetOverrunLabel}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Planned Duration</span><span className="sl-analytics-value">{plannedDuration != null ? `${plannedDuration} Days` : '—'}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Actual Duration</span><span className="sl-analytics-value">{actualDuration != null ? `${actualDuration} Days` : '—'}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Delay</span><span className="sl-analytics-value">{delayDaysLabel}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Total Vendors</span><span className="sl-analytics-value">{totalVendors}</span></div>
                    </div>
                    <div className="sl-analytics-row">
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Avg. Vendor Rating</span><span className="sl-analytics-value">{avgVendorRating != null ? `${avgVendorRating.toFixed(1)} / 5` : '—'}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Pending Payments</span><span className="sl-analytics-value">{fmtBudget(pendingPayment)}</span></div>
                      <div className="sl-analytics-tile"><span className="sl-analytics-label">Documents Archived</span><span className="sl-analytics-value">{documentsArchived}</span></div>
                    </div>

                    <div className="pjc-score-panel">
                      <div className="col gap-2" style={{ width: '100%' }}>
                        <span className="sm" style={{ fontWeight: 650 }}>Project Score Breakdown</span>
                        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                          <div className="pjc-score-rings">
                            <ScoreRing label="Budget Score" value={budgetScore} />
                            <ScoreRing label="Timeline Score" value={timelineScore} />
                            <ScoreRing label="Vendor Score" value={vendorScore} />
                            <ScoreRing label="Execution Score" value={executionScore} />
                            <ScoreRing label="Quality Score" value={qualityScore} />
                            <ScoreRing label="Compliance Score" value={complianceScore} />
                          </div>
                          <div className="pjc-overall-score">
                            <ProgressRing value={overallScore ?? 0} size={72} stroke={6} color={scoreTone(overallScore)} />
                            <div className="col gap-1" style={{ alignItems: 'center' }}>
                              <span className="pjc-overall-score-value">{overallScore != null ? `${overallScore} / 100` : '—'}</span>
                              <span className="pjc-overall-score-label">{performanceLabel}</span>
                              <span className="pjc-stars">{'★'.repeat(Math.round((overallScore || 0) / 20))}{'☆'.repeat(5 - Math.round((overallScore || 0) / 20))}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Project Closure Report">
                  <div className="col gap-3">
                    <p className="sm muted">Generate a complete project closure report with analysis and recommendations.</p>
                    <div className="pjc-report-actions">
                      <button type="button" className="btn btn-subtle" onClick={doPreview}><Eye size={14} /> Preview Report</button>
                      <button type="button" className="btn btn-outline-danger" onClick={doExportPdf}><FileText size={14} /> Export PDF</button>
                      <button type="button" className="btn btn-outline-success" onClick={doExportExcel}><FileSpreadsheet size={14} /> Export Excel</button>
                    </div>
                  </div>
                </SectionCard>
              </div>
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
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, allRecords, activeForm.type.name) : null}
          activity={activeForm.readOnly ? (activities || []).filter((a) => a.meta?.recordId === String(activeForm.record?._id)) : null}
          onEdit={activeForm.readOnly && activeForm.record && activeForm.record.status !== 'approved' ? switchToEdit : null}
          onApprove={activeForm.readOnly && canDecide && activeForm.record?.status === 'submitted' ? () => doApprove(activeForm.record) : null}
          onReject={activeForm.readOnly && canDecide && activeForm.record?.status === 'submitted' ? () => openReject(activeForm.record) : null}
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
