import { Compass, IndianRupee, Wrench, Settings2, ClipboardCheck } from 'lucide-react';
import { fromNow } from '../../../lib/format.js';
import { scoreGradeFor } from '../records/scoring.js';

/**
 * Assessment Overview — a per-assessment-type roll-up across every shortlisted
 * property in Site Evaluation (Feasibility / Financial / Technical /
 * Operational), rendered as a compact vertical list for the dashboard's right
 * rail. Purely presentational: every number is derived here from the SAME
 * `scorecards` the rest of the dashboard already computed (see
 * computeScorecard in records/scoring.js). No new API, no persisted field, no
 * fabricated score — a type with no submitted records reads 0 / —.
 *
 * `types` is the stage's own `assessmentTypes` (each { key, name }) straight
 * from the template, so labels stay dynamic; it falls back to the four
 * canonical keys only when a template hasn't defined them.
 */

const TYPE_UI = {
  feasibility: { icon: Compass, color: '#6366F1' },
  financial: { icon: IndianRupee, color: '#059669' },
  technical: { icon: Wrench, color: '#D97706' },
  operational: { icon: Settings2, color: '#0D9488' },
};

const prettyKey = (k) => String(k || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function AssessmentOverview({ scorecards = [], types = [] }) {
  const total = scorecards.length;

  if (!types.length) {
    return <span className="sm muted">No assessment types are defined for this stage.</span>;
  }

  const rows = types.map((t) => {
    const key = t.key;
    const ui = TYPE_UI[key] || { icon: ClipboardCheck, color: 'var(--text-subtle)' };
    const sections = scorecards.map((s) => s.sections?.[key]).filter(Boolean);
    const completed = sections.filter((sec) => sec.latestRecord).length;
    const approved = sections.filter((sec) => sec.approvedRecord).length;
    const percents = sections.map((sec) => sec.percent).filter((v) => v != null);
    const avgScore = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
    const times = sections.map((sec) => sec.latestRecord?.createdAt).filter(Boolean).map((d) => new Date(d).getTime());
    const lastUpdated = times.length ? new Date(Math.max(...times)) : null;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    const name = t.name || `${prettyKey(key)} Assessment`;
    return { key, name, ...ui, completed, approved, avgScore, lastUpdated, pct };
  });

  return (
    <div className="se-ao-list">
      {rows.map((r) => {
        const grade = scoreGradeFor(r.avgScore);
        const tip = [
          `${r.completed}/${total} completed`,
          r.approved ? `${r.approved} approved` : null,
          r.avgScore != null ? `avg score ${r.avgScore}/100 (${grade.label})` : null,
          r.lastUpdated ? `updated ${fromNow(r.lastUpdated)}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <div key={r.key} className="se-ao-item" style={{ '--ao-accent': r.color }} title={tip}>
            <span className="se-ao-icon" style={{ background: `${r.color}1A`, color: r.color }}>
              <r.icon size={16} />
            </span>
            <div className="se-ao-text">
              <span className="se-ao-name">{r.name}</span>
              <span className="se-ao-sub">
                {r.completed}/{total} Completed
                {r.avgScore != null && <> · <b style={{ color: grade.color }}>{r.avgScore}/100</b></>}
              </span>
              <div className="se-ao-bar"><div className="se-ao-fill" style={{ width: `${r.pct}%`, background: r.color }} /></div>
            </div>
            <span className="se-ao-pct" style={{ color: r.pct ? r.color : 'var(--text-subtle)' }}>{r.pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export default AssessmentOverview;
