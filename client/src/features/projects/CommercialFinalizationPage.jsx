import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Plus, Play, FileText, ArrowRight, RotateCcw, FileDown,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { MarkDoneButton } from '../../components/ui/MarkDoneButton.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision,
} from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity, useCompleteStage, useReopenStage } from '../../app/api/projectsApi.js';
import { fmtDateTime, fmtDate } from '../../lib/format.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { ModuleKpiCards } from './records/ModuleKpiCards.jsx';
import { InfoTile, tileGrid, ActivityList } from './StageOverviewParts.jsx';
import { computeScorecard } from './records/scoring.js';
import { isTypeApproved, propertyNo, matchesStatusFilter, subItemProgress } from './records/recordUi.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';
import { can } from '../../lib/roles.js';

/** One accent color per module card — drawn from existing theme tokens so both light/dark themes stay consistent; no new colors invented. */
const MODULE_ACCENTS = ['var(--teal-500)', 'var(--info)', 'var(--warning)', 'var(--chart-7)', 'var(--success)', 'var(--chart-8)'];

/**
 * A module card's own display status — a finer 5-tier read (Pending/In
 * Progress/In Review/Approved/Rejected) than the 3-tier status the shared
 * RecordsTable normally shows. "Approved" wins once the type has ever been
 * approved (see isTypeApproved) even if a newer resubmission is mid-flight;
 * otherwise it reflects the latest record's own status.
 */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: '#7c7784', soft: 'var(--surface-hover)' },
  in_progress: { label: 'In Progress', color: 'var(--info)', soft: 'var(--info-soft)' },
  in_review: { label: 'In Review', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  approved: { label: 'Approved', color: 'var(--success)', soft: 'var(--success-soft)' },
  rejected: { label: 'Rejected', color: 'var(--danger)', soft: 'var(--danger-soft)' },
};

/** Progress-bar percent per module statusKey — a simple, consistent visual even for module types with no finer-grained progress signal. */
const PROGRESS_PCT = { pending: 0, in_progress: 30, in_review: 65, approved: 100, rejected: 45 };

function moduleStatusKey(type, records, propertyId) {
  if (isTypeApproved(records, propertyId, type)) return 'approved';
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  if (latest.status === 'submitted') return 'in_review';
  return 'in_progress'; // draft
}

/**
 * One Commercial Finalization Workspace card. Action button is state-
 * dependent, mirroring records/AssessmentCard.jsx's own New/Continue/View
 * Report branching for the four single-record modules (LOI, Lease, Legal,
 * Deposit). The two `subKeyField` modules (NOC Management, Commercial
 * Approvals) can have several sub-items — 7 NOC types, 5 approval levels —
 * concurrently at different states, so one card can't collapse that into a
 * single button state: it always offers New Submission (add another
 * sub-item) plus View Report once at least one sub-item has been filed,
 * with `subItemProgress` ("5/7 Approved") standing in for the progress bar.
 */
function ModuleCard({ index, type, record, statusKey, submissionCount, requiredSubItems, onNewSubmission, onContinue, onViewReport, readOnly }) {
  const smeta = MODULE_STATUS_META[statusKey];
  const isDraft = record?.status === 'draft';
  const isSubKey = !!type.subKeyField;
  const progressLabel = isSubKey && requiredSubItems ? requiredSubItems : null;
  const progressPct = isSubKey && requiredSubItems
    ? Math.round((Number(requiredSubItems.split('/')[0]) / Number(requiredSubItems.split('/')[1] || 1)) * 100)
    : PROGRESS_PCT[statusKey] ?? 0;

  return (
    <div className="card pc-module-card">
      <div className="pc-module-head">
        <span className="pc-module-num" style={{ background: MODULE_ACCENTS[index % MODULE_ACCENTS.length] }}>{index + 1}</span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge>
        {progressLabel && <span className="tiny muted">{progressLabel}</span>}
      </div>
      <span className="pc-module-desc">{type.subtitle}</span>
      <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
        {isSubKey ? (
          <>
            <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onNewSubmission} disabled={readOnly}>
              <Plus size={14} /> New Submission
            </button>
            {submissionCount > 0 && (
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={onViewReport}>
                <FileText size={13} /> View Report
              </button>
            )}
          </>
        ) : !record ? (
          <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onNewSubmission} disabled={readOnly}>
            <Plus size={14} /> New Submission
          </button>
        ) : isDraft ? (
          <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onContinue} disabled={readOnly}>
            <Play size={13} /> Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onViewReport}>
            <FileText size={13} /> View Report <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Commercial Finalization — single-page workspace: the workflow always
 * resolves to the one Approved-from-Site-Evaluation property (no picker)
 * and loads its workspace directly. Mirrors Site Evaluation's enterprise
 * pattern: dedicated report pages per module (never modals — see
 * CommercialRecordReportPage.jsx / CommercialModuleChecklistPage.jsx), a
 * manual validated Mark Done (not auto-complete), Stage Overview + Activity
 * Timeline, About Phase Completion, and Phase Workflow Progress.
 */
export function CommercialFinalizationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: project, isLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p3';

  // Base pool: every shortlisted property, same as every earlier stage.
  // Narrowed below to only the one Approved on Site Evaluation.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: siteEvalRecords } = useStageRecords(id, 'p2');
  const { data: assessmentRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createAssessment = useCreateRecord(id, stageKey);
  const updateAssessment = useUpdateRecord(id, stageKey);
  const decideAssessment = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  const reopenStage = useReopenStage(id);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);
  const canReopen = can.decide(user?.role);

  const [activeForm, setActiveForm] = useState(null); // { type, record } | null
  const [statusFilter, setStatusFilter] = useState(null); // KPI card click narrows the Records table below
  const [confirmDone, setConfirmDone] = useState(false);
  const openLoggedRef = useRef(false);

  const siteEvalTypes = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const siteEvalTypeKeys = siteEvalTypes.length
    ? siteEvalTypes.map((t) => t.key)
    : ['feasibility', 'financial', 'technical', 'operational'];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Eligible for Commercial Finalization = Approved on the Site Evaluation
  // dashboard (`stageApproved`), not "every section individually approved".
  const properties = (shortlisted || [])
    .map((p) => computeScorecard(p, siteEvalRecords || [], siteEvalTypeKeys))
    .filter((s) => s.stageApproved)
    .map((s) => s.property);
  // The single property this page ever works on — no picker, no route param.
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = useMemo(
    () => (assessmentRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId)),
    [assessmentRecords, propertyId],
  );
  const steps = assessmentTypes.map((type, index) => {
    const typeRecords = propertyRecords.filter((r) => r.assessmentType === type.key);
    const sorted = [...typeRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return {
      type,
      index,
      record: sorted[0] || null,
      submissionCount: typeRecords.length,
      statusKey: moduleStatusKey(type, propertyRecords, propertyId),
      done: isTypeApproved(propertyRecords, propertyId, type),
      requiredSubItems: type.subKeyField ? subItemProgress(propertyRecords, propertyId, type) : null,
    };
  });
  const doneCount = steps.filter((s) => s.done).length;
  // NOC Management & Commercial Approvals (the multi-sub-item `subKeyField`
  // modules) are OPTIONAL for phase completion — filling them is welcome but
  // not required. Only the single-record modules (LOI, Lease, Legal, Deposit)
  // are mandatory to Mark Done. Phase 4's eligibility filter is relaxed to
  // match (see ProjectCreationPage.isCommerciallyFinalized).
  const mandatorySteps = steps.filter((s) => !s.type.subKeyField);
  const mandatoryDone = mandatorySteps.filter((s) => s.done).length;
  const allMandatoryDone = mandatorySteps.length > 0 && mandatoryDone === mandatorySteps.length;
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const overallPct = assessmentTypes.length ? Math.round((doneCount / assessmentTypes.length) * 100) : 0;

  const scorecard = useMemo(
    () => (property ? computeScorecard(property, siteEvalRecords || [], siteEvalTypeKeys) : null),
    [property, siteEvalRecords, siteEvalTypeKeys],
  );
  const lastEvalApproval = scorecard
    ? Object.values(scorecard.sections)
        .map((s) => s.approvedRecord)
        .filter(Boolean)
        .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0]
    : null;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';
  const meta = STAGE_STATUS_META[stage?.status] || { label: stage?.status, color: '#7c7784' };

  // "Property opened" is logged once — the very first time this workspace is
  // visited for a property that has no commercial records yet.
  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  const openEditFor = (rec) => {
    const type = assessmentTypes.find((t) => t.key === rec.assessmentType);
    setActiveForm({ type, record: rec });
  };

  // A record report page's "Edit" button navigates back here with the
  // record id in location.state (same pattern PropertyEvaluationPage.jsx
  // already uses) — pick it up and open the edit form.
  useEffect(() => {
    if (recordsLoading) return;
    const editId = location.state?.editRecordId;
    if (editId) {
      const rec = propertyRecords.find((r) => String(r._id) === String(editId));
      if (rec) {
        openEditFor(rec);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, propertyRecords, location.state]);

  if (isLoading || !project) {
    return (<><Topbar title="Commercial Finalization" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Commercial Finalization</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Commercial Finalization stage" hint="This project has no Commercial Finalization stage." />
        </div>
      </>
    );
  }

  const commStatusKey = property ? (allMandatoryDone ? 'approved' : doneCount === 0 ? 'pending' : 'in_progress') : 'pending';
  const commMeta = MODULE_STATUS_META[commStatusKey];

  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Individual module completion ≠ phase completion — every module must be
  // Approved (matching exactly what Phase 4's own eligibility filter
  // requires) before Mark Done enables.
  const validationRules = [
    {
      label: `Required modules completed & approved — ${mandatoryDone}/${mandatorySteps.length} (LOI, Lease, Legal, Deposit). NOC Management & Commercial Approvals are optional.`,
      satisfied: allMandatoryDone,
    },
  ];
  const allValidationSatisfied = validationRules.every((r) => r.satisfied);
  const canMarkDone = allValidationSatisfied;
  const pendingModules = assessmentTypes.length - doneCount;

  const openStep = (index) => {
    const { type } = steps[index];
    setActiveForm({ type, record: null });
  };
  const openView = (record) => navigate(`/projects/${id}/commercial-finalization/record/${record._id}`);
  const openModuleChecklist = (type) => navigate(`/projects/${id}/commercial-finalization/module/${type.key}?propertyId=${propertyId}`);
  const openCompleteReport = () => navigate(`/projects/${id}/commercial-finalization/report?propertyId=${propertyId}`);
  const closeForm = () => setActiveForm(null);

  const saveAssessment = async (values, status) => {
    const { type, record } = activeForm;
    if (record && record.status !== 'approved') {
      await updateAssessment.mutateAsync({ id: record._id, values, status });
    } else {
      await createAssessment.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    }
    closeForm();
  };

  /** Inline status change from the records table (RecordsTable → StatusDropdown).
   * `verb` is already the decision verb the API expects — see DECISION_MAP in
   * record.service.js — so this just forwards it with any reject reason. */
  const onRecordDecide = (record, verb, extra = {}) =>
    decideAssessment.mutate({ id: record._id, decision: verb, reason: extra.reason, remarks: extra.remarks });

  const confirmMarkDone = () => completeStage.mutate(stageKey, { onSuccess: () => setConfirmDone(false) });

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
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="content-narrow col gap-3 fade-in">

          {propertiesLoading || templateLoading ? (
            <SectionCard title="1. Property Summary">
              <div style={tileGrid}><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="1. Property Summary">
              <EmptyState
                icon={ClipboardList}
                title="No eligible properties yet"
                hint="Complete Site Evaluation before starting Commercial Finalization."
              />
            </SectionCard>
          ) : (
            <>
              {/* Property Summary — collapsed by default and placed below the
                  work: a doer opens the phase to act, not to read a dashboard.
                  Context stays one click away. */}
              <SectionCard title="Property Summary" collapsible defaultCollapsed style={{ order: 4 }}>
                <div className="col gap-4">
                  <div style={tileGrid}>
                    <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                    <InfoTile label="Property Name" value={property.title} />
                    <InfoTile label="City" value={property.values?.city} />
                    <InfoTile label="Locality" value={property.values?.locality} />
                    <InfoTile
                      label="Overall Site Evaluation Score"
                      value={scorecard?.overallScore != null ? (
                        <Badge color="var(--success)" soft="var(--success-soft)">{scorecard.overallScore}/100</Badge>
                      ) : '—'}
                    />
                    <InfoTile label="Approved Date" value={lastEvalApproval ? fmtDate(lastEvalApproval.approvedAt) : '—'} />
                    <InfoTile label="Evaluation Completed By" value={lastEvalApproval?.approvedBy?.name || '—'} />
                  </div>
                  <div className="divider" />
                  <div className="row gap-5 wrap" style={{ alignItems: 'center' }}>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Current Commercial Status</span>
                      <Badge color={commMeta.color} soft={commMeta.soft} dot>{commMeta.label}</Badge>
                    </div>
                    <div className="col gap-1 grow" style={{ minWidth: 220 }}>
                      <span className="tiny subtle upper">Overall Commercial Progress</span>
                      <ProgressBar value={overallPct} height={7} />
                      <span className="tiny muted">{overallPct}% Completed</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <div style={{ order: 6 }}>
                <ModuleKpiCards
                  steps={steps}
                  doneCount={doneCount}
                  total={assessmentTypes.length}
                  activeFilter={statusFilter}
                  onFilterClick={(k) => setStatusFilter((f) => (k === 'all' || f === k ? null : k))}
                />
              </div>

              {/* The actual work, first. Six modules on a fixed 3-column grid
                  so both rows are always full — see the grid rule for why
                  auto-fit was wrong here. */}
              {/* Titled "Modules", not "Commercial Finalization Workspace" —
                  the Topbar already says which phase this is, and repeating it
                  a line later spends the reader's attention on nothing. The
                  subtitle now carries progress instead. */}
              <SectionCard
                title="Modules"
                subtitle={`Fill and submit each one · ${doneCount} of ${assessmentTypes.length} approved`}
                bodyClass="card-body-compact"
                style={{ order: 2 }}
                action={
                  <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-subtle btn-sm" onClick={openCompleteReport}>
                      <FileDown size={14} /> View Complete Report
                    </button>
                    {isCompleted ? (
                      canReopen && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => reopenStage.mutate(stageKey)}
                          disabled={reopenStage.isPending || readOnly}
                        >
                          <RotateCcw size={14} /> Reopen Stage
                        </button>
                      )
                    ) : (
                      <MarkDoneButton
                        onClick={() => setConfirmDone(true)}
                        disabled={!canMarkDone || readOnly}
                        disabledTitle="Complete & approve the required modules (LOI, Lease, Legal, Deposit) first. NOC Management & Commercial Approvals are optional."
                      />
                    )}
                  </div>
                }
              >
                {assessmentTypes.length ? (
                  <div className="commercial-finalization-grid">
                    {steps.map(({ type, index, record, submissionCount, statusKey, requiredSubItems }) => (
                      <ModuleCard
                        key={type.key}
                        index={index}
                        type={type}
                        record={record}
                        statusKey={statusKey}
                        submissionCount={submissionCount}
                        requiredSubItems={requiredSubItems}
                        onNewSubmission={() => openStep(index)}
                        onContinue={() => openEditFor(record)}
                        onViewReport={() => (type.subKeyField ? openModuleChecklist(type) : openView(record))}
                        readOnly={readOnly}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No workflows configured" hint="Add assessment types to the Commercial Finalization stage in the template." />
                )}
              </SectionCard>

              {/* Commercial Records — full submission history, right under the
                  work so a reviewer can open any filed row to assess it. */}
              <div style={{ order: 3 }}>
              <RecordsTable
                title="Commercial Records"
                typeColumnLabel="Module"
                records={statusFilter ? allRecords.filter((r) => matchesStatusFilter(r, statusFilter)) : allRecords}
                assessmentTypes={assessmentTypes}
                canDecide={canDecide}
                decidePending={decideAssessment.isPending}
                onDecide={onRecordDecide}
                onView={openView}
                statusMetaFor={(record) => {
                  const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                  return MODULE_STATUS_META[type ? moduleStatusKey(type, propertyRecords, propertyId) : 'pending']
                    || (record.status === 'approved' ? MODULE_STATUS_META.approved
                      : record.status === 'rejected' ? MODULE_STATUS_META.rejected
                      : record.status === 'submitted' ? MODULE_STATUS_META.in_review
                      : MODULE_STATUS_META.in_progress);
                }}
                emptyTitle={statusFilter ? 'No records match this filter' : 'No records filed yet'}
                emptyHint={statusFilter ? 'Click the active KPI card again to clear the filter.' : 'Click New Submission above to file the first record.'}
              />
              </div>

              {/* Stage Overview (left) + Activity Timeline (right) — same pattern as Site Evaluation. */}
              <div className="se-bottom-grid" style={{ order: 7 }}>
                <SectionCard title="Stage Overview">
                  <div style={tileGrid}>
                    <InfoTile label="Status" value={meta.label} tone={meta.color} />
                    <InfoTile label="Progress" value={`${overallPct}%`} />
                    {stage.completedBy && <InfoTile label="Completed By" value={stage.completedBy.name} />}
                    {stage.completedAt && <InfoTile label="Completed At" value={fmtDateTime(stage.completedAt)} tone={isCompleted ? 'var(--success)' : undefined} />}
                    <InfoTile label="Completion Date" value={stage.completedAt ? fmtDate(stage.completedAt) : '—'} />
                  </div>
                </SectionCard>
                <SectionCard title="Activity Timeline">
                  <div style={{ maxHeight: 170, overflowY: 'auto' }}>
                    <ActivityList items={propertyActivity} loading={activitiesLoading} />
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
          saving={activeForm.record ? updateAssessment.isPending : createAssessment.isPending}
          loading={templateLoading}
          onSaveDraft={({ values }) => saveAssessment(values, 'draft')}
          onSubmit={({ values }) => saveAssessment(values, 'submitted')}
        />
      )}

      {confirmDone && (
        <Modal
          open
          onClose={() => setConfirmDone(false)}
          title="Complete Commercial Finalization?"
          width={480}
          footer={
            <div className="row gap-2">
              <button type="button" className="btn btn-subtle" onClick={() => setConfirmDone(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmMarkDone} disabled={completeStage.isPending || readOnly}>
                {completeStage.isPending ? <span className="spinner" /> : 'Mark Done'}
              </button>
            </div>
          }
        >
          <div className="col gap-3">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div className="col gap-1">
                <span className="tiny subtle upper">Completed Modules</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--success)' }}>{doneCount}</span>
              </div>
              <div className="col gap-1">
                <span className="tiny subtle upper">Pending Modules</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--warning)' }}>{pendingModules}</span>
              </div>
              <div className="col gap-1">
                <span className="tiny subtle upper">Approved Modules</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--info)' }}>{doneCount}</span>
              </div>
            </div>
            <p className="sm muted">Phase 3 will become read-only. Approved commercial records will move to Phase 4 – Project Creation.</p>
            {completeStage.isError && (
              <p className="sm" style={{ color: 'var(--danger)' }}>
                {completeStage.error?.response?.data?.message || 'Could not complete the stage.'}
              </p>
            )}
          </div>
        </Modal>
      )}

    </>
  );
}

export default CommercialFinalizationPage;
