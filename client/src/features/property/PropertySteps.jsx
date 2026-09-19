import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { usePropertyQueue } from '../../app/api/propertyCaptureApi.js';
import { PropertyFmsBrief } from './PropertyFmsBrief.jsx';

/**
 * The Property module's shell: the six phases, drawn as the flow they are.
 *
 * NUMBERED DISCS ON A LINE, not four abutting boxes. The boxes were a row of
 * four panels, and a row of panels reads as four independent things sitting
 * next to each other — you had to read the numbers to learn it was a sequence
 * at all. Discs joined by a rail is the one stepper shape everybody already
 * knows, so the order is legible before a word is read. It is also the shape
 * the Design & Drawings rail already uses (`.dd-rail`), so the two modules now
 * describe a flow the same way.
 *
 * THE ARROWS ARE THE POINT. A plain line between two discs says they are
 * related; an arrowhead says which way the work moves. Phases joined by bare
 * rules read as a menu of places, which is exactly how the old row of boxes
 * read and the reason it was replaced.
 *
 * WHERE THE FORK WENT. The client's own diagram forks after capture, and this
 * used to draw that as a dashed branch hopping over Assessment, and then as a
 * step of its own. It is neither now: the fork is the Shortlist button on Step
 * 1, which asks which road the property takes — assessment and which of the
 * four, commercial, or straight to project. A rail cannot draw three roads at
 * once, and a step whose only content was that one dialog made people leave
 * the queue to answer a question about a row in it.
 *
 * Counts come from the same query the pages use, so opening a phase costs no
 * extra request — RTK Query serves all four from one cache entry.
 */
/* The route config's key for each step, so the FMS brief can look up the four
   pillars for whichever one is open — see propertyFms.js. */
const FMS_KEY = {
  '/property/capture': 'property-capture',
  '/property/md-review': 'property-md-review',
  '/property/assessment': 'property-assessment',
  '/property/selection': 'property-selection',
  '/property/commercial': 'property-commercial',
  '/property/planning': 'property-planning',
};

const STEPS = [
  { to: '/property/capture', n: 1, title: 'All Properties', desc: 'Every site in front of us', count: 'capture' },
  { to: '/property/md-review', n: 2, title: 'MD Review & Decision', desc: 'Which road this property takes', count: 'routing' },
  { to: '/property/assessment', n: 3, title: 'All Property Assessment', desc: 'The four site evaluations', count: 'assessment' },
  { to: '/property/selection', n: 4, title: 'MD Review & Approval', desc: 'One site chosen per project', count: 'selection' },
  { to: '/property/commercial', n: 5, title: 'All Property Commercial', desc: 'LOI, lease, legal, deposits', count: 'commercial' },
  /* Step 4 counts what is actually PLANNED, not what is eligible — the page
     lists every commercial property so planning can be started, but the
     stepper reports progress, and "13 waiting" would read as 13 done. */
  { to: '/property/planning', n: 6, title: 'All Project Creation', desc: 'Games, opening date, project', count: 'planning' },
];

export function PropertySteps() {
  /* Asks for ONE row and reads only the `counts` that ride along with it. The
     stepper needs four totals, not a page of data, and the queue is paginated
     now — pulling 25 rows here to count 4 numbers would be a second request's
     worth of payload thrown away on every navigation. */
  const { data } = usePropertyQueue({ limit: 1 });
  const location = useLocation();
  const counts = (data?.counts || data?.data?.counts) ?? {};
  const active = STEPS.find((st) => location.pathname.startsWith(st.to)) || null;

  return (
    <div className="prop-shell">
      <div className="prop-page">
        <div className="prop-stepper">
          {STEPS.map((s) => {
            const active = location.pathname.startsWith(s.to);
            return (
              <NavLink key={s.to} to={s.to} className={`prop-step${active ? ' active' : ''}`}>
                <span className="prop-step-num">{s.n}</span>
                <span className="prop-step-titlerow">
                  <span className="prop-step-title">{s.title}</span>
                  <span className="prop-step-count">{counts[s.count] ?? 0}</span>
                </span>
                <span className="prop-step-desc">{s.desc}</span>
              </NavLink>
            );
          })}

        </div>

        {/* What / Who / When / How for the step that is open. Rendered once
            here rather than on each page: five copies is five chances for one
            of them to be forgotten when a step is added, which is exactly what
            happened to the step numbering. */}
        {active && <PropertyFmsBrief stepKey={FMS_KEY[active.to]} title={active.title} />}

        <Outlet />
      </div>
    </div>
  );
}

export default PropertySteps;
