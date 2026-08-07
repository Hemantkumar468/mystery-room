import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, RotateCcw, Search, Download, Filter,
  ChevronLeft, ChevronRight, Building2, AlertTriangle, Lock,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { MarkDoneButton } from '../../components/ui/MarkDoneButton.jsx';
import { SectionCard, Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonTable } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords, useRecordDecision } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity, useCompleteStage, useReopenStage } from '../../app/api/projectsApi.js';
import { useBoard } from '../../app/api/tasksApi.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDateTime, fromNow, fmtDate, fmtDateTimeLong } from '../../lib/format.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { toastPushed } from '../../app/slices/notificationSlice.js';
import { RejectDialog } from './records/RejectDialog.jsx';
import { ApproveDialog } from './records/ApproveDialog.jsx';
import { propertyNo } from './records/recordUi.js';
import { computeScorecard, rankScorecards } from './records/scoring.js';
import { FilterPanel, DEFAULT_SE_FILTERS, activeSeFilterCount } from './comparison/FilterPanel.jsx';
import { scorecardsMatchingFilters } from './comparison/filterUtils.js';
import { EvaluationKpis } from './comparison/EvaluationKpis.jsx';
import { exportCsv } from './comparison/exportUtils.js';
import { InfoTile, tileGrid, ActivityList } from './StageOverviewParts.jsx';
import { getStageAccess } from './stagesConfig.jsx';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';
import { can } from '../../lib/roles.js';

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const ASSIGNMENT_STATUS = {
  not_started: 'Pending assignment',
  in_progress: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
};

const ellipsisCell = (maxWidth) => ({
  display: 'block',
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** Short local clock label for the Updated On column, e.g. "10:31 AM". */
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

function paginationItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

/** Presentational-only property code — no schema change, just a stable "PROJ-CODE-P001" label for the table. */
const propertyCodeOf = (project, seq) => `${project?.code || 'PROP'}-P${String(seq ?? 0).padStart(3, '0')}`;

const EXPORT_COLUMNS = [
  { key: 'rank', label: 'Rank', get: (s) => s.rank ?? '' },
  { key: 'name', label: 'Property Name', get: (s) => s.property.title || '' },
  { key: 'city', label: 'City', get: (s) => s.property.values?.city || '' },
  { key: 'locality', label: 'Locality', get: (s) => s.property.values?.locality || '' },
  { key: 'feasibility', label: 'Feasibility Score', get: (s) => s.sections.feasibility?.percent ?? '' },
  { key: 'financial', label: 'Financial Score', get: (s) => s.sections.financial?.percent ?? '' },
  { key: 'technical', label: 'Technical Score', get: (s) => s.sections.technical?.percent ?? '' },
  { key: 'operational', label: 'Operational Score', get: (s) => s.sections.operational?.percent ?? '' },
  { key: 'overall', label: 'Overall Score', get: (s) => s.overallScore ?? '' },
  { key: 'roi', label: 'Return on Investment (%)', get: (s) => s.roi ?? '' },
  { key: 'investment', label: 'Estimated Investment', get: (s) => s.investment ?? '' },
  { key: 'revenue', label: 'Monthly Revenue', get: (s) => s.monthlyRevenue ?? '' },
  { key: 'payback', label: 'Investment Recovery Time (mo)', get: (s) => s.paybackMonths ?? '' },
  { key: 'risk', label: 'Risk Level', get: (s) => s.riskLevel },
  { key: 'recommendation', label: 'Recommendation', get: (s) => s.recommendation },
];

export function SiteEvaluationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const setSearch = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value); else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const { data: project, isLoading, isError, refetch } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: board } = useBoard(id);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stage = project?.stages?.find((s) => s.key === 'p2');
  const stageKey = 'p2';

  const { data: properties, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: rejectedProperties } = useStageRecords(id, 'p1', { status: 'rejected' });
  const { data: assessmentRecords } = useStageRecords(id, stageKey);

  const completeStage = useCompleteStage(id);
  const reopenStage = useReopenStage(id);
  const decideProperty = useRecordDecision(id, 'p1');
  const user = useAppSelector(selectCurrentUser);

  const canReopen = can.decide(user?.role);
  const canDecide = can.decide(user?.role);

  const [confirmDone, setConfirmDone] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [approveTarget, setApproveTarget] = useState(null);
  const [timelineTarget, setTimelineTarget] = useState(null);
  const [fullTimelineOpen, setFullTimelineOpen] = useState(false);
  const [seFilters, setSeFilters] = useState(DEFAULT_SE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const dispatch = useAppDispatch();
  // Toast display/auto-dismiss now lives in the global ToastHost.
  const showToast = (text, type = 'success') =>
    dispatch(toastPushed({ kind: type === 'danger' ? 'error' : type, message: text }));
  const apiErrorMessage = (err, fallback) => err?.response?.data?.message || fallback;

  const p2AssessmentTypes = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const assessmentTypeKeys = useMemo(
    () => (p2AssessmentTypes.length ? p2AssessmentTypes.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational']),
    [p2AssessmentTypes],
  );

  // A property rejected while still in Property Identification (Phase 1, e.g.
  // during initial shortlisting) never entered Site Evaluation and correctly
  // stays out of this page. A property rejected FROM Site Evaluation itself
  // (Approve/Reject on this page reuse the same p1 decide() call — see
  // record.service.js) already has assessment records here and should stay
  // visible, with its 4 assessments and rejection reason intact, instead of
  // silently vanishing from the list the moment it's rejected.
  const rejectedInP2 = useMemo(
    () => (rejectedProperties || []).filter((p) => (assessmentRecords || []).some((r) => String(r.parentRecordId) === String(p._id))),
    [rejectedProperties, assessmentRecords],
  );

  const rankedScorecards = useMemo(() => {
    const raw = [...(properties || []), ...rejectedInP2].map((p) => computeScorecard(p, assessmentRecords || [], assessmentTypeKeys));
    return rankScorecards(raw);
  }, [properties, rejectedInP2, assessmentRecords, assessmentTypeKeys]);

  const allScorecards = rankedScorecards;

  // Only one property may be Approved per project at Site Evaluation — every
  // phase after this one (Commercial Finalization onward) works on exactly
  // one property. Mirrors the server-side rule in record.service.js#decide.
  const approvedProperty = useMemo(() => allScorecards.find((s) => s.stageApproved) || null, [allScorecards]);

  const scorecardByPropertyId = useMemo(
    () => new Map(allScorecards.map((s) => [String(s.property._id), s])),
    [allScorecards],
  );

  const cityOptions = useMemo(() => Array.from(new Set(allScorecards.map((s) => s.property.values?.city).filter(Boolean))).sort(), [allScorecards]);
  const localityOptions = useMemo(() => Array.from(new Set(allScorecards.map((s) => s.property.values?.locality).filter(Boolean))).sort(), [allScorecards]);

  const filteredScorecards = useMemo(() => scorecardsMatchingFilters(allScorecards, seFilters), [allScorecards, seFilters]);
  const filterCount = activeSeFilterCount(seFilters);

  // doneCountFor dynamically counts completed/submitted assessments (record existence)
  const doneCountFor = (propertyId) => {
    const sc = scorecardByPropertyId.get(String(propertyId));
    if (!sc) return 0;
    return Object.values(sc.sections).filter((sec) => !!sec.latestRecord).length;
  };

  // Rejected-but-evaluated properties are now kept as rows for visibility
  // (see rejectedInP2 above), but they're no longer live candidates — the KPI
  // tiles (Shortlisted/Approved/Pending/Not Started/Avg Score) should keep
  // describing only the still-shortlisted pipeline, same as `shortlistedCount`
  // below already does for the section heading.
  const liveScorecards = useMemo(() => rankedScorecards.filter((s) => s.property.status !== 'rejected'), [rankedScorecards]);

  const summaryStats = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let approved = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    let assessmentsDone = 0;

    for (const s of liveScorecards) {
      // Completed is based on record existence for all 4 types
      const completedCount = Object.values(s.sections).filter((sec) => !!sec.latestRecord).length;
      assessmentsDone += completedCount;
      if (completedCount === assessmentTypeKeys.length) completed += 1;
      else if (completedCount > 0) inProgress += 1;
      else notStarted += 1;
      if (s.stageApproved) approved += 1;
      if (s.overallScore != null) {
        scoreSum += s.overallScore;
        scoreCount += 1;
      }
    }
    const assessmentsTotal = liveScorecards.length * assessmentTypeKeys.length;
    return {
      total: liveScorecards.length,
      completed,
      inProgress,
      notStarted,
      approved,
      rejected: (rejectedProperties || []).length,
      // Decision-status counts for DecisionSummaryCards / ValidationPanel /
      // the Mark Done confirm recap — "pending" = still-shortlisted
      // properties with no final decision yet; "eligible" mirrors approved
      // since an Approved property is exactly what becomes Phase-3-eligible.
      pending: liveScorecards.length - approved,
      eligible: approved,
      avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      assessmentsDone,
      assessmentsTotal,
      overallProgressPct: assessmentsTotal ? Math.round((assessmentsDone / assessmentsTotal) * 100) : 0,
    };
  }, [liveScorecards, rejectedProperties, assessmentTypeKeys]);

  const doApproveProperty = (remarks) => {
    const target = approveTarget;
    decideProperty.mutate(
      { id: target._id, decision: 'shortlist', remarks },
      {
        onSuccess: () => {
          setApproveTarget(null);
          showToast(`${target.title || 'Property'} approved.`);
        },
        onError: (err) => showToast(apiErrorMessage(err, 'Could not approve this property.'), 'danger'),
      },
    );
  };
  const doRejectProperty = (reason, remarks) => {
    const target = rejectTarget;
    decideProperty.mutate(
      { id: target._id, decision: 'reject', reason, remarks },
      {
        onSuccess: () => {
          setRejectTarget(null);
          showToast(`${target.title || 'Property'} rejected.`);
        },
        onError: (err) => showToast(apiErrorMessage(err, 'Could not reject this property.'), 'danger'),
      },
    );
  };

  const openKpiPage = (kpiKey) => navigate(`/projects/${id}/site-evaluation/${kpiKey}`);

  const exportReport = () => {
    exportCsv(filteredScorecards, EXPORT_COLUMNS, `site-evaluation-${project?.code || id}.csv`);
  };

  if (isLoading) {
    return (
      <>
        <Topbar title="Site Evaluation" />
        <div className="content"><SkPropertyIdentification /></div>
      </>
    );
  }

  if (isError || !project) {
    return (
      <>
        <Topbar title="Site Evaluation" />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><AlertTriangle size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>Couldn’t load this project</span>
                <span className="sm muted">The project service didn’t respond. Please try again.</span>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => refetch()}><RotateCcw size={15} style={{ marginRight: 6 }} /> Retry</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Site Evaluation is locked until Property Identification (p1) is
  // explicitly Marked Done (see stagesConfig.jsx#getStageAccess) — this
  // guard is what makes that lock real rather than cosmetic, since the
  // sidebar/stepper only hide the link but can't stop a direct URL hit.
  if (getStageAccess(project.stages, 'p2') === 'locked') {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Site Evaluation</span>} />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><Lock size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>Site Evaluation is locked</span>
                <span className="sm muted">Mark Property Identification as Done first — a property has to be shortlisted and that phase closed out before evaluation work can start.</span>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/projects/${id}/property-identification`)}
              >
                <ArrowLeft size={15} style={{ marginRight: 6 }} /> Go to Property Identification
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back"><ArrowLeft size={16} /></button>Site Evaluation</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Site Evaluation stage" hint="This project has no Site Evaluation stage." />
        </div>
      </>
    );
  }

  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  const meta = STAGE_STATUS_META[stage.status] || { label: stage.status, color: '#7c7784' };

  const stageTasks = (board?.columns || []).flatMap((c) => c.tasks || []).filter((t) => t.stageKey === stageKey);

  const firstTask = stageTasks[0];
  const primary = getEmployeeById(firstTask?.primaryAssignee);
  const backup = getEmployeeById(firstTask?.backupAssignee);
  const owner = project.owner;

  // Includes rejected properties too — a Reject decision moves the p1 record
  // out of the `status: 'shortlisted'` population `properties` queries, so
  // relying on `properties` alone would drop that record's own rejection
  // event from the timeline the moment it fires.
  const propertyIds = new Set([
    ...(properties || []).map((p) => String(p._id)),
    ...(rejectedProperties || []).map((p) => String(p._id)),
  ]);
  const stageActivity = (activities || []).filter(
    (a) => (a.entityType === 'record' || a.entityType === 'stage')
      && (a.meta?.stageKey === stageKey || (a.meta?.stageKey === 'p1' && propertyIds.has(a.meta?.recordId))),
  );

  const propertyTimeline = timelineTarget
    ? (activities || []).filter(
      (a) => a.meta?.recordId === String(timelineTarget._id) || a.meta?.parentRecordId === String(timelineTarget._id),
    )
    : [];

  const isCompleted = stage.status === 'completed';

  // Mark Done only requires at least one property to have been Approved —
  // properties still Pending don't block completion, they simply stay in
  // Phase 2 until reviewed later. Purely client-side; the backend's own
  // completeStage gate (>=1 record for a collection-mode stage) is unchanged.
  const canMarkDone = summaryStats.approved >= 1;

  const confirmMarkDone = () => completeStage.mutate(stageKey, { onSuccess: () => setConfirmDone(false) });
  const openProperty = (p) => navigate(`/projects/${id}/site-evaluation/${p._id}`);

  const q = search.trim().toLowerCase();
  const searchedScorecards = filteredScorecards.filter((s) => !q || [
    s.property.title, s.property.values?.city, s.property.values?.locality, propertyNo(s.property.seq),
  ].some((v) => (v || '').toLowerCase().includes(q)));
  const rows = searchedScorecards.map((s) => s.property);
  // Rejected properties still render as (locked) rows for audit, but they are
  // NOT carried forward — so the "Shortlisted Properties" heading counts only
  // live candidates, never rejected ones.
  const shortlistedCount = rows.filter((p) => p.status !== 'rejected').length;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageStart = page * pageSize;
  const pagedRows = rows.slice(pageStart, pageStart + pageSize);

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
      <div className="content">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="se-page se-page--tight-top fade-in col gap-4" style={{ gap: 14 }}>

          {/* 1. Page Header */}
          <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 12, order: 1 }}>
            <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
              <div className="input-icon-wrap" style={{ minWidth: 220 }}>
                <Search size={15} className="input-icon" />
                <input className="input" placeholder="Search properties, cities..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button type="button" className="btn btn-subtle btn-sm" onClick={exportReport}>
                <Download size={14} /> Export Report
              </button>
              {/* marginLeft:auto pins this to the right edge of whichever
                  wrapped line it ends up on — the row's own justify-content
                  only controls the last line's alignment when items wrap
                  onto their own line below Search/Export Report, which
                  otherwise left it stuck flush-left on narrow screens. */}
              <span style={{ marginLeft: 'auto' }}>
                {isCompleted ? (
                  canReopen && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => reopenStage.mutate(stageKey, {
                        onError: (err) => showToast(apiErrorMessage(err, 'Could not reopen this stage.'), 'danger'),
                      })}
                      disabled={reopenStage.isPending || readOnly}
                    >
                      <RotateCcw size={14} /> Reopen Stage
                    </button>
                  )
                ) : (
                  <MarkDoneButton
                    onClick={() => setConfirmDone(true)}
                    disabled={!canMarkDone || readOnly}
                    disabledTitle="At least one property must be Approved before completing this stage."
                  />
                )}
              </span>
            </div>
          </div>

          {/* Top KPI dashboard — five enterprise cards (Shortlisted / Approved /
              Pending Assessment / Not Started / Avg Score). Every number is
              derived from the same scorecards computed above; the cards reuse
              the page's existing KPI drill-down navigation. */}
          <div style={{ order: 2 }}>
            <EvaluationKpis stats={summaryStats} onCardClick={openKpiPage} />
          </div>

          {/* The work — properties to evaluate. */}
          <SectionCard
            style={{ order: 3 }}
            title={`Shortlisted Properties (${shortlistedCount})`}
            action={
              <button type="button" className={`btn btn-subtle btn-sm cal-filter-btn${filterCount ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}>
                <Filter size={14} /> Filters
                {filterCount > 0 && <span className="cal-filter-count">{filterCount}</span>}
              </button>
            }
          >
            {propertiesLoading ? (
              <SkeletonTable columns={['28%', '15%', '19%', '18%', '13%', '7%']} rows={5} />
            ) : pagedRows.length ? (
              <div className="col gap-2">
                <div className="se-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="table table-clickable" style={{ textAlign: 'left' }}>
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>Location</th>
                        <th>Evaluation Progress</th>
                        <th>Decision</th>
                        <th>Updated By</th>
                        <th>Updated On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((p) => {
                        const sc = scorecardByPropertyId.get(String(p._id));
                        const done = doneCountFor(p._id);
                        const thumbUrl = p.values?.documents?.find((d) => d.kind === 'image')?.url;
                        const isRejected = p.status === 'rejected';
                        const isApproved = !!sc?.stageApproved;
                        const viewReportBtn = (
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => navigate(`/projects/${id}/site-evaluation/report?propertyId=${p._id}`)}
                          >
                            📄 View Report
                          </button>
                        );

                        let evalLabel = 'Not Started';
                        let evalColor = '#7c7784';
                        if (done === assessmentTypes.length) {
                          evalLabel = 'Completed';
                          evalColor = 'var(--success)';
                        } else if (done > 0) {
                          evalLabel = 'In Progress';
                          evalColor = 'var(--warning)';
                        }

                        const pct = assessmentTypes.length ? Math.round((done / assessmentTypes.length) * 100) : 0;
                        const complete = done === assessmentTypes.length;
                        return (
                          <tr
                            key={p._id}
                            onClick={() => openProperty(p)}
                            title={isRejected ? `Rejected at Site Evaluation${p.rejectReason ? `: ${p.rejectReason}` : ''}` : undefined}
                            style={isRejected ? { opacity: 0.6 } : undefined}
                          >
                            {/* Property — thumbnail + name + code, one cell */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div className="row gap-2" style={{ alignItems: 'center' }}>
                                {thumbUrl ? (
                                  <img src={thumbUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', display: 'block', flexShrink: 0 }} />
                                ) : (
                                  <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-subtle)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                    <Building2 size={16} />
                                  </span>
                                )}
                                <div className="col" style={{ minWidth: 0 }}>
                                  <span style={{ fontWeight: 600, ...ellipsisCell(190) }} title={p.title || 'Untitled Property'}>{p.title || 'Untitled Property'}</span>
                                  <span className="mono tiny subtle">{propertyCodeOf(project, p.seq)}</span>
                                </div>
                              </div>
                            </td>

                            {/* Location — city + locality */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div className="col">
                                <span style={ellipsisCell(130)}>{p.values?.city || '—'}</span>
                                <span className="tiny muted" style={ellipsisCell(150)}>{p.values?.locality || '—'}</span>
                              </div>
                            </td>

                            {/* Evaluation — status + progress */}
                            <td style={{ whiteSpace: 'nowrap', minWidth: 140 }}>
                              <div className="col gap-1">
                                <Badge color={evalColor}>{evalLabel}</Badge>
                                <div className="se-progress-track">
                                  <div className="se-progress-fill" style={{ width: `${pct}%`, background: evalColor, transition: 'width 0.4s ease' }} />
                                </div>
                                <span className="tiny muted">{done}/{assessmentTypes.length} · {pct}%</span>
                              </div>
                            </td>

                            {/* Decision — status + the primary actions, compact */}
                            <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                              {isRejected ? (
                                <div className="col gap-1" style={{ alignItems: 'flex-start' }}>
                                  <Badge color="var(--danger)" dot>Rejected</Badge>
                                  <span className="tiny muted">by {p.rejectedBy?.name || '—'}</span>
                                  {p.rejectReason && (
                                    <span className="tiny" style={{ color: 'var(--danger)', whiteSpace: 'normal', maxWidth: 220 }}>
                                      {p.rejectReason}
                                    </span>
                                  )}
                                  {viewReportBtn}
                                </div>
                              ) : isApproved ? (
                                <div className="col gap-1" style={{ alignItems: 'flex-start' }}>
                                  <Badge color="var(--success)" dot>Approved</Badge>
                                  <span className="tiny muted">by {p.decidedBy?.name || '—'}</span>
                                  {viewReportBtn}
                                </div>
                              ) : complete ? (
                                <div className="col gap-1" style={{ alignItems: 'flex-start' }}>
                                  <Badge color="var(--warning)" dot>Pending review</Badge>
                                  <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
                                    {viewReportBtn}
                                    {canDecide && (
                                      <>
                                        <button
                                          type="button"
                                          className="btn btn-outline-success btn-sm"
                                          disabled={decideProperty.isPending || readOnly || !!approvedProperty}
                                          title={approvedProperty ? `"${approvedProperty.property.title || 'Another property'}" is already approved — only one property can be approved per project.` : undefined}
                                          onClick={() => setApproveTarget(p)}
                                        >
                                          Approve
                                        </button>
                                        <button type="button" className="btn btn-outline-danger btn-sm" disabled={decideProperty.isPending || readOnly} onClick={() => setRejectTarget(p)}>Reject</button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openProperty(p)}>
                                  {done > 0 ? 'Continue' : 'Begin'} Assessment
                                </button>
                              )}
                            </td>

                            {/* Updated By — who last touched this property record */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {p.updatedBy?.name ? (
                                <span className="row gap-2" style={{ alignItems: 'center' }}>
                                  <Avatar name={p.updatedBy.name} color={p.updatedBy.avatarColor} size={24} />
                                  <span style={ellipsisCell(120)}>{p.updatedBy.name}</span>
                                </span>
                              ) : <span className="tiny muted">—</span>}
                            </td>

                            {/* Updated On */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div className="col">
                                <span className="sm">{fmtDate(p.updatedAt)}</span>
                                <span className="tiny muted">{timeOf(p.updatedAt)}</span>
                              </div>
                            </td>

                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="row between wrap" style={{ alignItems: 'center', gap: 8 }}>
                  <span className="tiny muted">Showing {pageStart + 1} to {Math.min(pageStart + pageSize, rows.length)} of {rows.length} properties</span>
                  <div className="row gap-3" style={{ alignItems: 'center' }}>
                    <div className="row gap-2" style={{ alignItems: 'center' }}>
                      <span className="tiny muted">Rows per page</span>
                      <select
                        className="input"
                        style={{ width: 'auto' }}
                        value={pageSize}
                        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                      >
                        {ROWS_PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    {totalPages > 1 && (
                      <div className="row gap-1">
                        <button type="button" className="btn btn-ghost btn-icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                          <ChevronLeft size={14} />
                        </button>
                        {paginationItems(page + 1, totalPages).map((it, i) => (
                          it === '…' ? (
                            <span key={`gap-${i}`} className="tiny muted" style={{ padding: '0 4px' }}>…</span>
                          ) : (
                            <button
                              key={it}
                              type="button"
                              className={`btn btn-sm ${it === page + 1 ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ minWidth: 32, padding: '0 8px' }}
                              onClick={() => setPage(it - 1)}
                            >
                              {it}
                            </button>
                          )
                        ))}
                        <button type="button" className="btn btn-ghost btn-icon" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={ClipboardList}
                title={search ? 'No matches' : 'No shortlisted properties found.'}
                hint={search ? 'Try a different search or filter.' : 'Shortlist a property in Property Identification to begin its Site Evaluation.'}
                action={!search && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/projects/${id}/property-identification`)}>
                    Go to Property Identification
                  </button>
                )}
              />
            )}
          </SectionCard>

          <FilterPanel
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            cityOptions={cityOptions}
            localityOptions={localityOptions}
            value={seFilters}
            onApply={(next) => { setSeFilters(next); setFiltersOpen(false); setPage(0); }}
            onReset={() => { setSeFilters(DEFAULT_SE_FILTERS); setFiltersOpen(false); setPage(0); }}
          />

          {/* 5. Bottom split: Stage Overview (left) + Activity Timeline (right) */}
          <div className="se-bottom-grid" style={{ order: 6 }}>
            <SectionCard title="Stage Overview">
              <div style={tileGrid}>
                <InfoTile label="SLA" value={`${stage.slaDays || 0} days`} />
                <InfoTile label="Expected Completion" value={fmtDate(stage.plannedEnd)} />
                {stage.completedBy && <InfoTile label="Completed By" value={stage.completedBy.name} />}
                {stage.completedAt && <InfoTile label="Completed At" value={fmtDateTime(stage.completedAt)} tone={isCompleted ? 'var(--success)' : undefined} />}
                <InfoTile label="Primary Doer" value={primary?.name || '—'} />
                <InfoTile label="Backup Doer" value={backup?.name || '—'} />
                <InfoTile label="Assigned By" value={owner?.name || '—'} />
                <InfoTile label="Assignment Status" value={ASSIGNMENT_STATUS[stage.status] || '—'} tone={meta.color} />
              </div>
            </SectionCard>

            <SectionCard
              title="Activity Timeline"
              action={
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullTimelineOpen(true)}>
                  View Full Timeline
                </button>
              }
            >
              <div style={{ maxHeight: 170, overflowY: 'auto' }}>
                <ActivityList items={stageActivity} loading={activitiesLoading} />
              </div>
            </SectionCard>
          </div>

        </div>
      </div>

      {confirmDone && (
        <Modal
          open
          onClose={() => setConfirmDone(false)}
          title="Complete Phase 2 – Site Evaluation?"
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div className="col gap-1">
                <span className="tiny subtle upper">Approved</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--success)' }}>{summaryStats.approved}</span>
              </div>
              <div className="col gap-1">
                <span className="tiny subtle upper">Rejected</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--danger)' }}>{summaryStats.rejected}</span>
              </div>
              <div className="col gap-1">
                <span className="tiny subtle upper">Pending</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--warning)' }}>{summaryStats.pending}</span>
              </div>
              <div className="col gap-1">
                <span className="tiny subtle upper">Eligible for Phase 3</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--info)' }}>{summaryStats.eligible}</span>
              </div>
            </div>
            <p className="sm muted">
              Only approved properties will move to Phase 3. Pending properties will remain in Phase 2 until reviewed.
              This action locks Phase 2.
            </p>
            {completeStage.isError && (
              <p className="sm" style={{ color: 'var(--danger)' }}>
                {completeStage.error?.response?.data?.message || 'Could not complete the stage.'}
              </p>
            )}
          </div>
        </Modal>
      )}

      <RejectDialog
        open={!!rejectTarget}
        title={`Reject ${rejectTarget ? rejectTarget.title : ''}`}
        onClose={() => setRejectTarget(null)}
        onConfirm={doRejectProperty}
        pending={decideProperty.isPending}
        placeholder="Why is this property being rejected?"
      />

      <ApproveDialog
        open={!!approveTarget}
        title={`Approve ${approveTarget ? approveTarget.title : ''}`}
        onClose={() => setApproveTarget(null)}
        onConfirm={doApproveProperty}
        pending={decideProperty.isPending}
      />

      {timelineTarget && (
        <Modal
          open
          onClose={() => setTimelineTarget(null)}
          title={`Activity Timeline — ${timelineTarget.title || 'Property'}`}
          width={520}
        >
          <ActivityList items={propertyTimeline} loading={false} />
        </Modal>
      )}

      {fullTimelineOpen && (
        <Modal open onClose={() => setFullTimelineOpen(false)} title="Full Activity Timeline" width={560}>
          <ActivityList items={activities || []} loading={activitiesLoading} />
        </Modal>
      )}

    </>
  );
}

export default SiteEvaluationPage;
