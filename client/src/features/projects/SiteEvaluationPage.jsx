import { useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, RotateCcw, Search, Download, Filter,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, Badge, Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonTable, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate, useBoard,
  useStageRecords, useCompleteStage, useReopenStage, useRecordDecision,
} from '../../lib/queries.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDateTime, fromNow, fmtDate } from '../../lib/format.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAuthStore } from '../../store/authStore.js';
import { RejectDialog } from './records/RejectDialog.jsx';
import {
  computeScorecard, rankScorecards, assessmentStatusOf,
} from './records/scoring.js';
import { SummaryCards } from './comparison/SummaryCards.jsx';
import { RecommendedPropertyCard } from './comparison/RecommendedPropertyCard.jsx';
import { FilterPanel, DEFAULT_SE_FILTERS, activeSeFilterCount } from './comparison/FilterPanel.jsx';
import { PropertyAnalysisTable, MAX_COMPARE } from './comparison/PropertyAnalysisTable.jsx';
import { ComparisonDrawer } from './comparison/ComparisonDrawer.jsx';
import { exportCsv } from './comparison/exportUtils.js';

const ASSIGNMENT_STATUS = {
  not_started: 'Pending assignment',
  in_progress: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
};

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 100 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 500, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 'var(--space-3)' };

const ellipsisCell = (maxWidth) => ({
  display: 'block',
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const PAGE_SIZE = 5;

/** 1-based page numbers to render, with '…' gaps — e.g. [1,2,3,4,5,'…',26] on page 1 of 26. */
function paginationItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

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

/**
 * Site Evaluation home — a management decision dashboard, not just a Doer's
 * property list: KPI summary, an auto-selected Recommended Property, the
 * Shortlisted Properties table (with an inline Approve/Reject Decision and
 * a Score derived from the same scoring engine), and the full Property
 * Analysis & Comparison table with multi-select compare.
 * Opening a property (row click, same as before) still goes to the
 * dedicated PropertyEvaluationPage — nothing about that flow changed.
 */
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
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: board } = useBoard(id);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stage = project?.stages?.find((s) => s.key === 'p2');
  const stageKey = 'p2';

  // Eligible properties: only Phase 1 records already shortlisted — Site
  // Evaluation never creates properties of its own, and rejected properties
  // never reach this query at all. A second, lightweight query (status:
  // 'rejected') exists purely to count the Rejected KPI card — same
  // endpoint, same hook, just a different status filter.
  const { data: properties, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: rejectedProperties } = useStageRecords(id, 'p1', { status: 'rejected' });
  // Every Phase 2 assessment record for the project, used to derive each
  // property's per-step status and the Mark Done gate.
  const { data: assessmentRecords } = useStageRecords(id, stageKey);

  const completeStage = useCompleteStage(id);
  const reopenStage = useReopenStage(id);
  // Decision here acts on the property's own Phase-1 record — "Approve" is a
  // management sign-off re-affirming its shortlisted status (audit trail
  // only, via the same 'shortlist' decision Property Identification uses,
  // so the record never leaves the `status: 'shortlisted'` population every
  // downstream stage already queries by); "Reject" removes it from the
  // pipeline exactly like a Phase-1 rejection would. Reusing the one
  // generic decision endpoint — no new API, no schema change.
  const decideProperty = useRecordDecision(id, 'p1');
  const user = useAuthStore((s) => s.user);
  const canReopen = user?.role === 'admin' || user?.role === 'manager';
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [confirmDone, setConfirmDone] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [seFilters, setSeFilters] = useState(DEFAULT_SE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const [page, setPage] = useState(0);

  // Every property's weighted scorecard (Feasibility 25/Financial 35/
  // Technical 20/Operational 20) — computed once here from the same p2
  // records already fetched above, then reused for the Recommendation Score
  // column, the Recommended Property card and the Property Analysis table.
  // Only Approved assessment values ever contribute (see scoring.js), so a
  // property with an assessment still in draft/submitted just reads
  // "Pending" here.
  const p2AssessmentTypes = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const assessmentTypeKeys = useMemo(
    () => (p2AssessmentTypes.length ? p2AssessmentTypes.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational']),
    [p2AssessmentTypes],
  );
  const rankedScorecards = useMemo(() => {
    const raw = (properties || []).map((p) => computeScorecard(p, assessmentRecords || [], assessmentTypeKeys));
    return rankScorecards(raw);
  }, [properties, assessmentRecords, assessmentTypeKeys]);
  const scorecardByPropertyId = useMemo(
    () => new Map(rankedScorecards.map((s) => [String(s.property._id), s])),
    [rankedScorecards],
  );

  const summaryStats = useMemo(() => {
    let completed = 0;
    let approved = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    for (const s of rankedScorecards) {
      if (s.isFullyApproved) completed += 1;
      if (s.stageApproved) approved += 1;
      if (s.overallScore != null) { scoreSum += s.overallScore; scoreCount += 1; }
    }
    return {
      total: rankedScorecards.length,
      completed,
      approved,
      rejected: (rejectedProperties || []).length,
      avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
    };
  }, [rankedScorecards, rejectedProperties]);

  const cityOptions = useMemo(() => Array.from(new Set((properties || []).map((p) => p.values?.city).filter(Boolean))).sort(), [properties]);
  const localityOptions = useMemo(() => Array.from(new Set((properties || []).map((p) => p.values?.locality).filter(Boolean))).sort(), [properties]);

  const filteredScorecards = useMemo(() => scorecardsMatchingFilters(rankedScorecards, seFilters), [rankedScorecards, seFilters]);
  const filterCount = activeSeFilterCount(seFilters);

  const evaluatedScorecards = useMemo(() => filteredScorecards.filter((s) => s.isFullyApproved), [filteredScorecards]);

  const doneCountFor = (propertyId) => scorecardByPropertyId.get(String(propertyId))?.approvedCount ?? 0;

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

  const doApproveProperty = (p) => decideProperty.mutate({ id: p._id, decision: 'shortlist' });
  const doRejectProperty = (reason, remarks) => {
    decideProperty.mutate(
      { id: rejectTarget._id, decision: 'reject', reason, remarks },
      { onSuccess: () => setRejectTarget(null) },
    );
  };

  const openKpiPage = (kpiKey) => navigate(`/projects/${id}/site-evaluation/${kpiKey}`);

  const exportReport = () => {
    exportCsv(filteredScorecards, EXPORT_COLUMNS, `site-evaluation-${project?.code || id}.csv`);
  };

  if (isLoading || !project) {
    return (<><Topbar title="Site Evaluation" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Site Evaluation</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Site Evaluation stage" hint="This project has no Site Evaluation stage." />
        </div>
      </>
    );
  }

  // Every step is driven by the template's assessmentTypes — never a
  // hardcoded list, so a 5th assessment added later needs no component change.
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  const meta = STAGE_STATUS_META[stage.status] || { label: stage.status, color: '#7c7784' };

  const stageTasks = (board?.columns || []).flatMap((c) => c.tasks || []).filter((t) => t.stageKey === stageKey);
  const doneTasks = stageTasks.filter((t) => t.status === 'done').length;
  const progress = stageTasks.length ? Math.round((doneTasks / stageTasks.length) * 100) : 0;

  const firstTask = stageTasks[0];
  const primary = getEmployeeById(firstTask?.primaryAssignee);
  const backup = getEmployeeById(firstTask?.backupAssignee);
  const owner = project.owner;

  // This section's own activity — p2 assessment events, plus this page's own
  // Approve/Reject decisions on the p1 property record (those log against
  // stage p1, not p2, since they act on the Phase-1 record).
  const propertyIds = new Set((properties || []).map((p) => String(p._id)));
  const stageActivity = (activities || []).filter(
    (a) => (a.entityType === 'record' || a.entityType === 'stage')
      && (a.meta?.stageKey === stageKey || (a.meta?.stageKey === 'p1' && propertyIds.has(a.meta?.recordId))),
  );

  const isCompleted = stage.status === 'completed';

  // Business rule: Site Evaluation is done only once EVERY shortlisted
  // property has all four assessment types approved.
  const canMarkDone =
    assessmentTypes.length > 0 &&
    (properties || []).length > 0 &&
    (properties || []).every((p) => doneCountFor(p._id) === assessmentTypes.length);

  const confirmMarkDone = () => completeStage.mutate(stageKey, { onSuccess: () => setConfirmDone(false) });
  const openProperty = (p) => navigate(`/projects/${id}/site-evaluation/${p._id}`);

  const q = search.trim().toLowerCase();
  const rows = filteredScorecards
    .filter((s) => !q || [s.property.title, s.property.values?.city, s.property.values?.locality].some((v) => (v || '').toLowerCase().includes(q)))
    .map((s) => s.property);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pagedRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

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
        <div className="se-page se-page--tight-top fade-in">
          {/* Header — title, search/export */}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div className="col gap-1">
              <span className="se-page-subtitle">Evaluate and compare shortlisted properties to make the best decision.</span>
            </div>
            <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
              <div className="input-icon-wrap" style={{ minWidth: 220 }}>
                <Search size={15} className="input-icon" />
                <input className="input" placeholder="Search properties, cities…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button type="button" className="btn btn-subtle btn-sm" onClick={exportReport}>
                <Download size={14} /> Export Report
              </button>
            </div>
          </div>

          {/* Summary Cards — each opens its own dedicated KPI management page. */}
          <SummaryCards stats={summaryStats} onCardClick={openKpiPage} />

          {/* Recommended Property */}
          <RecommendedPropertyCard scorecards={filteredScorecards} />

          {/* Shortlisted Properties — Filters now opens a popup drawer
              (see FilterPanel) instead of a permanently-visible sidebar, so
              the table always has the full width. */}
          <SectionCard
            title={`Shortlisted Properties (${rows.length})`}
            action={
              <button type="button" className={`btn btn-subtle btn-sm cal-filter-btn${filterCount ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}>
                <Filter size={14} /> Filters
                {filterCount > 0 && <span className="cal-filter-count">{filterCount}</span>}
              </button>
            }
          >
              {propertiesLoading ? (
                <SkeletonTable columns={['6%', '22%', '12%', '12%', '14%', '14%', '12%', '10%']} rows={5} />
              ) : pagedRows.length ? (
                <div className="col gap-2">
                  <div className="se-table-wrap" style={{ overflowX: 'auto' }}>
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>No.</th>
                          <th>Property Name</th>
                          <th>City</th>
                          <th>Locality</th>
                          <th>Evaluation Status</th>
                          <th>Progress</th>
                          <th>Decision</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRows.map((p) => {
                          const sc = scorecardByPropertyId.get(String(p._id));
                          const done = sc?.approvedCount ?? 0;
                          const evalStatus = assessmentStatusOf(sc || { sections: {}, isFullyApproved: false });
                          const emeta = { pending: { label: 'Pending', color: '#7c7784' }, in_progress: { label: 'In Progress', color: '#38bdf8' }, approved: { label: 'Completed', color: 'var(--success)' }, rejected: { label: 'Rejected', color: 'var(--danger)' } }[evalStatus];
                          return (
                            <tr key={p._id} onClick={() => openProperty(p)}>
                              <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{p.seq ?? '—'}</td>
                              <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                                <span style={ellipsisCell(220)} title={p.title || 'Untitled Property'}>{p.title || 'Untitled Property'}</span>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}><span style={ellipsisCell(120)}>{p.values?.city || '—'}</span></td>
                              <td style={{ whiteSpace: 'nowrap' }}><span style={ellipsisCell(140)}>{p.values?.locality || '—'}</span></td>
                              <td style={{ whiteSpace: 'nowrap' }}><Badge color={emeta.color}>{emeta.label}</Badge></td>
                              <td style={{ whiteSpace: 'nowrap', minWidth: 110 }}>
                                {(() => {
                                  const pct = assessmentTypes.length ? Math.round((done / assessmentTypes.length) * 100) : 0;
                                  return (
                                    <div className="col gap-1">
                                      <span className="tiny muted">{done}/{assessmentTypes.length} ({pct}%)</span>
                                      <div className="se-progress-track">
                                        <div className="se-progress-fill" style={{ width: `${pct}%`, background: emeta.color }} />
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>
                              <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                                {!canDecide ? (
                                  <span className="tiny muted">—</span>
                                ) : sc?.stageApproved ? (
                                  <Badge color="var(--success)">Approved</Badge>
                                ) : (
                                  <div className="row gap-1" style={{ flexWrap: 'nowrap' }}>
                                    <button
                                      type="button"
                                      className="btn btn-outline-success btn-sm"
                                      disabled={decideProperty.isPending || done < assessmentTypes.length}
                                      title={done < assessmentTypes.length ? 'All assessments must be Approved before this property can be signed off.' : undefined}
                                      onClick={() => doApproveProperty(p)}
                                    >
                                      ✓ Approve
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-outline-danger btn-sm"
                                      disabled={decideProperty.isPending}
                                      onClick={() => setRejectTarget(p)}
                                    >
                                      ✕ Reject
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {sc?.overallScore != null ? (
                                  <span style={{ fontWeight: 600 }}>{sc.overallScore}</span>
                                ) : (
                                  <span className="tiny muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tiny muted">Showing {pageStart + 1} to {Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length} properties</span>
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
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title={search ? 'No matches' : 'No shortlisted properties yet'}
                  hint={search ? 'Try a different search or filter.' : 'Shortlist a property in Property Identification to begin its Site Evaluation.'}
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

          {/* Property Analysis & Comparison */}
          <PropertyAnalysisTable
            scorecards={evaluatedScorecards}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onCompareSelected={() => setCompareOpen(true)}
          />

          {/* Stage administration — Mark Done / Reopen / Task Assignment /
              Activity Timeline. Kept below the decision dashboard above
              (which is what management actually needs day to day) rather
              than removed, so the stage-completion workflow every other
              phase's dashboard already has isn't lost here. */}
          <SectionCard
            title="Stage Details"
            action={
              isCompleted ? (
                canReopen && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => reopenStage.mutate(stageKey)} disabled={reopenStage.isPending}>
                    <RotateCcw size={14} /> Reopen Stage
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setConfirmDone(true)}
                  disabled={!canMarkDone}
                  title={canMarkDone ? undefined : 'Every shortlisted property must reach 4/4 Completed before completing this stage.'}
                >
                  <CheckCircle2 size={14} /> Mark Done
                </button>
              )
            }
          >
            <div className="col gap-3">
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
              <div className="divider" />
              <span className="tiny subtle upper">Activity Timeline</span>
              {activitiesLoading ? (
                <SkeletonActivity rows={4} />
              ) : stageActivity.length ? (
                <div className="col gap-2">
                  {stageActivity.map((a) => (
                    <div key={a._id} className="row gap-3">
                      <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={28} />
                      <div className="col grow">
                        <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
                        <div className="tiny muted">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty sm" style={{ padding: '16px 12px' }}>No activity yet</div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {confirmDone && (
        <Modal
          open
          onClose={() => setConfirmDone(false)}
          title={`Complete ${stage.name}?`}
          width={440}
          footer={
            <div className="row gap-2">
              <button type="button" className="btn btn-subtle" onClick={() => setConfirmDone(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmMarkDone} disabled={completeStage.isPending}>
                {completeStage.isPending ? <span className="spinner" /> : 'Mark Done'}
              </button>
            </div>
          }
        >
          <p className="sm muted">Are you sure you want to mark this stage as completed?</p>
          {completeStage.isError && (
            <p className="sm" style={{ color: 'var(--danger)' }}>
              {completeStage.error?.response?.data?.message || 'Could not complete the stage.'}
            </p>
          )}
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

      <ComparisonDrawer open={compareOpen} onClose={() => setCompareOpen(false)} scorecards={selectedScorecards} />
    </>
  );
}

/**
 * Pure filter-matching used by the Shortlisted Properties table, the
 * Property Analysis table, and every Site Evaluation KPI management page, so
 * none of them ever disagree about which properties are "in view". Exported
 * for reuse by SiteEvaluationKpiPage.jsx.
 */
export function scorecardsMatchingFilters(scorecards, filters) {
  return scorecards.filter((s) => {
    const p = s.property;
    if (filters.city && p.values?.city !== filters.city) return false;
    if (filters.locality && p.values?.locality !== filters.locality) return false;
    if (filters.investMin && (s.investment == null || s.investment < Number(filters.investMin))) return false;
    if (filters.investMax && (s.investment == null || s.investment > Number(filters.investMax))) return false;
    if (filters.roiMin && (s.roi == null || s.roi < Number(filters.roiMin))) return false;
    if (filters.roiMax && (s.roi == null || s.roi > Number(filters.roiMax))) return false;
    if (filters.scoreMin && (s.overallScore == null || s.overallScore < Number(filters.scoreMin))) return false;
    if (filters.scoreMax && (s.overallScore == null || s.overallScore > Number(filters.scoreMax))) return false;
    if (filters.evaluationStatus !== 'all' && assessmentStatusOf(s) !== filters.evaluationStatus) return false;
    if (filters.decision === 'approved' && !s.stageApproved) return false;
    if (filters.decision === 'pending' && s.stageApproved) return false;
    if (filters.recommendation && s.recommendation !== filters.recommendation) return false;
    if (filters.riskLevel && s.riskLevel !== filters.riskLevel) return false;
    if (filters.approvedBy && !(p.decidedBy?.name || '').toLowerCase().includes(filters.approvedBy.toLowerCase())) return false;
    if (filters.rejectedBy && !(p.rejectedBy?.name || '').toLowerCase().includes(filters.rejectedBy.toLowerCase())) return false;
    if (filters.dateFrom || filters.dateTo) {
      const relevantDate = p.rejectedAt || p.decidedAt || p.createdAt;
      const t = relevantDate ? new Date(relevantDate).getTime() : null;
      if (filters.dateFrom && (t == null || t < new Date(filters.dateFrom).getTime())) return false;
      if (filters.dateTo && (t == null || t > new Date(filters.dateTo).getTime() + 86400000 - 1)) return false;
    }
    return true;
  });
}

export default SiteEvaluationPage;
