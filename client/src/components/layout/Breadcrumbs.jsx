import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * Purely presentational — renders a pre-resolved trail (see
 * lib/moduleRoutes.jsx#resolveBreadcrumbTrail / useBreadcrumbTrail). The
 * first reusable breadcrumb component in the app; every breadcrumb before
 * this was one hand-rolled, page-local instance
 * (SiteEvaluationComparisonPage.jsx). Module-agnostic — takes a plain array,
 * no import of anything EMS-specific.
 *
 * Renders nothing for a trail of 0 or 1 entries: a lone "Dashboard" crumb
 * with no parent to show against it adds no navigational value.
 */
export function Breadcrumbs({ trail }) {
  if (!trail || trail.length < 2) return null;
  return (
    <nav className="row gap-1 breadcrumbs" aria-label="Breadcrumb" style={{ alignItems: 'center' }}>
      {trail.map((entry, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={entry.key} className="row gap-1" style={{ alignItems: 'center' }}>
            {i > 0 && <ChevronRight size={12} className="muted" />}
            {isLast ? (
              <span className="breadcrumbs-current sm">{entry.breadcrumb || entry.title}</span>
            ) : (
              <Link to={entry.path} className="sm">{entry.breadcrumb || entry.title}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default Breadcrumbs;
