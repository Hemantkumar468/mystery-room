import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Pencil } from 'lucide-react';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import { assessmentColumns } from './AssessmentScoreCell.jsx';
import {
  ContactCell, PropertyToolbar, PageHead, PropEmpty,
  filesColumn, fmtDate, PlanDateCell,
  groupByCity, stackPerSite,
} from './propertyUi.jsx';
/* The location row and its numbered property boxes, from the one place they
   are declared - the same cells Steps 1 and 2 render. */
import { locationColumn, propertyBoxesColumn } from './PropertySheet.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';

/**
 * Step 2 — Assessment.
 *
 * One column per assessment, so the table answers the only question this step
 * has: which of the four are in, and is this property ready to be decided?
 * A cell IS the form — clicking it opens the EXISTING Site Evaluation form on
 * that assessment. Those forms were built once, in the project, and this page
 * links to them rather than growing a second copy that would drift.
 *
 * THE VERDICT UNLOCKS WHEN THE ASKED-FOR ASSESSMENTS ARE IN, which is the rule
 * the client described as "when the four assessments are passed it goes for
 * commercial". Counted against what was asked for, not against four: a
 * property routed to two is ready on two. Until then the button says what is
 * still outstanding rather than sitting there greyed out with no reason.
 */
/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'Route a property from Step 1 and it appears here.';

export default function PropertyAssessmentPage() {
  const navigate = useNavigate();
  /* NO ROLE CHECK LEFT ON THIS STEP. It had one because it offered a verdict;
     reading the assessments and correcting a form are not the MD's alone, and
     the routes behind both enforce their own access. */

  const q = usePropertyQuery('assessment');
  const [media, setMedia] = useState(null);
  /* Which property's report is open — the same one Step 1 shows. */
  const [details, setDetails] = useState(null);

  /** The existing Site Evaluation form, opened on one assessment. */
  const openForm = (row, type) => {
    if (!row.projectId || !row.recordId) return;
    navigate(`/projects/${row.projectId}/site-evaluation/${row.recordId}?form=${type}`);
  };

  /**
   * EVERY COLUMN ON THIS SHEET EXCEPT THE LOCATION BELONGS TO ONE PROPERTY.
   *
   * A location row stands for several, so each of these renders one value per
   * property, stacked to the same fixed line height as the numbered boxes.
   * The four assessments contribute five columns each - score, purpose,
   * finding, who, when - and every one of them is a fact about a single site:
   * two properties in Bhopal have two different feasibility scores, and one
   * number across both would be wrong about one of them.
   */
  const perSiteKeys = useMemo(() => [
    'assessments', 'assessmentPlanDate', 'files', 'submittedBy', 'project', 'action',
    ...ASSESSMENTS.flatMap((a) => [
      `${a.key}_score`, `${a.key}_purpose`, `${a.key}_headline`,
      `${a.key}_by`, `${a.key}_files`, `${a.key}_at`,
    ]),
  ], []);

  const columns = useMemo(() => [
    /**
     * HOW FAR THROUGH THE FOUR THIS PROPERTY IS — first, before the action.
     *
     * This step's whole question is "which of the assessments are in?", and it
     * was answerable only by reading four columns 1,200px apart or by finding
     * the Progress column at the far end of the row. As the first thing on the
     * row it is read before anything else is clicked, which is when it is
     * actually wanted. Counted against what was ASKED FOR, not against four: a
     * property routed to two assessments is 1/2, not 1/4.
     */
    {
      key: 'assessments', label: '#', width: 74, sort: true,
      render: (r) => {
        const slots = r.assessmentSlots || [];
        const done = slots.filter((a) => a.state === 'filed').length;
        const total = slots.length || ASSESSMENTS.length;
        return (
          <span
            className={`prop-assess-no${done === total ? ' is-done' : ''}`}
            /* OUT OF FOUR, always. The phase HAS four assessments; a property
               that has only been sent down one is not "1 of 1 and finished",
               it is one of four with three not started, and the two states
               looked identical when the denominator moved. */
            title={`${done} of ${total} assessments filed${
              slots.filter((a) => a.state === 'not_routed').length
                ? ` — ${slots.filter((a) => a.state === 'not_routed').map((a) => a.label).join(', ')} not started`
                : ''}`}
          >
            {done}/{total}
          </span>
        );
      },
    },

    /* WHERE, THEN WHAT - the same two cells in the same order as Steps 1 and
       2, and now literally the same code. Bhopal appeared twice on this step,
       once per property, which is the thing those steps stopped doing: the
       location is the row, its properties are listed and numbered inside it,
       and everything to the right lines up with the box it belongs to. */
    locationColumn({ width: 175 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),

    /* Who owns each assessment is INSIDE each assessment's own band now — one
       "Assign person" column per assessment, beside its score. A single cell
       carrying all four said four names with no way to tell which was which
       piece of work; the band it belongs to says it without a word. */
    /* The step's own plan date, from its real tasks — the one date that covers
       all four, so "is this step on schedule" is answerable without reading
       four chips.

       Its usual companion, the aggregate "Assigned" column, is NOT here: it
       said "Ananya Das +2" for a step whose whole point is that four named
       people own four different pieces, and the chips to its left already say
       which piece is whose. */
    {
      key: 'assessmentPlanDate', label: 'Plan Date', width: 108,
      render: (r) => <PlanDateCell plan={r.assessmentPlan} />,
    },

    /* EACH ASSESSMENT, IN FULL — score, what it was for, its headline figure,
       who answered it and when. Five columns apiece, banded under the
       assessment's name by PropTable's group row, because "By" and "On" mean
       nothing on their own when there are four of each.

       Empty until that assessment comes back, filling in one at a time, which
       is the whole point of the column.

       NOT SORTABLE: sorting runs on the server against a whitelist (SORT_KEYS)
       and none of these keys are in it. */
    ...ASSESSMENTS.flatMap((a) => assessmentColumns(a, openForm, (row, at) => setMedia({ row, at }))),

    /* THE PROPERTY'S OWN FILES, named as such. Four assessments now carry a
       Files column each, and a fifth one headed the same word - sitting past
       all of them - reads as a fifth assessment's. This is what was attached
       when the site was captured. */
    {
      ...filesColumn((row, at) => setMedia({ row, at })),
      label: 'Property files',
      width: 190,
    },
    { key: 'submittedBy', label: 'Submitted by', width: 148, sort: true, render: (r) => <ContactCell row={r} /> },
    {
      key: 'project', label: 'Project', width: 158, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">-</span>),
    },

    /* THE ACTION, LAST AND PINNED. Last because a row has to be read
       before it can be answered — leading with two buttons asks for the
       decision before the facts it turns on. Pinned because being last on
       a table this wide would otherwise mean scrolling to reach it; see
       `pin: 'right'` in PropTable.jsx. */
    {
      key: 'action', pin: 'right', label: 'Action', width: 190,
      /**
       * NO VERDICT ON THIS STEP. READ IT, OR FIX IT.
       *
       * Shortlist and Reject were here, and they did not belong. This step's
       * job is the four assessments: who was sent, what they found, what is
       * still outstanding. The decision that follows from them is Step 4's,
       * where the MD reads all four left to right and then says commercial or
       * project creation - and offering the same verdict a step early meant it
       * could be taken before the evidence it turns on had arrived, from a
       * screen that does not lay that evidence out for comparison.
       *
       * What is left is the two things somebody actually does here.
       */
      render: (r, _i, group) => (
        <span className="pc2-acts">
          <button
            type="button"
            className="pc2-act a-view"
            /* OPENED ON THIS PROPERTY, CARRYING THE WHOLE LOCATION - the
               report lists every site in the location with its four
               assessments under it. */
            onClick={(e) => {
              e.stopPropagation();
              setDetails(group?.siblings ? { ...r, siblings: group.siblings } : r);
            }}
            title="Read the whole report here — this location’s properties and all four assessments of each"
          >
            <Eye size={12} /> View
          </button>
          {/* EDIT OPENS THE FORM, NOT A FIELD. The Site Evaluation form holds
              all four assessments; the ones already filed open filled, the
              rest open blank, and any of them can be corrected. Opening it
              without `?form=` lands on the whole form rather than on one
              assessment, which is what "edit this property's assessments"
              means when two of four are in. */}
          <button
            type="button"
            className="pc2-act"
            disabled={!r.projectId || !r.recordId}
            onClick={(e) => {
              e.stopPropagation();
              if (r.projectId && r.recordId) {
                navigate(`/projects/${r.projectId}/site-evaluation/${r.recordId}`);
              }
            }}
            title={r.recordId
              ? 'Open the Site Evaluation form — filled assessments open filled, the rest open blank'
              : 'No property record yet, so there is no form to open'}
          >
            <Pencil size={12} /> Edit
          </button>
        </span>
      ),
    },
  ], [navigate]);

  const perSite = useMemo(() => stackPerSite(columns, perSiteKeys), [columns, perSiteKeys]);
  /* One row per location, its properties listed inside it - the same fold
     Steps 1 and 2 use, from the same helper. */
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
              <PropTable
                columns={perSite}
                rows={rows}
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

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
    </>
  );
}
