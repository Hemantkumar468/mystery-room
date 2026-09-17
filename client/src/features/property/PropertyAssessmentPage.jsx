import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
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
  filesColumn, planColumns,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyVerdictModal } from './PropertyVerdictModal.jsx';

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
  const [verdict, setVerdict] = useState(null);

  /** The existing Site Evaluation form, opened on one assessment. */
  const openForm = (row, type) => {
    if (!row.projectId || !row.recordId) return;
    navigate(`/projects/${row.projectId}/site-evaluation/${row.recordId}?form=${type}`);
  };

  const columns = useMemo(() => [
    {
      key: 'action', label: 'Action', width: 224,
      render: (r) => {
        const ready = r.assessmentsComplete;
        const pending = r.assessments.length - r.assessmentsFiled;
        return (
          <div className="prop-action-cell">
            {canDecide ? (
              <button
                type="button"
                className={`prop-action-btn${ready ? ' is-done' : ''}`}
                onClick={() => setVerdict(r)}
                title={ready ? 'Shortlist or reject this property' : `${pending} assessment(s) still to be filed`}
              >
                {ready ? <><Check size={13} /> Decide</> : `Decide · ${pending} left`}
              </button>
            ) : <button type="button" className="prop-action-btn is-quiet" disabled>View only</button>}
            <button
              type="button" className="prop-open"
              onClick={() => navigate(`/projects/${r.projectId}/site-evaluation/${r.recordId}`)}
            >
              Open ›
            </button>
          </div>
        );
      },
    },
    /* Who is doing this step's work, and whether the date is holding — see
       propertyCapture.service.js#planFrom. Right of Action, per how this step
       is actually read: "whose job is this, and are we on track" is the next
       thing anybody asks after "what do I click." */
    ...planColumns('assessment', (r) => r.assessmentPlan),
    { key: 'title', label: 'Property', width: 230, sort: true, render: (r) => <PropertyCell row={r} /> },
    filesColumn(setMedia),
    { key: 'city', label: 'City', width: 100, sort: true, render: (r) => r.city || <span className="prop-dim">—</span> },

    /* EACH ASSESSMENT, IN FULL — score, what it was for, its headline figure,
       who answered it and when. Five columns apiece, banded under the
       assessment's name by PropTable's group row, because "By" and "On" mean
       nothing on their own when there are four of each.

       Empty until that assessment comes back, filling in one at a time, which
       is the whole point of the column.

       NOT SORTABLE: sorting runs on the server against a whitelist (SORT_KEYS)
       and none of these keys are in it. They previously carried a dead `sort`
       function that still made the header offer itself as sortable and then
       404 the request. */
    ...ASSESSMENTS.flatMap((a) => assessmentColumns(a, openForm)),

    {
      key: 'assessments', label: 'Progress', width: 100,
      sort: true,
      render: (r) => (
        <>
          <div className="prop-progress" title={`${r.assessmentsFiled} of ${r.assessments.length} filed`}>
            <span style={{ width: `${r.assessments.length ? (r.assessmentsFiled / r.assessments.length) * 100 : 0}%` }} />
          </div>
          <span className="prop-dim">{r.assessmentsFiled}/{r.assessments.length}</span>
        </>
      ),
    },
    { key: 'submittedBy', label: 'Submitted by', width: 148, sort: true, render: (r) => <ContactCell row={r} /> },
    {
      key: 'project', label: 'Project', width: 158, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">—</span>),
    },
  ], [canDecide, navigate]);

  return (
    <>
      <PageHead
        title="Properties being assessed"
        subtitle="Open a form from its cell, then shortlist or reject the property."
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

      {verdict && (
        <PropertyVerdictModal
          row={verdict}
          onClose={() => setVerdict(null)}
          onDone={(result) => {
            setVerdict(null);
            if (result?.nextStage === 'commercial') navigate('/property/commercial');
          }}
        />
      )}

      {media && <PropertyMediaModal row={media} onClose={() => setMedia(null)} />}
    </>
  );
}
