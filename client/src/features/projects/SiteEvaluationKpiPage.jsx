import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ChevronLeft, Search, Filter, Download, Calendar,
  LayoutGrid, List, ClipboardList, ChevronDown,
} from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonTable } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { fmtDate, fmtCurrency } from '../../lib/format.js';
import {
  computeScorecard, rankScorecards, assessmentStatusOf, scoreGradeFor, RECOMMENDATION_META,
  RISK_META, trafficForRoi, TRAFFIC_META,
} from './records/scoring.js';
import { FilterPanel, DEFAULT_SE_FILTERS, activeSeFilterCount } from './comparison/FilterPanel.jsx';
import { exportCsv, exportXls, exportPdf } from './comparison/exportUtils.js';
import { scorecardsMatchingFilters } from './comparison/filterUtils.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';

const fmtTime = (d) => (d ? dayjs(d).format('hh:mm A') : '—');

/** Title/subtitle per KPI, matching the reference's dynamic header examples. */
const KPI_META = {
  shortlisted: { title: 'Total Shortlisted', subtitle: 'Monitor all shortlisted properties awaiting or under evaluation.' },
  completed: { title: 'Completed Evaluations', subtitle: 'Monitor completed site evaluations.' },
  approved: { title: 'Approved Properties', subtitle: 'Monitor approved properties.' },
  rejected: { title: 'Rejected Properties', subtitle: 'Monitor rejected properties.' },
  scores: { title: 'Property Score Ranking', subtitle: 'Rank properties by overall evaluation score.' },
};

/** Sort options offered per KPI page — a subset of the reference's full list, only the ones that make sense for that row-set. */
const SORT_OPTIONS = {
  shortlisted: [
    { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' },
    { key: 'score_desc', label: 'Highest Score' }, { key: 'score_asc', label: 'Lowest Score' },
  ],
  completed: [
    { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' },
    { key: 'score_desc', label: 'Highest Score' }, { key: 'score_asc', label: 'Lowest Score' },
  ],
  approved: [
    { key: 'recently_approved', label: 'Recently Approved' },
    { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' },
    { key: 'score_desc', label: 'Highest Score' }, { key: 'score_asc', label: 'Lowest Score' },
  ],
  rejected: [
    { key: 'recently_rejected', label: 'Recently Rejected' },
    { key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' },
  ],
  scores: [
    { key: 'score_desc', label: 'Highest Score' }, { key: 'score_asc', label: 'Lowest Score' },
  ],
};
const DEFAULT_SORT = { shortlisted: 'newest', completed: 'newest', approved: 'recently_approved', rejected: 'recently_rejected', scores: 'score_desc' };

/** Evaluation Status badge — a page-local meta map (every phase page defines its own), matching the reference's 4-color legend: Pending orange, In Progress / Completed blue, Rejected red. Distinct from the Decision badge (Approved = green) shown on the Approved/Rejected pages. */
const STATUS_META = {
  pending: { label: 'Pending', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  in_progress: { label: 'In Progress', color: 'var(--info)', soft: 'var(--info-soft)' },
  approved: { label: 'Completed', color: 'var(--info)', soft: 'var(--info-soft)' },
  rejected: { label: 'Rejected', color: 'var(--danger)', soft: 'var(--danger-soft)' },
};

function RecommendationBadge({ value }) {
  const meta = RECOMMENDATION_META[value] || RECOMMENDATION_META['Evaluation Incomplete'];
  return <Badge color={meta.color}>{value}</Badge>;
}

/** The approved record (across every section) with the latest approvedAt — "whichever section finished the evaluation" for the Completed page's By/Date/Time columns. */
function lastApprovedRecordOf(scorecard) {
  let best = null;
  let bestTime = -1;
  for (const sec of Object.values(scorecard.sections)) {
    const t = sec.approvedRecord?.approvedAt ? new Date(sec.approvedRecord.approvedAt).getTime() : -1;
    if (t > bestTime) { bestTime = t; best = sec.approvedRecord; }
  }
  return best;
}

/** First not-yet-approved section (in template order), or "Evaluation Complete" / "Not Started" — the Shortlisted page's Current Stage column. */
function currentStageOf(scorecard, assessmentTypes) {
  if (!assessmentTypes.length) return '—';
  const started = Object.values(scorecard.sections).some((s) => s.status != null);
  if (!started) return 'Not Started';
  for (const t of assessmentTypes) {
    const sec = scorecard.sections[t.key];
    if (!sec || sec.status !== 'approved') return t.name || t.key;
  }
  return 'Evaluation Complete';
}

/** The date a row is sorted/date-filtered by, per KPI — each KPI's own "when did this happen" moment. */
function primaryDateOf(scorecard, kpi) {
  const p = scorecard.property;
  if (kpi === 'approved') return p.decidedAt;
  if (kpi === 'rejected') return p.rejectedAt;
  if (kpi === 'completed' || kpi === 'scores') return lastApprovedRecordOf(scorecard)?.approvedAt || null;
  return p.createdAt;
}

function sortScorecards(list, sortKey, kpi) {
  const arr = [...list];
  const byDate = (dir) => arr.sort((a, b) => {
    const ta = primaryDateOf(a, kpi) ? new Date(primaryDateOf(a, kpi)).getTime() : 0;
    const tb = primaryDateOf(b, kpi) ? new Date(primaryDateOf(b, kpi)).getTime() : 0;
    return dir * (tb - ta);
  });
  switch (sortKey) {
    case 'oldest': return byDate(-1);
    case 'score_desc': return arr.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));
    case 'score_asc': return arr.sort((a, b) => (a.overallScore ?? 1e9) - (b.overallScore ?? 1e9));
    case 'recently_approved': return arr.sort((a, b) => new Date(b.property.decidedAt || 0) - new Date(a.property.decidedAt || 0));
    case 'recently_rejected': return arr.sort((a, b) => new Date(b.property.rejectedAt || 0) - new Date(a.property.rejectedAt || 0));
    case 'newest':
    default: return byDate(1);
  }
}

/** 1-based page numbers to render, with '…' gaps — copied from SiteEvaluationPage.jsx (small pure function, not worth a shared util for one caller each). */
function paginationItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

/** Compact popover — two date inputs writing straight into the page's applied filters (no separate "Apply" step, unlike the Filters drawer's deferred draft), so it reads as a quick top-of-page control. */
function DateRangePopover({ dateFrom, dateTo, onChange }) {
  const [open, setOpen] = useState(false);
  const label = dateFrom || dateTo
    ? `${dateFrom ? fmtDate(dateFrom) : '…'} – ${dateTo ? fmtDate(dateTo) : '…'}`
    : 'Date Range';
  return (
    <div className="se-daterange-wrap">
      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpen((o) => !o)}>
        <Calendar size={14} /> {label} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="se-daterange-pop fade-in" role="dialog" aria-label="Date range">
          <div className="col gap-2">
            <label className="tiny subtle upper">From</label>
            <input className="input" type="date" value={dateFrom} onChange={(e) => onChange({ dateFrom: e.target.value, dateTo })} />
            <label className="tiny subtle upper">To</label>
            <input className="input" type="date" value={dateTo} onChange={(e) => onChange({ dateFrom, dateTo: e.target.value })} />
            <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange({ dateFrom: '', dateTo: '' }); setOpen(false); }}>Clear</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ onExport }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="se-export-wrap">
      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpen((o) => !o)}>
        <Download size={14} /> Export Report <ChevronDown size={12} />
      </button>
      {open && (
        <div className="se-export-menu fade-in" role="menu">
          {['CSV', 'Excel', 'PDF'].map((fmt) => (
            <button key={fmt} type="button" role="menuitem" onClick={() => { onExport(fmt); setOpen(false); }}>
              {fmt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shared, config-driven management page for every Site Evaluation KPI card —
 * `kpi` selects the row-set, columns, sort options and title/subtitle. All
 * five pages reuse the exact same scoring engine, filter panel, export
 * utilities and property-detail navigation as the main dashboard
 * (SiteEvaluationPage.jsx) — this is a different lens on the same data, not
 * a parallel data model.
 */
export function SiteEvaluationKpiPage({ kpi }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  const { data: properties, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: rejectedProperties, isLoading: rejectedLoading } = useStageRecords(id, 'p1', { status: 'rejected' });
  const { data: assessmentRecords } = useStageRecords(id, 'p2');

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(DEFAULT_SE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState(DEFAULT_SORT[kpi]);
  const [view, setView] = useState('list');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const p2AssessmentTypes = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const assessmentTypeKeys = useMemo(
    () => (p2AssessmentTypes.length ? p2AssessmentTypes.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational']),
    [p2AssessmentTypes],
  );

  const rankedScorecards = useMemo(() => {
    const raw = (properties || []).map((p) => computeScorecard(p, assessmentRecords || [], assessmentTypeKeys));
    return rankScorecards(raw);
  }, [properties, assessmentRecords, assessmentTypeKeys]);

  const rejectedScorecards = useMemo(
    () => (rejectedProperties || []).map((p) => computeScorecard(p, assessmentRecords || [], assessmentTypeKeys)),
    [rejectedProperties, assessmentRecords, assessmentTypeKeys],
  );

  const baseScorecards = kpi === 'rejected' ? rejectedScorecards : rankedScorecards;
  const kpiScorecards = useMemo(() => {
    if (kpi === 'completed' || kpi === 'scores') return baseScorecards.filter((s) => s.isFullyApproved);
    if (kpi === 'approved') return baseScorecards.filter((s) => s.stageApproved);
    return baseScorecards;
  }, [baseScorecards, kpi]);

  const cityOptions = useMemo(() => Array.from(new Set(kpiScorecards.map((s) => s.property.values?.city).filter(Boolean))).sort(), [kpiScorecards]);
  const localityOptions = useMemo(() => Array.from(new Set(kpiScorecards.map((s) => s.property.values?.locality).filter(Boolean))).sort(), [kpiScorecards]);

  const filtered = useMemo(() => scorecardsMatchingFilters(kpiScorecards, filters), [kpiScorecards, filters]);
  const filterCount = activeSeFilterCount(filters);

  const q = search.trim().toLowerCase();
  const searched = filtered.filter((s) => !q || [s.property.title, s.property.values?.city, s.property.values?.locality].some((v) => (v || '').toLowerCase().includes(q)));
  const sorted = useMemo(() => sortScorecards(searched, sortKey, kpi), [searched, sortKey, kpi]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart = page * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  const openProperty = (s) => navigate(`/projects/${id}/site-evaluation/${s.property._id}`);
  const meta = KPI_META[kpi];

  const EXPORT_COLUMNS = {
    shortlisted: [
      { key: 'name', label: 'Property Name', get: (s) => s.property.title || '' },
      { key: 'city', label: 'City', get: (s) => s.property.values?.city || '' },
      { key: 'locality', label: 'Locality', get: (s) => s.property.values?.locality || '' },
      { key: 'status', label: 'Evaluation Status', get: (s) => STATUS_META[assessmentStatusOf(s)].label },
      { key: 'progress', label: 'Progress', get: (s) => `${s.approvedCount}/${s.totalSections}` },
      { key: 'stage', label: 'Current Stage', get: (s) => currentStageOf(s, p2AssessmentTypes) },
      { key: 'score', label: 'Overall Score', get: (s) => s.overallScore ?? '' },
      { key: 'recommendation', label: 'Recommendation', get: (s) => s.recommendation },
    ],
    completed: [
      { key: 'name', label: 'Property Name', get: (s) => s.property.title || '' },
      { key: 'city', label: 'City', get: (s) => s.property.values?.city || '' },
      { key: 'score', label: 'Overall Score', get: (s) => s.overallScore ?? '' },
      { key: 'completedBy', label: 'Completed By', get: (s) => lastApprovedRecordOf(s)?.approvedBy?.name || '' },
      { key: 'completedDate', label: 'Completed Date', get: (s) => fmtDate(lastApprovedRecordOf(s)?.approvedAt) },
      { key: 'completedTime', label: 'Completed Time', get: (s) => fmtTime(lastApprovedRecordOf(s)?.approvedAt) },
      { key: 'recommendation', label: 'Recommendation', get: (s) => s.recommendation },
    ],
    approved: [
      { key: 'name', label: 'Property Name', get: (s) => s.property.title || '' },
      { key: 'city', label: 'City', get: (s) => s.property.values?.city || '' },
      { key: 'locality', label: 'Locality', get: (s) => s.property.values?.locality || '' },
      { key: 'score', label: 'Overall Score', get: (s) => s.overallScore ?? '' },
      { key: 'grade', label: 'Score Grade', get: (s) => scoreGradeFor(s.overallScore).label },
      { key: 'approvedBy', label: 'Approved By', get: (s) => s.property.decidedBy?.name || '' },
      { key: 'approvedDate', label: 'Approved Date', get: (s) => fmtDate(s.property.decidedAt) },
      { key: 'approvedTime', label: 'Approved Time', get: (s) => fmtTime(s.property.decidedAt) },
      { key: 'decision', label: 'Decision', get: () => 'Approved' },
      { key: 'recommendation', label: 'Recommendation', get: (s) => s.recommendation },
    ],
    rejected: [
      { key: 'name', label: 'Property Name', get: (s) => s.property.title || '' },
      { key: 'city', label: 'City', get: (s) => s.property.values?.city || '' },
      { key: 'locality', label: 'Locality', get: (s) => s.property.values?.locality || '' },
      { key: 'score', label: 'Overall Score', get: (s) => s.overallScore ?? '' },
      { key: 'rejectedBy', label: 'Rejected By', get: (s) => s.property.rejectedBy?.name || '' },
      { key: 'rejectedDate', label: 'Rejected Date', get: (s) => fmtDate(s.property.rejectedAt) },
      { key: 'rejectedTime', label: 'Rejected Time', get: (s) => fmtTime(s.property.rejectedAt) },
      { key: 'reason', label: 'Reject Reason', get: (s) => s.property.rejectReason || '' },
      { key: 'remarks', label: 'Reviewer Remarks', get: (s) => s.property.decisionReason || '' },
      { key: 'decision', label: 'Decision', get: () => 'Rejected' },
      { key: 'recommendation', label: 'Recommendation', get: (s) => s.recommendation },
    ],
    scores: [
      { key: 'rank', label: 'Rank', get: (s) => s.rank ?? '' },
      { key: 'name', label: 'Property Name', get: (s) => s.property.title || '' },
      { key: 'city', label: 'City', get: (s) => s.property.values?.city || '' },
      { key: 'score', label: 'Overall Score', get: (s) => s.overallScore ?? '' },
      { key: 'roi', label: 'Return on Investment (%)', get: (s) => s.roi ?? '' },
      { key: 'investment', label: 'Investment', get: (s) => s.investment ?? '' },
      { key: 'payback', label: 'Investment Recovery Time (mo)', get: (s) => s.paybackMonths ?? '' },
      { key: 'risk', label: 'Risk', get: (s) => s.riskLevel },
      { key: 'recommendation', label: 'Recommendation', get: (s) => s.recommendation },
    ],
  }[kpi];

  const doExport = (fmt) => {
    const filename = `site-evaluation-${kpi}-${project?.code || id}`;
    if (fmt === 'CSV') exportCsv(sorted, EXPORT_COLUMNS, `${filename}.csv`);
    else if (fmt === 'Excel') exportXls(sorted, EXPORT_COLUMNS, `${filename}.xls`);
    else exportPdf(meta.title, sorted, EXPORT_COLUMNS);
  };

  if (isLoading || !project) {
    return (<><Topbar title="Site Evaluation" /><div className="content"><SkPropertyIdentification /></div></>);
  }

  const loadingRows = propertiesLoading || rejectedLoading || templateLoading;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            {meta.title}
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="se-page se-page--tight-top fade-in">
          <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            <DateRangePopover dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(next) => { setFilters((f) => ({ ...f, ...next })); setPage(0); }} />
            <ExportMenu onExport={doExport} />
          </div>

          <SectionCard
            title={`${meta.title} (${sorted.length})`}
            action={
              <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                <div className="input-icon-wrap" style={{ minWidth: 200 }}>
                  <Search size={15} className="input-icon" />
                  <input className="input" placeholder="Search properties, cities…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
                </div>
                <button type="button" className={`btn btn-subtle btn-sm cal-filter-btn${filterCount ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}>
                  <Filter size={14} /> Filters
                  {filterCount > 0 && <span className="cal-filter-count">{filterCount}</span>}
                </button>
                <select className="select" style={{ width: 'auto' }} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  {SORT_OPTIONS[kpi].map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <div className="se-view-toggle">
                  <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view"><List size={14} /></button>
                  <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid size={14} /></button>
                </div>
              </div>
            }
          >
            {loadingRows ? (
              <SkeletonTable columns={['6%', '20%', '12%', '12%', '14%', '14%', '12%', '10%']} rows={6} />
            ) : pageRows.length ? (
              <div className="col gap-2">
                {view === 'list' ? (
                  <div className="se-kpi-table-wrap" style={{ overflowX: 'auto' }}>
                    <KpiTable kpi={kpi} rows={pageRows} pageStart={pageStart} assessmentTypes={p2AssessmentTypes} onRowClick={openProperty} />
                  </div>
                ) : (
                  <KpiGrid kpi={kpi} rows={pageRows} onCardClick={openProperty} />
                )}
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span className="tiny muted">Showing {pageStart + 1} to {Math.min(pageStart + pageSize, sorted.length)} of {sorted.length} properties</span>
                  <div className="row gap-3" style={{ alignItems: 'center' }}>
                    <div className="row gap-2" style={{ alignItems: 'center' }}>
                      <span className="tiny muted">Rows</span>
                      <select className="select" style={{ width: 'auto' }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
                        {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
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
                title={search || filterCount ? 'No matches' : `No ${meta.title.toLowerCase()} yet`}
                hint={search || filterCount ? 'Try a different search or filter.' : 'Nothing to show here yet.'}
              />
            )}
          </SectionCard>

          <FilterPanel
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            cityOptions={cityOptions}
            localityOptions={localityOptions}
            value={filters}
            onApply={(next) => { setFilters(next); setFiltersOpen(false); setPage(0); }}
            onReset={() => { setFilters(DEFAULT_SE_FILTERS); setFiltersOpen(false); setPage(0); }}
          />
        </div>
      </div>
    </>
  );
}

const ellipsisCell = (maxWidth) => ({ display: 'block', maxWidth, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

/** List-view table — one thead/tbody per kpi's own column set, sharing the same sticky-header/hover/clickable-row shell. */
function KpiTable({ kpi, rows, pageStart, assessmentTypes, onRowClick }) {
  const scoreCell = (s) => (s.overallScore != null ? <span style={{ fontWeight: 600 }}>{s.overallScore}</span> : <span className="tiny muted">—</span>);

  return (
    <table className="table table-clickable se-kpi-table">
      <thead>
        <tr>
          <th>No.</th>
          <th>Property Name</th>
          <th>City</th>
          {kpi !== 'completed' && kpi !== 'scores' && <th>Locality</th>}
          {kpi === 'shortlisted' && <><th>Evaluation Status</th><th>Progress</th><th>Current Stage</th></>}
          {(kpi === 'scores') && <th>Rank</th>}
          <th>Overall Score</th>
          {kpi === 'approved' && <th>Score Grade</th>}
          {kpi === 'completed' && <><th>Completed By</th><th>Completed Date</th><th>Completed Time</th></>}
          {kpi === 'approved' && <><th>Approved By</th><th>Approved Date</th><th>Approved Time</th></>}
          {kpi === 'rejected' && <><th>Rejected By</th><th>Rejected Date</th><th>Rejected Time</th><th>Reject Reason</th><th>Reviewer Remarks</th></>}
          {kpi === 'scores' && <><th>Return on Investment</th><th>Investment</th><th>Recovery Time</th><th>Risk</th></>}
          {(kpi === 'approved' || kpi === 'rejected') && <th>Decision</th>}
          <th>Recommendation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => {
          const p = s.property;
          const lastApproved = kpi === 'completed' ? lastApprovedRecordOf(s) : null;
          return (
            <tr key={p._id} onClick={() => onRowClick(s)}>
              <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{pageStart + i + 1}</td>
              <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}><span style={ellipsisCell(200)} title={p.title}>{p.title || 'Untitled Property'}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}><span style={ellipsisCell(120)}>{p.values?.city || '—'}</span></td>
              {kpi !== 'completed' && kpi !== 'scores' && <td style={{ whiteSpace: 'nowrap' }}><span style={ellipsisCell(140)}>{p.values?.locality || '—'}</span></td>}

              {kpi === 'shortlisted' && (
                <>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Badge color={STATUS_META[assessmentStatusOf(s)].color} soft={STATUS_META[assessmentStatusOf(s)].soft}>{STATUS_META[assessmentStatusOf(s)].label}</Badge>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', minWidth: 110 }}>
                    {(() => {
                      const pct = s.totalSections ? Math.round((s.approvedCount / s.totalSections) * 100) : 0;
                      return (
                        <div className="col gap-1">
                          <span className="tiny muted">{s.approvedCount}/{s.totalSections} ({pct}%)</span>
                          <div className="se-progress-track"><div className="se-progress-fill" style={{ width: `${pct}%`, background: 'var(--info)' }} /></div>
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{currentStageOf(s, assessmentTypes)}</td>
                </>
              )}

              {kpi === 'scores' && <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{s.rank ? `#${s.rank}` : '—'}</td>}

              <td style={{ whiteSpace: 'nowrap' }}>{scoreCell(s)}</td>

              {kpi === 'approved' && (
                <td style={{ whiteSpace: 'nowrap' }}><Badge color={scoreGradeFor(s.overallScore).color}>{scoreGradeFor(s.overallScore).label}</Badge></td>
              )}

              {kpi === 'completed' && (
                <>
                  <td style={{ whiteSpace: 'nowrap' }}>{lastApproved?.approvedBy?.name || '—'}</td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(lastApproved?.approvedAt)}</td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(lastApproved?.approvedAt)}</td>
                </>
              )}

              {kpi === 'approved' && (
                <>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.decidedBy?.name || '—'}</td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.decidedAt)}</td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(p.decidedAt)}</td>
                </>
              )}

              {kpi === 'rejected' && (
                <>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.rejectedBy?.name || '—'}</td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.rejectedAt)}</td>
                  <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(p.rejectedAt)}</td>
                  <td style={{ maxWidth: 180 }}><span style={ellipsisCell(180)} title={p.rejectReason}>{p.rejectReason || '—'}</span></td>
                  <td style={{ maxWidth: 200 }}><span style={ellipsisCell(200)} title={p.decisionReason}>{p.decisionReason || '—'}</span></td>
                </>
              )}

              {kpi === 'scores' && (
                <>
                  <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: TRAFFIC_META[trafficForRoi(s.roi)].color, fontWeight: 500 }}>{s.roi != null ? `${s.roi}%` : '—'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtCurrency(s.investment)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.paybackMonths != null ? `${s.paybackMonths} mo` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><Badge color={RISK_META[s.riskLevel].color}>{RISK_META[s.riskLevel].label}</Badge></td>
                </>
              )}

              {kpi === 'approved' && <td style={{ whiteSpace: 'nowrap' }}><Badge color="var(--success)" soft="var(--success-soft)">Approved</Badge></td>}
              {kpi === 'rejected' && <td style={{ whiteSpace: 'nowrap' }}><Badge color="var(--danger)" soft="var(--danger-soft)">Rejected</Badge></td>}

              <td style={{ whiteSpace: 'nowrap' }}><RecommendationBadge value={s.recommendation} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A short, kpi-specific "headline" stat for the grid card's second line — not a full column dump, just enough to tell rows apart at a glance. */
function gridHeadline(kpi, s) {
  const p = s.property;
  if (kpi === 'shortlisted') return `${s.approvedCount}/${s.totalSections} assessments`;
  if (kpi === 'completed') return `Completed ${fmtDate(lastApprovedRecordOf(s)?.approvedAt)}`;
  if (kpi === 'approved') return `Approved by ${p.decidedBy?.name || '—'}`;
  if (kpi === 'rejected') return p.rejectReason || 'No reason on file';
  return `${p.values?.city || '—'} · Return on Investment ${s.roi != null ? `${s.roi}%` : '—'}`;
}

/** Grid view — same rows as the table, rendered as compact cards. */
function KpiGrid({ kpi, rows, onCardClick }) {
  return (
    <div className="se-kpi-grid">
      {rows.map((s) => (
        <button type="button" key={s.property._id} className="card se-kpi-grid-card" onClick={() => onCardClick(s)}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontWeight: 600 }}>{s.property.title || 'Untitled Property'}</span>
            {kpi === 'scores' && <span className="mono tiny subtle">{s.rank ? `#${s.rank}` : '—'}</span>}
          </div>
          <span className="tiny muted">{s.property.values?.city || '—'}{s.property.values?.locality ? ` · ${s.property.values.locality}` : ''}</span>
          <div className="row gap-2" style={{ marginTop: 6 }}>
            <Badge color={scoreGradeFor(s.overallScore).color}>{s.overallScore != null ? `${s.overallScore}/100` : 'No score'}</Badge>
            <RecommendationBadge value={s.recommendation} />
          </div>
          <span className="tiny subtle" style={{ marginTop: 6 }}>{gridHeadline(kpi, s)}</span>
        </button>
      ))}
    </div>
  );
}

export default SiteEvaluationKpiPage;
