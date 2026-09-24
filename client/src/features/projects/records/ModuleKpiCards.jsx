import { ClipboardList, CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';

/**
 * Five-card clickable KPI strip for the module-based single-property
 * workspace pages (Commercial Finalization, Project Creation, Department
 * Planning) — same visual shape and .se-summary-grid/.se-summary-card CSS
 * (including the .clickable/.active states) as Site Evaluation's own
 * SummaryCards, just computed from a page's own `steps` array instead of a
 * property scorecard. Clicking a card narrows that page's Records table to
 * matching rows in place (see matchesStatusFilter in recordUi.js) — no
 * navigation, no new page, unlike Site Evaluation's KPI cards.
 */
export function ModuleKpiCards({ steps, doneCount, total, activeFilter, onFilterClick }) {
  const pending = steps.filter((s) => s.statusKey === 'pending').length;
  const inProgress = steps.filter((s) => s.statusKey === 'in_progress' || s.statusKey === 'in_review').length;
  const rejected = steps.filter((s) => s.statusKey === 'rejected').length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  const cards = [
    {
      key: 'all', label: 'Total Modules', value: total, sub: 'All modules',
      icon: ClipboardList, tint: 'var(--primary)', soft: 'var(--primary-soft)',
    },
    {
      key: 'approved', label: 'Completed', value: doneCount, sub: `${pct}% Completed`,
      icon: CheckCircle2, tint: 'var(--success)', soft: 'var(--success-soft)',
    },
    {
      key: 'pending', label: 'Pending', value: pending, sub: 'Awaiting submission',
      icon: Circle, tint: 'var(--warning)', soft: 'var(--warning-soft)',
    },
    {
      key: 'in_progress', label: 'In Progress', value: inProgress, sub: 'Work in progress',
      icon: Clock, tint: 'var(--info)', soft: 'var(--info-soft)',
    },
    {
      key: 'rejected', label: 'Rejected', value: rejected, sub: 'Needs attention',
      icon: XCircle, tint: 'var(--danger)', soft: 'var(--danger-soft)',
    },
  ];

  return (
    <div className="se-summary-grid">
      {cards.map((c) => {
        const isActive = c.key === 'all' ? !activeFilter : activeFilter === c.key;
        return (
          <button
            key={c.key}
            type="button"
            className={`se-summary-card clickable${isActive ? ' active' : ''}`}
            style={isActive ? { borderColor: c.tint, boxShadow: `0 0 0 2px ${c.tint}33` } : undefined}
            onClick={() => onFilterClick(c.key)}
          >
            <div className="col" style={{ minWidth: 0 }}>
              <span className="label">{c.label}</span>
              <span className="value">{c.value}</span>
              <span className="sub">{c.sub}</span>
            </div>
            <span className="icon" style={{ background: c.soft, color: c.tint }}>
              <c.icon size={19} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default ModuleKpiCards;
