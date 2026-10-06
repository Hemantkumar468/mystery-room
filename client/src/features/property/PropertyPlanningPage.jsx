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
  groupByCity, stackPerSite, PersonName,
} from './propertyUi.jsx';
import {
  serialNumberColumn, sourceColumn, cityColumn, locationColumn,
  propertyBoxesColumn, statusColumn, PropertySheetFooter,
} from './PropertySheet.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { PlanSummaryModal } from './PlanSummaryModal.jsx';
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
 * An approved LOI is the normal automatic hand-off into this step. A manager
 * can still explicitly send an exceptional site here from Step 4, so the LOI
 * is visible as the commitment signal rather than a browser-only lock.
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
const EMPTY_HINT = 'A property reaches this step when its LOI is approved, or when the MD sends it here from Step 4.';

export default function PropertyPlanningPage() {
  const navigate = useNavigate();
  /**
   * WHAT THE MD SENT HERE, not everything in closure.
   *
   * This asked for `commercial`, so a property whose paperwork had merely
   * started stood on the project-creation step beside the ones actually
   * approved for games and dates. The MD's approval is what puts a site here
   * — see `creationScope` in propertyCapture.service.js.
   */
  const q = usePropertyQuery('creation');
  const [media, setMedia] = useState(null);
  /* Which property's full report is open. */
  const [details, setDetails] = useState(null);
  /* Which property's Phase 4 plan form is open, over the row it belongs to. */
  const [planning, setPlanning] = useState(null);
  /* Whose full game list is open. */
  const [gamesOf, setGamesOf] = useState(null);
  /* Whose PLAN is being read — see PlanSummaryModal. View used to open the
     capture report, which is Step 1's report and answers a different
     question than this step asks. */
  const [planOf, setPlanOf] = useState(null);

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
    /**
     * SEVEN COLUMNS, BY REQUEST — and the step reads as a sheet again.
     *
     * It carried twenty: source, status, carpet area, floor, files, LOI,
     * games, confirmed area, construction, handover, opening, trial, budget,
     * monthly running, project manager, site shape, plan notes. Every one of
     * them is a fact about the PLAN, and the plan is a form — so the sheet
     * was a form laid on its side, 3,000px wide, read by scrolling. The
     * question this step answers is "whose plan is this, when is it due, and
     * is it in?"; everything else belongs to the plan itself, which View now
     * opens.
     */
    serialNumberColumn({ page: q.page, limit: q.limit }),
    propertyBoxesColumn({ width: 250, onDetails: setDetails }),
    cityColumn({ width: 140 }),
    locationColumn({ width: 170 }),

    /* Whose plan, by when, and when it landed. 'Done by' is dropped with the
       rest: the plan names its own author inside, and this row has room for
       the three that are read at a glance. */
    ...whoWhenColumns('planning', {
      getPlan: (r) => r.planningPlan,
      getDoneBy: (r) => r.plan?.by,
      getDoneAt: (r) => r.plan?.at,
    }).filter((c) => !/DoneBy$/.test(c.key)),

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
        /* An approved LOI opens an empty p20 draft for the assigned doer.
           That is preparation, not a project that has been added. */
        const added = ['submitted', 'approved', 'locked'].includes(r.plan?.status);
        return (
          <span className="pc2-acts">
            <button
              type="button"
              className={`pc2-act ${added ? 'a-view' : 'a-go'}`}
              onClick={(e) => { e.stopPropagation(); openPlan(r); }}
              title={added
                ? 'Change the games and dates on the project this property created'
                : r.loiFiled
                  ? 'Choose the games and fix the dates — this is what creates the project'
                  : 'The LOI is not filed yet — you can still create the project, but the site is not committed'}
            >
              {/* NAMED AFTER WHAT IT DOES, which is what the step is called.
                  "Plan it" described the form rather than the outcome: this
                  button is how a project comes into existence, and the step
                  above it says "All Project Creation" — two names for one
                  action is one more than anybody should have to learn. */}
              {/* "Edit project" once one exists, not "Added project": the
                  button is a thing you DO, and a past participle on a
                  control reads as a status label somebody made clickable.
                  Whether it was added is already said by the Project column. */}
              {added ? <><Pencil size={12} /> Edit project</> : <><Gamepad2 size={12} /> Create project</>}
            </button>
            <button
              type="button"
              className="pc2-act"
              onClick={(e) => { e.stopPropagation(); setPlanOf(r); }}
              title="Read the plan — the games chosen and the construction, handover, trial and opening dates"
            >
              <Eye size={12} /> View
            </button>
          </span>
        );
      },
    },
  ], [navigate]);

  const perSiteKeys = useMemo(() => [
    'source', 'locality', 'planningAssigned', 'planningDoneBy', 'planningPlanDate', 'planningDoneAt',
    'area', 'floor', 'files', 'loi', 'games',
    'confirmedArea', 'construction', 'handover', 'opening', 'trial',
    'action',
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

      {details && <PropertyDetailsModal row={details} showPlanning onClose={() => setDetails(null)} />}

      {gamesOf && <GamesModal row={gamesOf} onClose={() => setGamesOf(null)} />}

      {/* The plan, read-only, with the way into the form it describes — so
          somebody who opens it to check a date and finds one wrong does not
          have to close it and hunt for the right row again. */}
      {planOf && (
        <PlanSummaryModal
          row={planOf}
          onClose={() => setPlanOf(null)}
          onEdit={(r) => { setPlanOf(null); openPlan(r); }}
        />
      )}

      {planning && (
        <PropertyPlanModal
          row={planning}
          onClose={() => setPlanning(null)}
          onSaved={() => {
            q.refetch?.();
            setPlanning(null);
          }}
        />
      )}
    </>
  );
}
