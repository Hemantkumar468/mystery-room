import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Eye, Pencil } from 'lucide-react';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { PropertyPlanModal } from './PropertyPlanModal.jsx';
import { GamesCell, GamesModal } from './GamesCell.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty, Badge,
  filesColumn, whoWhenColumns, fmtDate, SourceBadge,
  groupByCity, stackPerSite,
} from './propertyUi.jsx';
/* The location row and its numbered property boxes - the same two cells every
   other step renders, from the one place they are declared. */
import { locationColumn, propertyBoxesColumn, PropertySheetFooter } from './PropertySheet.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
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
  /* Which property's full report is open. */
  const [details, setDetails] = useState(null);
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
  const columns = useMemo(() => [
    /* Location and its properties lead the table and stick on the left edge */
    locationColumn({ width: 180 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),
    { key: 'source', label: 'Source', width: 130, sort: true, render: (r) => <SourceBadge source={r.source} /> },

    /* Who owns the plan, by when, and who filed it — Step 6's planned against
       actual, the four pillars for this step. */
    ...whoWhenColumns('planning', {
      getPlan: (r) => r.planningPlan,
      getDoneBy: (r) => r.plan?.by,
      getDoneAt: (r) => r.plan?.at,
    }),
    {
      /* The area the site was CAPTURED at - what the games are being chosen
         against until the plan confirms its own. */
      key: 'area', label: 'Carpet area', width: 128,
      render: (r) => (r.areaSqft ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : <span className="prop-dim">—</span>),
    },
    { key: 'floor', label: 'Floor', width: 84, render: (r) => r.floor || <span className="prop-dim">—</span> },
    filesColumn((row, at) => setMedia({ row, at })),
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
      key: 'confirmedArea', label: 'Confirmed area', width: 130,
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
      key: 'action', pin: 'right', label: 'Action', width: 232,
      /**
       * TWO CONTROLS. THE FORM, AND THE REPORT.
       *
       * There were four: Plan games & dates, Create (the Project Creation
       * document) and Drawings (the 37-drawing checklist on another module
       * entirely). The last two do not belong on this step. Drawings is a
       * different FMS with its own dashboard, and putting a door to it at the
       * end of every row here made this step look like a menu of other places
       * rather than the one thing it is for; Create opened a second form that
       * asks for what the plan form already asks for.
       *
       * What is left is the plan form - which fetches the area, offers the
       * games as tick-boxes and takes the construction, handover, opening and
       * trial dates - and the report, for reading the property it is about.
       * Everything the columns show empty is filled by that one form.
       */
      render: (r, _i, group) => {
        const planned = Boolean(r.plan);
        return (
          <span className="pc2-acts">
            <button
              type="button"
              className={`pc2-act ${planned ? 'a-view' : 'a-go'}`}
              onClick={(e) => { e.stopPropagation(); openPlan(r); }}
              title={r.loiFiled
                ? 'Choose the games and fix the dates — the form fills these columns'
                : 'The LOI is not filed yet — you can still plan, but the site is not committed'}
            >
              {planned ? <><Pencil size={12} /> Edit plan</> : <><Gamepad2 size={12} /> Plan it</>}
            </button>
            <button
              type="button"
              className="pc2-act"
              onClick={(e) => {
                e.stopPropagation();
                setDetails(group?.siblings ? { ...r, siblings: group.siblings } : r);
              }}
              title="Read the whole report — this location’s properties and what was captured for each"
            >
              <Eye size={12} /> View
            </button>
          </span>
        );
      },
    },
  ], [navigate]);

  /** Everything except the location belongs to one property. */
  const perSiteKeys = useMemo(() => [
    'source', 'planningAssigned', 'planningDoneBy', 'planningPlanDate', 'planningDoneAt',
    'area', 'floor', 'files', 'loi', 'games',
    'confirmedArea', 'construction', 'handover', 'opening', 'trial',
    'project', 'action',
  ], []);

  const perSite = useMemo(() => stackPerSite(columns, perSiteKeys), [columns, perSiteKeys]);
  const rows = useMemo(() => groupByCity(q.rows), [q.rows]);

  return (
    <>
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing here yet'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <div className="pc2-tablewrap">
              <PropTable
                columns={perSite}
                rows={rows}
                rowKey={(r) => r.id}
                sort={q.sort}
                onSort={q.toggleSort}
                busy={q.isFetching}
              />
              </div>
              <PropertySheetFooter q={q} />
            </>
          )}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

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
