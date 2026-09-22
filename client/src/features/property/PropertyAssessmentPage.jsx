import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThumbsUp, ThumbsDown, AlertTriangle } from 'lucide-react';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import { assessmentColumns } from './AssessmentScoreCell.jsx';
import {
  PropertyCell, ContactCell, PropertyToolbar, PageHead, PropEmpty,
  filesColumn, fmtDate, PlanDateCell,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyVerdictModal } from './PropertyVerdictModal.jsx';
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
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.manage(user?.role);

  const q = usePropertyQuery('assessment');
  const [media, setMedia] = useState(null);
  /* `{ row, choice }` — which property is being decided, and which answer was
     pressed on its row. */
  const [verdict, setVerdict] = useState(null);
  /* Which property's report is open — the same one Step 1 shows. */
  const [details, setDetails] = useState(null);

  /** The existing Site Evaluation form, opened on one assessment. */
  const openForm = (row, type) => {
    if (!row.projectId || !row.recordId) return;
    navigate(`/projects/${row.projectId}/site-evaluation/${row.recordId}?form=${type}`);
  };

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

    /* WHERE, THEN WHAT — the same two columns in the same order as Step 1, so
       a row reads identically whichever step it is being worked in. */
    {
      key: 'city', label: 'Location', width: 175, sort: true,
      render: (r) => {
        const sub = [r.locality, r.address].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' \u00b7 ');
        if (!r.city && !sub) return <span className="prop-dim">-</span>;
        return (
          <>
            <div className="prop-name" title={r.city}>{r.city || '\u2014'}</div>
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
          </>
        );
      },
    },
    { key: 'title', label: 'Property', width: 220, sort: true, render: (r) => <PropertyCell row={r} /> },

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
    ...ASSESSMENTS.flatMap((a) => assessmentColumns(a, openForm)),

    filesColumn((row, at) => setMedia({ row, at })),
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
      key: 'action', pin: 'right', label: 'Action', width: 210,
      render: (r) => {
        const ready = r.assessmentsComplete;
        const pending = r.assessments.length - r.assessmentsFiled;
        /**
         * NOTHING FILED YET — there is nothing here to say yes to.
         *
         * Shortlisting opens six commercial documents and commits the team to
         * a site. Over a property whose assessments are all still blank that
         * is a yes about nothing: no score, no finding, nobody has been. The
         * row offered it anyway, and the tooltip actively encouraged it
         * ("you can still shortlist it"), so a property could reach commercial
         * closure without one evaluation ever being filed against it.
         *
         * Reject stays live on purpose — a property dies for reasons that have
         * nothing to do with the assessments (owner withdraws, rent moves),
         * the reject dialog already demands that reason in writing, and gating
         * it too would leave a dead property with no way out of the queue.
         */
        const nothingFiled = !r.assessmentsFiled;
        return (
          <div className="prop-action-cell is-grid">
            {/* THE SAME TWO ANSWERS AS STEP 1, said the same way. This step
                used to offer one button called "Decide", which named the
                dialog rather than the decision; the two answers are what the
                reader has in mind, and they are the same two the queue before
                this one asks for. */}
            {canDecide ? (
              <>
                <button
                  type="button"
                  className={`prop-action-btn${ready ? '' : ' is-quiet'}`}
                  disabled={nothingFiled}
                  onClick={() => setVerdict({ row: r, choice: 'shortlist' })}
                  title={nothingFiled
                    ? 'Nothing has been assessed yet. Open an assessment from its cell and file it — shortlisting turns on with the first one.'
                    : ready
                      ? 'Take it forward — it moves to commercial closure'
                      : `${pending} assessment(s) still outstanding — you can shortlist on what is in`}
                >
                  <ThumbsUp size={12} /> Shortlist
                </button>
                <button
                  type="button" className="prop-action-btn is-danger"
                  onClick={() => setVerdict({ row: r, choice: 'reject' })}
                  title="Take it off the table, with a reason"
                >
                  <ThumbsDown size={12} /> Reject
                </button>
              </>
            ) : <button type="button" className="prop-action-btn is-quiet" disabled>View only</button>}
            {/* Always available, and especially when the decision is not:
                the answer to "why can I not shortlist this?" is inside the
                report, so the way in must not disappear with the buttons. */}
            <button
              type="button"
              className="prop-open"
              onClick={() => setDetails(r)}
              title="Read the whole property report here, without leaving the queue"
            >
              View Details
            </button>
            {/* Said on the row, not only in a tooltip — a disabled button with
                no stated reason reads as a broken button. */}
            {canDecide && nothingFiled && (
              <span className="prop-action-warn">
                <AlertTriangle size={11} /> Not assessed yet
              </span>
            )}
          </div>
        );
      },
    },
  ], [canDecide, navigate]);

  return (
    <>
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

      {verdict && (
        <PropertyVerdictModal
          row={verdict.row}
          initialChoice={verdict.choice}
          onClose={() => setVerdict(null)}
          onDone={(result) => {
            setVerdict(null);
            if (result?.nextStage === 'commercial') navigate('/property/commercial');
          }}
        />
      )}

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
    </>
  );
}
