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
import {
  PropertyCell, ContactCell, PropertyToolbar, PageHead, PropEmpty,
  filesColumn,
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
const cellState = (a) => {
  if (!a) return 'none';
  if (a.status === 'approved' || a.status === 'locked') return 'done';
  if (a.status === 'draft') return 'open';
  return 'filed';
};

const LABEL = { none: 'Not asked', open: 'Open form', filed: 'Filed', done: 'Passed' };

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
                className={`prop-action-btn${ready ? '' : ' is-quiet'}`}
                onClick={() => setVerdict(r)}
                title={ready ? 'Shortlist or reject this property' : `${pending} assessment(s) still to be filed`}
              >
                {ready ? 'Decide' : `Decide · ${pending} left`}
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
    { key: 'title', label: 'Property', width: 230, sort: true, render: (r) => <PropertyCell row={r} /> },
    filesColumn(setMedia),
    { key: 'city', label: 'City', width: 100, sort: true, render: (r) => r.city || <span className="prop-dim">—</span> },

    ...ASSESSMENTS.map((a) => ({
      key: a.key,
      label: a.label,
      width: 104,
      sort: (r) => STATE_RANK[cellState(new Map(r.assessments.map((x) => [x.type, x])).get(a.key))],
      render: (r) => {
        const state = cellState(r.assessments.find((x) => x.type === a.key));
        return (
          <button
            type="button"
            className={`prop-doc is-${state}`}
            disabled={state === 'none'}
            onClick={() => openForm(r, a.key)}
            title={state === 'none' ? 'This assessment was not asked for' : `${a.label} — ${LABEL[state]}`}
          >
            {state === 'done' && <Check size={11} />}
            {LABEL[state]}
          </button>
        );
      },
    })),

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
