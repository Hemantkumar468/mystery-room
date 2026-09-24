import { assessmentStatusOf } from '../records/scoring.js';

/**
 * Shared scorecard filter predicate for every Site Evaluation surface that
 * uses the Filters drawer (`FilterPanel.jsx`) — the main dashboard
 * (`SiteEvaluationPage.jsx`) and every KPI drilldown page
 * (`SiteEvaluationKpiPage.jsx`). Pulled out of the dashboard page itself so
 * neither file has to import application code from the other.
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
    if (filters.decision === 'rejected' && p.status !== 'rejected') return false;
    if (filters.decision === 'pending' && (s.stageApproved || p.status === 'rejected')) return false;
    if (filters.recommendation && s.recommendation !== filters.recommendation) return false;
    if (filters.riskLevel && s.riskLevel !== filters.riskLevel) return false;
    if (filters.progress && filters.progress !== 'all') {
      const sections = Object.values(s.sections);
      const done = sections.filter((sec) => !!sec.latestRecord).length;
      const state = done === 0 ? 'not_started' : done === sections.length ? 'completed' : 'in_progress';
      if (state !== filters.progress) return false;
    }
    // Repurposed as a stand-in "assigned to" filter — no per-property
    // assignee field exists in the data model, so this matches whoever
    // actually submitted the property's assessment work.
    if (filters.approvedBy) {
      const submitters = Object.values(s.sections).map((sec) => sec.latestRecord?.submittedBy?.name || sec.latestRecord?.createdBy?.name).filter(Boolean);
      if (!submitters.some((n) => n.toLowerCase().includes(filters.approvedBy.toLowerCase()))) return false;
    }
    if (filters.rejectedBy && !(p.rejectedBy?.name || '').toLowerCase().includes(filters.rejectedBy.toLowerCase())) return false;
    if (filters.dateFrom || filters.dateTo) {
      // "Evaluation Date" — when this property's evaluation work started,
      // approximated as the earliest of its four assessment types' latest
      // submissions (each type is normally submitted once, so this is
      // usually the true first-submitted date too).
      const recordDates = Object.values(s.sections)
        .map((sec) => sec.latestRecord?.createdAt)
        .filter(Boolean)
        .map((d) => new Date(d).getTime());
      const t = recordDates.length ? Math.min(...recordDates) : null;
      if (filters.dateFrom && (t == null || t < new Date(filters.dateFrom).getTime())) return false;
      if (filters.dateTo && (t == null || t > new Date(filters.dateTo).getTime() + 86400000 - 1)) return false;
    }
    return true;
  });
}

export default scorecardsMatchingFilters;
