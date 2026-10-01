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
  filesColumn, fmtDate, SourceBadge,
  groupByCity, stackPerSite,
} from './propertyUi.jsx';
import {
  serialNumberColumn, sourceColumn, cityColumn, locationColumn,
  propertyBoxesColumn, statusColumn,
} from './PropertySheet.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { AssessmentDetailModal } from './AssessmentDetailModal.jsx';

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
/** The most recently filed of a property's assessments - the step's real
 *  "done by" and "done on", since the step finishes when the last one lands. */
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
  /* Which assessment is being read in full — see AssessmentDetailModal. */
  const [reading, setReading] = useState(null);

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
    'assessments', 'source', 'locality', 'files', 'submittedBy', 'project', 'action',
    'assessmentAssigned', 'assessmentDoneBy', 'assessmentPlanDate', 'assessmentDoneAt',
    ...ASSESSMENTS.flatMap((a) => [
      `${a.key}_score`, `${a.key}_form`, `${a.key}_notes`, `${a.key}_headline`,
      `${a.key}_by`, `${a.key}_files`, `${a.key}_at`,
    ]),
  ], []);

  const columns = useMemo(() => [
    serialNumberColumn({ page: q.page, limit: q.limit }),
    /* The shared width, not a narrower local one: 130px cut "Company Owned"
       on these four steps while the same badge fitted on the other three. */
    sourceColumn(),
    cityColumn({ width: 140 }),
    locationColumn({ width: 150 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),
    statusColumn(),

    /**
     * HOW FAR THROUGH THE FOUR THIS PROPERTY IS
     */
    {
      key: 'assessments', label: 'A/NO', width: 70, sort: true,
      render: (r) => {
        const slots = r.assessmentSlots || [];
        const asked = slots.filter((a) => a.state !== 'not_routed');
        const done = asked.filter((a) => a.state === 'filed').length;
        const total = asked.length;

        if (!total) {
          return <span className="prop-assess-no is-none" title="No assessment has been asked for yet">—</span>;
        }

        const skipped = slots.filter((a) => a.state === 'not_routed');
        return (
          <span
            className={`prop-assess-no${done === total ? ' is-done' : ''}`}
            title={`${done} of ${total} asked-for assessment${total === 1 ? '' : 's'} filed`
              + (skipped.length ? ` — ${skipped.map((a) => a.label).join(', ')} not asked for` : '')}
          >
            {done}/{total}
          </span>
        );
      },
    },

    /* NO PROPERTY-LEVEL "Assigned / Done by / Plan date / Actual date".
       They live inside each assessment band now, right after its Form —
       four assessments are four owners working to four dates, and one
       aggregate set of them ("Ananya Das +3" against a single plan date)
       answered none of the questions this step is actually read for. It
       also sat BEFORE the bands, so the name on screen was never the name
       for the assessment being read. See assessmentColumns in
       AssessmentScoreCell.jsx. */

    /* EACH ASSESSMENT, IN FULL — score, what it was for, its headline figure,
       who answered it and when. Five columns apiece, banded under the
       assessment's name by PropTable's group row, because "By" and "On" mean
       nothing on their own when there are four of each.

       Empty until that assessment comes back, filling in one at a time, which
       is the whole point of the column.

       NOT SORTABLE: sorting runs on the server against a whitelist (SORT_KEYS)
       and none of these keys are in it. */
    ...ASSESSMENTS.flatMap((a) => assessmentColumns(
      a,
      openForm,
      (row, at) => setMedia({ row, at }),
      /* "See more" on the prose cell — opens that assessment in full. */
      (row, type, entry) => setReading({ row, type, entry }),
    )),

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
    /* NO PROJECT COLUMN. Removed by request: it was a link out of the queue
       into the project tree, on a page whose whole subject is the PROPERTY,
       and the two read as the same thing to somebody scanning a row - a
       property called "relinent plaza" sitting beside a project called
       "Mystery Rooms — ..." invites the reader to wonder which one this row
       is about. The property's own name and city already say where the work
       is; the project is one click away through View. */

    /* THE ACTION, LAST AND PINNED. Last because a row has to be read
       before it can be answered — leading with two buttons asks for the
       decision before the facts it turns on. Pinned because being last on
       a table this wide would otherwise mean scrolling to reach it; see
       `pin: 'right'` in PropTable.jsx. */
    {
      key: 'action', pin: 'right', label: 'Action', width: 190, align: 'center',
      render: (r, _i, group) => (
        <span className="pc2-acts" style={{ justifyContent: 'center', width: '100%', display: 'flex' }}>
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

      {/* Step 3 - this step IS the four assessments, so the report carries them. */}
      {details && (
        <PropertyDetailsModal
          row={details}
          showAssessments
          onClose={() => setDetails(null)}
          /* Edit goes where the row's own Edit goes - the Site Evaluation
             form, with every assessment on it. */
          onEdit={(r) => {
            setDetails(null);
            if (r.projectId && r.recordId) navigate(`/projects/${r.projectId}/site-evaluation/${r.recordId}`);
          }}
        />
      )}

      {reading && (
        <AssessmentDetailModal
          row={reading.row}
          type={reading.type}
          entry={reading.entry}
          onClose={() => setReading(null)}
        />
      )}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
    </>
  );
}
