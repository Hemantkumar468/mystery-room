import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ClipboardList, Download, Filter } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { computeScorecard, rankScorecards, assessmentStatusOf } from './records/scoring.js';
import { SummaryCards } from './comparison/SummaryCards.jsx';
import { RecommendedPropertyCard } from './comparison/RecommendedPropertyCard.jsx';
import { FilterPanel, DEFAULT_SE_FILTERS, activeSeFilterCount } from './comparison/FilterPanel.jsx';
import { PropertyAnalysisTable, MAX_COMPARE } from './comparison/PropertyAnalysisTable.jsx';
import { ComparisonDrawer } from './comparison/ComparisonDrawer.jsx';
import { exportCsv } from './comparison/exportUtils.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';

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

function matchesFilters(s, filters) {
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
  return true;
}

/**
 * Dedicated Property Intelligence / comparison view — reached via the
 * "Compare Properties" button on the Site Evaluation dashboard
 * (SiteEvaluationPage.jsx), which already surfaces the Recommended Property
 * card and a compact Property Analysis table inline. This page reuses the
 * exact same components (RecommendedPropertyCard, FilterPanel,
 * PropertyAnalysisTable, ComparisonDrawer, the scoring engine) at full
 * width for a focused deep-dive — no scoring/filtering logic is
 * reimplemented here, only assembled.
 */
export function SiteEvaluationComparisonPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading: projectLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: properties, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: assessmentRecords, isLoading: assessmentsLoading } = useStageRecords(id, 'p2');

  const [filters, setFilters] = useState(DEFAULT_SE_FILTERS);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const p2Types = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const assessmentTypeKeys = useMemo(
    () => (p2Types.length ? p2Types.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational']),
    [p2Types],
  );

  const rankedScorecards = useMemo(() => {
    const raw = (properties || []).map((p) => computeScorecard(p, assessmentRecords || [], assessmentTypeKeys));
    return rankScorecards(raw);
  }, [properties, assessmentRecords, assessmentTypeKeys]);

  const summaryStats = useMemo(() => {
    let completed = 0;
    let approved = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    let rejected = 0;
    for (const s of rankedScorecards) {
      if (s.isFullyApproved) completed += 1;
      if (s.stageApproved) approved += 1;
      if (assessmentStatusOf(s) === 'rejected') rejected += 1;
      if (s.overallScore != null) { scoreSum += s.overallScore; scoreCount += 1; }
    }
    return { total: rankedScorecards.length, completed, approved, rejected, avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null };
  }, [rankedScorecards]);

  const cityOptions = useMemo(() => Array.from(new Set((properties || []).map((p) => p.values?.city).filter(Boolean))).sort(), [properties]);
  const localityOptions = useMemo(() => Array.from(new Set((properties || []).map((p) => p.values?.locality).filter(Boolean))).sort(), [properties]);

  const filteredScorecards = useMemo(() => rankedScorecards.filter((s) => matchesFilters(s, filters)), [rankedScorecards, filters]);
  const filterCount = activeSeFilterCount(filters);
  const evaluatedScorecards = useMemo(() => filteredScorecards.filter((s) => s.isFullyApproved), [filteredScorecards]);

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

  const exportReport = () => exportCsv(filteredScorecards, EXPORT_COLUMNS, `site-evaluation-comparison-${project?.code || id}.csv`);

  if (projectLoading || !project || propertiesLoading || assessmentsLoading) {
    return (<><Topbar title="Compare Properties" /><div className="content"><SkPropertyIdentification /></div></>);
  }

  const stage = project.stages?.find((s) => s.key === 'p2');
  if (!stage) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Compare Properties</span>} />
        <div className="content"><EmptyState icon={ClipboardList} title="No Site Evaluation stage" hint="This project has no Site Evaluation stage." /></div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/site-evaluation`)} aria-label="Back to Site Evaluation">
              <ArrowLeft size={16} />
            </button>
            Compare Properties
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="se-page fade-in">
          <div className="col gap-1">
            <div className="se-breadcrumb">
              <span style={{ cursor: 'pointer' }} onClick={() => navigate('/projects')}>Projects</span>
              <ChevronRight size={12} />
              <span style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${id}`)}>{project.name}</span>
              <ChevronRight size={12} />
              <span style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${id}/site-evaluation`)}>Site Evaluation</span>
              <ChevronRight size={12} />
              <span className="current">Compare Properties</span>
            </div>
            <span className="se-page-title">Property Intelligence</span>
            <span className="se-page-subtitle">Every shortlisted property's Feasibility/Financial/Technical/Operational scorecard, ranked and ready to compare.</span>
          </div>

          <SummaryCards stats={summaryStats} />

          <RecommendedPropertyCard scorecards={filteredScorecards} />

          <div className="col gap-2">
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className={`btn btn-subtle btn-sm cal-filter-btn${filterCount ? ' active' : ''}`}
                onClick={() => setFiltersOpen(true)}
                aria-haspopup="dialog"
              >
                <Filter size={14} /> Filters
                {filterCount > 0 && <span className="cal-filter-count">{filterCount}</span>}
              </button>
              <button type="button" className="btn btn-subtle btn-sm" onClick={exportReport}>
                <Download size={14} /> Export Report
              </button>
            </div>

            <FilterPanel
              open={filtersOpen}
              onClose={() => setFiltersOpen(false)}
              cityOptions={cityOptions}
              localityOptions={localityOptions}
              value={filters}
              onApply={(next) => { setFilters(next); setFiltersOpen(false); }}
              onReset={() => { setFilters(DEFAULT_SE_FILTERS); setFiltersOpen(false); }}
            />
            <PropertyAnalysisTable
              scorecards={evaluatedScorecards}
              selectedIds={selectedIds}
              onToggle={toggleSelect}
              onCompareSelected={() => setCompareOpen(true)}
            />
          </div>
        </div>
      </div>

      <ComparisonDrawer open={compareOpen} onClose={() => setCompareOpen(false)} scorecards={selectedScorecards} />
    </>
  );
}

export default SiteEvaluationComparisonPage;
