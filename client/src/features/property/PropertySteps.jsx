import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { usePropertyQueue } from '../../app/api/propertyCaptureApi.js';

/**
 * The Property module's shell: the four phases, drawn as the flow they are.
 *
 * WHY IT BRANCHES. The client's own diagram forks at Step 1 — "assessment
 * required?" — and a plain 1-2-3-4 chain would quietly misdescribe the process:
 * it would tell a new starter that every property goes through assessment,
 * when the point of the decision is that many do not. So the four segments sit
 * on one row and the skip is drawn as a dashed branch BELOW them.
 *
 * THE BRANCH IS CONNECTED, not a caption. Its two vertical stubs run UP into
 * the bottom edge of Step 1 and Step 3 (the SVG is pulled 2px over the
 * stepper's border and its ends are anchored at the centre of those two
 * segments — 12.5% and 62.5% of a four-column grid). A dashed line floating in
 * the gap below would read as a footnote about the stepper rather than as a
 * second road out of it, which is the whole thing it has to communicate.
 *
 * Counts come from the same query the pages use, so opening a phase costs no
 * extra request — RTK Query serves all four from one cache entry.
 */
const STEPS = [
  { to: '/property/capture', n: 1, title: 'Property Capturing', desc: 'Franchisee, broker, or asked for', count: 'capture' },
  { to: '/property/assessment', n: 2, title: 'Assessment', desc: 'The four site evaluations', count: 'assessment' },
  { to: '/property/commercial', n: 3, title: 'Commercial', desc: 'LOI, lease, legal, deposits', count: 'commercial' },
  /* Step 4 counts what is actually PLANNED, not what is eligible — the page
     lists every commercial property so planning can be started, but the
     stepper reports progress, and "13 waiting" would read as 13 done. */
  { to: '/property/planning', n: 4, title: 'Project & Games', desc: 'Games, opening date, project', count: 'planning' },
];

export function PropertySteps() {
  /* Asks for ONE row and reads only the `counts` that ride along with it. The
     stepper needs four totals, not a page of data, and the queue is paginated
     now — pulling 25 rows here to count 4 numbers would be a second request's
     worth of payload thrown away on every navigation. */
  const { data } = usePropertyQueue({ limit: 1 });
  const location = useLocation();
  const counts = (data?.counts || data?.data?.counts) ?? {};

  return (
    <div className="prop-shell">
      <div className="prop-page">
        <div className="prop-stepper">
          {STEPS.map((s) => {
            const active = location.pathname.startsWith(s.to);
            return (
              <NavLink key={s.to} to={s.to} className={`prop-step${active ? ' active' : ''}`}>
                <span className="prop-step-num">{s.n}</span>
                <span className="prop-step-body">
                  <span className="prop-step-titlerow">
                    <span className="prop-step-title">{s.title}</span>
                    <span className="prop-step-count">{counts[s.count] ?? 0}</span>
                  </span>
                  <span className="prop-step-desc">{s.desc}</span>
                </span>
              </NavLink>
            );
          })}

          {/* Rendered as siblings of the segments, not inside them: these are
              positioned against the STEPPER, so 25% means a quarter of the
              whole row. Absolute positioning takes them out of grid flow, so
              they claim no column of their own. */}
          {[25, 50, 75].map((pct) => (
            <span key={pct} className="prop-chevron" style={{ left: `${pct}%` }} aria-hidden="true">›</span>
          ))}
        </div>

        {/* The second road out of Step 1: skip assessment, straight to
            commercial. Anchored to the two segments it joins — see the note
            at the top of this file. */}
        <div className="prop-branch">
          <svg className="prop-branch-svg" viewBox="0 0 400 34" preserveAspectRatio="none" aria-hidden="true">
            {/* Down out of Step 1, across under Step 2, up into Step 3. */}
            <path
              d="M 3 0 V 17 H 397 V 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              style={{ color: '#c9974f' }}
            />
          </svg>
          <span className="prop-branch-label">SKIP ASSESSMENT · GOES STRAIGHT TO COMMERCIAL</span>
        </div>

        <Outlet />
      </div>
    </div>
  );
}

export default PropertySteps;
