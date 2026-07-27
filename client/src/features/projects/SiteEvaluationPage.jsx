import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, RotateCcw, Search, Download, Filter,
  ChevronLeft, ChevronRight, Building2,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { MarkDoneButton } from '../../components/ui/MarkDoneButton.jsx';
import { SectionCard, Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonTable } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate, useBoard,
  useStageRecords, useCompleteStage, useReopenStage, useRecordDecision,
} from '../../lib/queries.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDateTime, fromNow, fmtDate, fmtDateTimeLong } from '../../lib/format.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAuthStore } from '../../store/authStore.js';
import { RejectDialog } from './records/RejectDialog.jsx';
import { ApproveDialog } from './records/ApproveDialog.jsx';
import { propertyNo } from './records/recordUi.js';
import { computeScorecard, rankScorecards } from './records/scoring.js';
import { FilterPanel, DEFAULT_SE_FILTERS, activeSeFilterCount } from './comparison/FilterPanel.jsx';
import { scorecardsMatchingFilters } from './comparison/filterUtils.js';
import { PropertyAnalysisTable, MAX_COMPARE } from './comparison/PropertyAnalysisTable.jsx';
import { EvaluationKpis } from './comparison/EvaluationKpis.jsx';
import { ComparisonDrawer } from './comparison/ComparisonDrawer.jsx';
import { exportCsv } from './comparison/exportUtils.js';
import { InfoTile, tileGrid, ActivityList } from './StageOverviewParts.jsx';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';

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
  { key: 'roi', label: 'ROI (%)', get: (s) => s.roi ?? '' },
  { key: 'investment', label: 'Estimated Investment', get: (s) => s.investment ?? '' },
  { key: 'revenue', label: 'Monthly Revenue', get: (s) => s.monthlyRevenue ?? '' },
  { key: 'payback', label: 'Payback Period (mo)', get: (s) => s.paybackMonths ?? '' },
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

  const { data: project, isLoading } = useProject(id);
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
  const user = useAuthStore((s) => s.user);

  const canReopen = user?.role === 'admin' || user?.role === 'manager';
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [confirmDone, setConfirmDone] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [approveTarget, setApproveTarget] = useState(null);
  const [timelineTarget, setTimelineTarget] = useState(null);
  const [fullTimelineOpen, setFullTimelineOpen] = useState(false);
  const [seFilters, setSeFilters] = useState(DEFAULT_SE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [toast, setToast] = useState({ text: '', type: 'success' });

  useEffect(() => {
    if (!toast.text) return undefined;
    const t = setTimeout(() => setToast({ text: '', type: 'success' }), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (text, type = 'success') => setToast({ text, type });
  const apiErrorMessage = (err, fallback) => err?.response?.data?.message || fallback;

  const p2AssessmentTypes = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const assessmentTypeKeys = useMemo(
    () => (p2AssessmentTypes.length ? p2AssessmentTypes.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational']),
    [p2AssessmentTypes],
  );

  const rankedScorecards = useMemo(() => {
    const raw = (properties || []).map((p) => computeScorecard(p, assessmentRecords || [], assessmentTypeKeys));
    return rankScorecards(raw);
  }, [properties, assessmentRecords, assessmentTypeKeys]);

  // Rejected properties are NOT carried into Site Evaluation — a property that
  // was rejected in Property Identification (Phase 1) stays visible only there.
  // Phase 2 lists live (shortlisted) candidates only. The rejected count still
  // surfaces in the summary stats below, which read `rejectedProperties`
  // directly, so nothing is silently lost.
  const allScorecards = rankedScorecards;

  const scorecardByPropertyId = useMemo(
    () => new Map(allScorecards.map((s) => [String(s.property._id), s])),
    [allScorecards],
  );

  const cityOptions = useMemo(() => Array.from(new Set(allScorecards.map((s) => s.property.values?.city).filter(Boolean))).sort(), [allScorecards]);
  const localityOptions = useMemo(() => Array.from(new Set(allScorecards.map((s) => s.property.values?.locality).filter(Boolean))).sort(), [allScorecards]);

  const filteredScorecards = useMemo(() => scorecardsMatchingFilters(allScorecards, seFilters), [allScorecards, seFilters]);
  const filterCount = activeSeFilterCount(seFilters);

  // Comparison only makes sense among live (non-rejected) fully-evaluated candidates.
  const evaluatedScorecards = useMemo(
    () => filteredScorecards.filter((s) => s.isFullyApproved && s.property.status !== 'rejected'),
    [filteredScorecards],
  );

  // doneCountFor dynamically counts completed/submitted assessments (record existence)
  const doneCountFor = (propertyId) => {
    const sc = scorecardByPropertyId.get(String(propertyId));
    if (!sc) return 0;
    return Object.values(sc.sections).filter((sec) => !!sec.latestRecord).length;
  };

  const summaryStats = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let approved = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    let assessmentsDone = 0;

    for (const s of rankedScorecards) {
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
    const assessmentsTotal = rankedScorecards.length * assessmentTypeKeys.length;
    return {
      total: rankedScorecards.length,
      completed,
      inProgress,
      notStarted,
      approved,
      rejected: (rejectedProperties || []).length,
      // Decision-status counts for DecisionSummaryCards / ValidationPanel /
      // the Mark Done confirm recap — "pending" = still-shortlisted
      // properties with no final decision yet; "eligible" mirrors approved
      // since an Approved property is exactly what becomes Phase-3-eligible.
      pending: rankedScorecards.length - approved,
      eligible: approved,
      avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      assessmentsDone,
      assessmentsTotal,
      overallProgressPct: assessmentsTotal ? Math.round((assessmentsDone / assessmentsTotal) * 100) : 0,
    };
  }, [rankedScorecards, rejectedProperties, assessmentTypeKeys]);

  const toggleSelect = (propertyId) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(propertyId)) next.delete(propertyId);
    else if (next.size < MAX_COMPARE) next.add(propertyId);
    return next;
  });

  const selectedScorecards = useMemo(
    () => evaluatedScorecards.filter((s) => selectedIds.has(String(s.property._id))),
    [evaluatedScorecards, selectedIds],
  );

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

  if (isLoading || !project) {
    return (
      <>
        <Topbar title="Site Evaluation" />
        <div className="content"><SkPropertyIdentification /></div>
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
  const doneTasks = stageTasks.filter((t) => t.status === 'done').length;
  const progress = stageTasks.length ? Math.round((doneTasks / stageTasks.length) * 100) : 0;

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
                            title={isRejected ? 'Rejected in Property Identification — not carried forward to Site Evaluation' : undefined}
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
                                        <button type="button" className="btn btn-outline-success btn-sm" disabled={decideProperty.isPending || readOnly} onClick={() => setApproveTarget(p)}>Approve</button>
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

          {/* Property Analysis & Comparison — deeper work for reviewers, right
              under the properties table. */}
          <div style={{ order: 4 }}>
            <PropertyAnalysisTable
              scorecards={evaluatedScorecards}
              selectedIds={selectedIds}
              onToggle={toggleSelect}
              onCompareSelected={() => setCompareOpen(true)}
            />
          </div>

          {/* 5. Bottom split: Stage Overview (left) + Activity Timeline (right) */}
          <div className="se-bottom-grid" style={{ order: 6 }}>
            <SectionCard title="Stage Overview">
              <div style={tileGrid}>
                <InfoTile label="Status" value={meta.label} tone={meta.color} />
                <InfoTile label="Progress" value={`${progress}%`} />
                <InfoTile label="SLA" value={`${stage.slaDays || 0} days`} />
                <InfoTile label="Started" value={fmtDate(stage.startedAt)} />
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
              <ActivityList items={stageActivity} loading={activitiesLoading} />
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

      <ComparisonDrawer open={compareOpen} onClose={() => setCompareOpen(false)} scorecards={selectedScorecards} />

      {toast.text && (
        <div
          className="fade-in"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 100,
            background: 'var(--surface)',
            border: `1px solid ${toast.type === 'danger' ? 'var(--danger)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius)', padding: '12px 20px',
            boxShadow: 'var(--shadow-3)', display: 'flex', alignItems: 'center', gap: 10,
            maxWidth: 420,
          }}
        >
          <span className="badge-dot" style={{ background: toast.type === 'danger' ? 'var(--danger)' : '#10b981', width: 8, height: 8, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.5 }}>{toast.text}</span>
        </div>
      )}
    </>
  );
}

export default SiteEvaluationPage;
