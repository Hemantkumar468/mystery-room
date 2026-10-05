import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Pencil } from 'lucide-react';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import { assessmentRowColumns } from './AssessmentScoreCell.jsx';
import { assessmentRows, propertiesOf } from './assessmentRows.jsx';
import {
  ContactCell, PropertyToolbar, PropEmpty, SourceBadge,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { AssessmentDetailModal } from './AssessmentDetailModal.jsx';

/**
 * Step 3 — Assessment.
 *
 * ONE ROW PER (PROPERTY × ASSESSMENT IT WAS SENT FOR), with the property
 * named once at the top of its block — the same shape Steps 5 and 6 use for
 * the six commercial documents and the project plans.
 *
 * WHAT THIS REPLACED, and why. The sheet was one row per LOCATION with the
 * four assessments laid out side by side, five columns each: Feasibility's
 * score, form, owner, dates and notes, then Financial's, then Technical's,
 * then Operational's. Twenty-odd columns, the properties of a city stacked
 * inside every cell. Two problems, both reported:
 *
 *   - Comparing one property's own assessments meant reading across 2,000px.
 *   - A property the MD sent for ONE assessment still carried all four bands,
 *     three of them permanently empty. The decision not to ask for them was
 *     rendered as work outstanding.
 *
 * Down the page instead of across it, and only the assessments that were
 * actually asked for. A property sent for two is two rows. See
 * assessmentRows.jsx for what counts as "asked for" — it is one definition
 * now, where it used to be two that disagreed.
 *
 * A CELL IS STILL THE FORM. Clicking it opens the existing Site Evaluation
 * form on that assessment; those forms were built once, in the project, and
 * this page links to them rather than growing a second copy that would drift.
 */

/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'Route a property from Step 1 and it appears here.';

export default function PropertyAssessmentPage() {
  const navigate = useNavigate();
  /* NO ROLE CHECK ON THIS STEP. It had one because it offered a verdict;
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

  const columns = useMemo(() => [
    ...assessmentRowColumns({
      onOpenForm: openForm,
      onFiles: (row, at) => setMedia({ row, at }),
      onDetail: (row, type, entry) => setReading({ row, type, entry }),
      onDetails: setDetails,
    }),

    /* PROPERTY-LEVEL FACTS, ON THE FIRST ROW OF THE BLOCK ONLY. They are the
       same for every assessment under them, and repeating them is what makes
       one property read as three. */
    {
      key: 'source', label: 'Source', width: 122, sort: true,
      render: (r) => (r.isFirst ? <SourceBadge source={r.property.source} /> : null),
    },
    {
      key: 'submittedBy', label: 'Submitted by', width: 148, sort: true,
      render: (r) => (r.isFirst ? <ContactCell row={r.property} /> : null),
    },

    /**
     * THE ACTION, LAST AND PINNED — and on the PROPERTY, not the assessment.
     *
     * View opens the property's report and Edit opens its Site Evaluation
     * form; both cover every assessment the property has. Repeating the pair
     * on each row of a block would offer three buttons that all do the same
     * thing, and invite the reader to think Edit meant "edit this row".
     */
    {
      key: 'action', pin: 'right', label: 'Action', width: 190, align: 'center',
      render: (r) => (r.isFirst ? (
        <span className="pc2-acts" style={{ justifyContent: 'center', width: '100%', display: 'flex' }}>
          <button
            type="button"
            className="pc2-act a-view"
            onClick={(e) => { e.stopPropagation(); setDetails(r.property); }}
            title="Read this property's report — the assessments it was sent for"
          >
            <Eye size={12} /> View
          </button>
          {/* EDIT OPENS THE FORM, NOT A FIELD. The Site Evaluation form holds
              every assessment; the ones already filed open filled, the rest
              open blank, and any of them can be corrected. */}
          <button
            type="button"
            className="pc2-act"
            disabled={!r.property.projectId || !r.property.recordId}
            onClick={(e) => {
              e.stopPropagation();
              const { projectId, recordId } = r.property;
              if (projectId && recordId) navigate(`/projects/${projectId}/site-evaluation/${recordId}`);
            }}
            title={r.property.recordId
              ? 'Open the Site Evaluation form — filled assessments open filled, the rest open blank'
              : 'No property record yet, so there is no form to open'}
          >
            <Pencil size={12} /> Edit
          </button>
        </span>
      ) : null),
    },
  ], [navigate]);

  /* The queue folds a city's sites into one row; this layout wants the sites
     themselves, each expanded into its asked-for assessments. */
  const rows = useMemo(() => assessmentRows(propertiesOf(q.rows)), [q.rows]);

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
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                rowClass={(r) => `pcx-row${r.isFirst ? ' is-first' : ''}${r.isLast ? ' is-last' : ''}`}
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

      {/* Step 3 — this step IS the assessments, so the report carries them. */}
      {details && (
        <PropertyDetailsModal
          row={details}
          showAssessments
          onClose={() => setDetails(null)}
          /* Edit goes where the row's own Edit goes — the Site Evaluation
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
