import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, PenSquare } from 'lucide-react';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import { PropertyPlanModal } from './PropertyPlanModal.jsx';
import { GamesCell, GamesModal } from './GamesCell.jsx';
import {
  PropertyCell, PropertyToolbar, PageHead, PropEmpty, Badge,
  filesColumn, whoWhenColumns, fmtDate,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';

/**
 * Step 4 — Project & Games Planning.
 *
 * WHAT THIS STEP IS. Phase 4 (`p20`, "Project Planning & Games") already owns
 * this work: which games the outlet will hold, the opening date, the trial run.
 * The form was built once, in the project, and this page links to it rather
 * than growing a second copy. The same is true of Project Creation, which is
 * the `project_creation` document filed in commercial closure.
 *
 * THE LOI IS A SIGNAL, NOT A GATE, and that is the point of the design. Signed
 * and uploaded, the site is committed and planning it is safe — the row leads
 * with it. But a landlord who takes three weeks to sign should not stop us
 * choosing games for a site we are sure about, so the button works either way
 * and simply warns when the LOI is not in yet. A hard lock here would mean the
 * one thing the client asked for could not happen.
 *
 * EVERY COMMERCIAL PROPERTY IS LISTED, not only the ones already being
 * planned. This step is where you come to START planning, so a property with
 * no plan yet is exactly the row you are looking for.
 */
/** Sorts a date column by its real instant, not by the text we print. */
const dateValue = (d) => {
  if (!d) return null;
  const t = new Date(d).valueOf();
  return Number.isNaN(t) ? null : t;
};

/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'A property reaches this step once it is in commercial closure.';

export default function PropertyPlanningPage() {
  const navigate = useNavigate();
  const q = usePropertyQuery('commercial');
  const [media, setMedia] = useState(null);
  /* Which property's Phase 4 plan form is open, over the row it belongs to. */
  const [planning, setPlanning] = useState(null);
  /* Whose full game list is open. */
  const [gamesOf, setGamesOf] = useState(null);

  /**
   * Phase 4's own form — games, opening date, trial run — opened HERE.
   *
   * It used to navigate to `/projects/:id?stage=p20`, which lands on the whole
   * phase and leaves the reader to find the form and work out which property
   * it is about. They asked for a form; they were given a page, and lost the
   * queue they were working through on the way.
   */
  const openPlan = (r) => setPlanning(r);
  /** The Project Creation document, filed in commercial closure. */
  const openCreation = (r) => navigate(`/projects/${r.projectId}/commercial-finalization?form=project_creation`);
  /** The Design & Drawings FMS dashboard for this site's project — Phase 5's
      37-drawing checklist, across the same project this row's plan belongs to.
      Only meaningful once a project exists (drawings are project-scoped). */
  const openDrawings = (r) => navigate(`/design-drawings/${r.projectId}`);

  const columns = useMemo(() => [
    /* Who is running the Phase 4 form for this outlet, and whether "Fill the
       project plan" is still on schedule — the one task that stage has. */
    /* Who owns the plan, by when, and who filed it — Step 6's planned against
       actual, in the same four columns as every step before it. */
    ...whoWhenColumns('planning', {
      getPlan: (r) => r.planningPlan,
      getDoneBy: (r) => r.plan?.by,
      getDoneAt: (r) => r.plan?.at,
    }),
    { key: 'title', label: 'Property', width: 235, sort: true, render: (r) => <PropertyCell row={r} /> },
    filesColumn((row, at) => setMedia({ row, at })),
    { key: 'city', label: 'City', width: 100, sort: true, render: (r) => r.city || <span className="prop-dim">—</span> },
    {
      key: 'loi', label: 'LOI', width: 112,
      /* Signed outranks uploaded outranks nothing — sorting this column should
         bring the committed sites to the top, not alphabetise three words. */
      sort: true,
      render: (r) => (r.loiDone ? <Badge kind="captured">Signed</Badge>
        : r.loiFiled ? <Badge kind="commercial">Uploaded</Badge>
          : <Badge kind="wanted">Not filed</Badge>),
    },
    {
      key: 'games', label: 'Games', width: 250, sort: true,
      render: (r) => <GamesCell row={r} onOpen={setGamesOf} />,
    },
    /* The area the plan CONFIRMED, which is what the games were chosen
       against — it can differ from the area the property was captured at, and
       when it does, that difference is the story of the row. */
    {
      key: 'area', label: 'Confirmed area', width: 130,
      render: (r) => (r.plan?.confirmedArea
        ? `${Number(r.plan.confirmedArea).toLocaleString('en-IN')} sq ft`
        : <span className="prop-dim">—</span>),
    },
    {
      key: 'construction', label: 'Construction', width: 125,
      render: (r) => fmtDate(r.plan?.constructionStart) || <span className="prop-dim">—</span>,
    },
    {
      key: 'handover', label: 'Handover', width: 120,
      render: (r) => fmtDate(r.plan?.handoverDate) || <span className="prop-dim">—</span>,
    },
    {
      key: 'opening', label: 'Opening', width: 106, sort: true,
      render: (r) => fmtDate(r.plan?.openingDate) || <span className="prop-dim">—</span>,
    },
    {
      key: 'trial', label: 'Trial run', width: 106, sort: true,
      render: (r) => fmtDate(r.plan?.trialDate) || <span className="prop-dim">—</span>,
    },
    {
      key: 'project', label: 'Project', width: 158, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">—</span>),
    },

    /* THE ACTION, LAST AND PINNED. Last because a row has to be read
       before it can be answered — leading with two buttons asks for the
       decision before the facts it turns on. Pinned because being last on
       a table this wide would otherwise mean scrolling to reach it; see
       `pin: 'right'` in PropTable.jsx. */
    {
      key: 'action', pin: 'right', label: 'Action', width: 380,
      render: (r) => {
        const planned = Boolean(r.plan);
        return (
          <div className="prop-action-cell">
            <button
              type="button"
              className={`prop-action-btn${r.loiFiled || planned ? '' : ' is-quiet'}`}
              onClick={() => openPlan(r)}
              title={r.loiFiled
                ? 'Choose games and fix the dates'
                : 'The LOI is not filed yet — you can still plan, but the site is not committed'}
            >
              <Gamepad2 size={13} /> {planned ? 'Open the plan' : 'Plan games & dates'}
            </button>
            <button type="button" className="prop-open" onClick={() => openCreation(r)} title="The Project Creation document">
              Create ›
            </button>
            {r.projectId && (
              <button
                type="button"
                className="prop-open"
                onClick={() => openDrawings(r)}
                title="Design & Drawings FMS — the 37-drawing checklist dashboard for this project"
              >
                <PenSquare size={12} /> Drawings
              </button>
            )}
          </div>
        );
      },
    },
  ], [navigate]);

  return (
    <>
      <PageHead
        title="Signed and shortlisted sites"
        subtitle="Choose the games, fix the opening date, and create the project."
      />
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : q.rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing here yet'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <PropTable
                columns={columns}
                rows={q.rows}
                rowKey={(r) => r.id}
                sort={q.sort}
                onSort={q.toggleSort}
                busy={q.isFetching}
              />
              <PropPager
                page={q.page}
                totalPages={q.totalPages}
                total={q.total}
                limit={q.limit}
                onPage={q.setPage}
                onLimit={q.setLimit}
              />
            </>
          )}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}

      {gamesOf && <GamesModal row={gamesOf} onClose={() => setGamesOf(null)} />}

      {planning && (
        <PropertyPlanModal
          row={planning}
          onClose={() => setPlanning(null)}
          onSaved={() => setPlanning(null)}
        />
      )}
    </>
  );
}
