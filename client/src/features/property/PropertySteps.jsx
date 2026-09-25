import { Fragment, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  Building2, CheckCircle2, Clock, XCircle, Users, FileText, MapPin,
  ChevronDown, ChevronUp, ChevronRight,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import '../../styles/property-capture-blue.css';
import { usePropertyQueue } from '../../app/api/propertyCaptureApi.js';
import { useAccess } from '../../hooks/useAccess.js';

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
/** One KPI tile. `tone` only colours the icon; the figure is always ink. */
function Kpi({ icon: Icon, tone, n, label, sub }) {
  return (
    <div className={`pc2-kpi t-${tone}`}>
      <span className="pc2-kpi-ico"><Icon size={17} /></span>
      <span className="pc2-kpi-body">
        {/* A NUMBER WE DO NOT HAVE IS NOT ZERO.
            Every tile read `?? 0`, so a request that was still in flight - or
            that failed, which happens every time the API restarts under a
            page that is already open - painted the whole strip and the rail
            with zeros. Six noughts and "0 Total Properties" over a table full
            of rows does not say "loading", it says the pipeline is empty. A
            dash says the one true thing: not known yet. */}
        <span className="pc2-kpi-n">{typeof n === 'number' ? n : <span className="pc2-kpi-wait">—</span>}</span>
        <span className="pc2-kpi-l">{label}</span>
        <span className="pc2-kpi-s">{sub}</span>
      </span>
    </div>
  );
}

/**
 * The six steps, with the key each one is granted by.
 *
 * `key` is the same string three other places already use for this step: the
 * route config (features/property/config/property.routes.config.js), the
 * sidebar's folded Property group, and the access catalogue on the server.
 * One spelling, so hiding "Step 3" on Settings -> Access Control removes it
 * from the rail, from the sidebar and from the URL together, rather than
 * from two of the three.
 */
const STEPS = [
  /* Steps 1 and 2 show the SAME sheet - every property that is not rejected -
     so they carry the same figure, and it is the one their footers print.
     They read 29 and 18 before: the phase-1 subtotal and a narrower queue that
     no longer exists, neither of which was what clicking the step gave you. */
  /* `all`, not `live`: Step 1 lists rejected properties too (see
     PropertyCapturePage), so counting only the live ones put a 32 on a tab
     that opens 33 rows. Every other step is a queue of work outstanding and
     stays on `live`. */
  { key: 'property-capture', to: '/property/capture', n: 1, title: 'All Properties', desc: 'Every site in front of us', count: 'all' },
  { key: 'property-md-review', to: '/property/md-review', n: 2, title: 'MD Review & Decision', desc: 'Which road this property takes', count: 'live' },
  { key: 'property-assessment', to: '/property/assessment', n: 3, title: 'All Property Assessment', desc: 'The four site evaluations', count: 'assessment' },
  { key: 'property-selection', to: '/property/selection', n: 4, title: 'MD Review & Approval', desc: 'One site chosen per project', count: 'selection' },
  { key: 'property-commercial', to: '/property/commercial', n: 5, title: 'All Property Commercial', desc: 'LOI, lease, legal, deposits', count: 'commercial' },
  /* Counted by what is WAITING on an approver, not by how many documents
     exist: this step is an in-tray, and a number that included the ones
     already answered would never go down. */
  { key: 'property-doc-approval', to: '/property/approvals', n: 6, title: 'Document Approvals', desc: 'Submitted documents, approved or sent back', count: 'docreview' },
  /* Counts what is actually PLANNED, not what is eligible — the page lists
     every commercial property so planning can be started, but the stepper
     reports progress, and "13 waiting" would read as 13 done. */
  { key: 'property-planning', to: '/property/planning', n: 7, title: 'All Project Creation', desc: 'Games, opening date, project', count: 'planning' },
];

export function PropertySteps() {
  /**
   * THE RAIL IS PER-PERSON NOW.
   *
   * The whole point of the flow being six steps is that different people own
   * different ones — the team walking sites is not the team signing leases.
   * Until the access policy existed every one of them saw all six and had to
   * know which two were theirs. A step the policy hides is dropped from the
   * rail here, and its route is refused by RequireAccess, so there is no way
   * in through a bookmark either.
   *
   * The NUMBERS ARE NOT RENUMBERED. Somebody who sees only steps 3 and 5
   * still sees them called 3 and 5, because the business calls them that and
   * a person reading "Step 1 - All Property Assessment" on their screen
   * cannot talk to anybody else about it.
   */
  const access = useAccess();
  const steps = STEPS.filter((s) => access.showsStep(s.key));
  /* Asks for ONE row and reads only the `counts` that ride along with it. The
     stepper needs four totals, not a page of data, and the queue is paginated
     now — pulling 25 rows here to count 4 numbers would be a second request's
     worth of payload thrown away on every navigation. */
  const { data } = usePropertyQueue({ limit: 1 });
  const location = useLocation();
  const counts = (data?.counts || data?.data?.counts) ?? {};
  /* Reference material, not the work: open by default, foldable once known. */
  const [flowOpen, setFlowOpen] = useState(true);

  const k = counts;

  /**
   * ONE CHROME FOR ALL SIX STEPS.
   *
   * The approved design is the same header, the same six figures and the same
   * phase rail on every step — so it is built once, here, rather than pasted
   * into six pages that would then drift. Each page keeps its own toolbar,
   * table and footer; everything above them is this.
   *
   * The figures are portfolio-wide on purpose. "How many are rejected" is a
   * fact about the pipeline, not about the step you happen to be standing on,
   * and a strip whose numbers changed as you walked the rail would invite
   * people to read them as the step's own.
   */
  /* The app's own top bar. It was missing from this whole module: six
     screens with no title, no back button, no notification bell and no way
     to sign out. Rendered HERE for the same reason the KPI strip and the
     rail are — one chrome for all six steps, rather than six copies that
     drift. The title names the step the URL is on, read from the same STEPS
     array the rail draws itself from. */
  const current = STEPS.find((s) => location.pathname.startsWith(s.to));

  return (
    <>
      <Topbar title={current ? `Properties — ${current.title}` : 'All Properties'} />
      <div className="pc2">
      <div className="pc2-kpis">
        {/* EVERY property, not phase 1's subset. Labelled "Total Properties"
            it read 29 while the sheet below it listed 54, because it was
            counting only what had not moved past capture yet.

            IT COUNTS THE REJECTED ONES TOO, now that Step 1 lists them. It
            was on `live`, which excluded them — so this tile said 35 while
            the tab beside it said 36 and opened 36 rows, and a total that
            leaves out one of the categories printed next to it is a total
            nobody can check. The Rejected tile is the subtraction. */}
        <Kpi icon={Building2} tone="blue" n={k.all} label="Total Properties" sub="Every property captured, live or rejected" />
        <Kpi icon={CheckCircle2} tone="green" n={k.shortlisted} label="Shortlisted" sub="Ready for next phase" />
        <Kpi icon={Clock} tone="blue" n={k.assessment} label="In Review" sub="Under evaluation" />
        <Kpi icon={XCircle} tone="red" n={k.rejected} label="Rejected" sub="Not moving forward" />
        <Kpi icon={Users} tone="purple" n={k.assigned} label="Assigned" sub="Currently with team" />
        <Kpi icon={FileText} tone="blue" n={k.documentsPending} label="Documents Pending" sub="Require attention" />
        {/* WHERE, NOT HOW MANY. The sheet is one row per location now, so the
            count of rows on screen and the count of properties are different
            numbers and both are right. This is the first of the two, and it
            is the one somebody planning a trip or a review actually asks
            for. */}
        <Kpi icon={MapPin} tone="purple" n={k.locations} label="Locations" sub="Cities with a property" />
      </div>

      <div className="pc2-panel">
        <button type="button" className="pc2-panel-head" onClick={() => setFlowOpen((v) => !v)}>
          {flowOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} />
          <span className="pc2-panel-title">FMS Flow (Optional)</span>
          <span className="pc2-panel-note">
            View the complete phase flow, steps and guidelines for Property Management
          </span>
          {/* Reflects the actual state now: it used to say "View More" and
              show a down-chevron even while open, which read as broken —
              clicking it toggled the panel but the label never agreed. */}
          <span className="pc2-panel-right">
            {flowOpen ? 'View Less' : 'View More'}
            {flowOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>
        {flowOpen && (
          <div className="pc2-panel-body">
            <div className="pc2-rail">
              {steps.map((s, i) => (
                <Fragment key={s.to}>
                  <NavLink
                    to={s.to}
                    className={`pc2-step${location.pathname.startsWith(s.to) ? ' is-on' : ''}`}
                  >
                    <span className="pc2-step-n">{s.n}</span>
                    <span>{s.title}</span>
                    <span className="pc2-step-c">{typeof counts[s.count] === 'number' ? counts[s.count] : '—'}</span>
                  </NavLink>
                  {i < steps.length - 1 && <span className="pc2-rail-arrow" />}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      <Outlet />
      </div>
    </>
  );
}

export default PropertySteps;
