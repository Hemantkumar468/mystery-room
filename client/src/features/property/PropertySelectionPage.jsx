import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, ThumbsUp, ThumbsDown, AlertTriangle, Eye,
} from 'lucide-react';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropertyApproveModal } from './PropertyApproveModal.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PageHead, PropEmpty, PropertyToolbar, ContactCell,
  SourceBadge,
} from './propertyUi.jsx';
/* The location row and its numbered property boxes - the same two cells
   Steps 1, 2 and 3 render, from the one place they are declared. */
import { PropertySheetFooter } from './PropertySheet.jsx';
/* And the four assessment bands, exactly as Step 3 draws them. */
import { assessmentRowColumns } from './AssessmentScoreCell.jsx';
import { assessmentRows, propertiesOf, askedAssessments, skippedAssessments } from './assessmentRows.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';

/**
 * Step 4 — MD Review & Approval.
 *
 * REDESIGNED AS A TABLE. The card grid answered "which site leads by score"
 * but could not be sorted, filtered, or compared column-by-column the way the
 * other five steps can. The table gives every assessment its own column, keeps
 * the Average as the first score read, and pins the Action on the right —
 * exactly as Steps 3, 5 and 6 already do.
 *
 * WHAT APPEARS HERE. Fully assessed properties, grouped by project. One is
 * chosen per project; the rest come off the table. The "Highest average"
 * badge appears inline in the Average column on the top-scoring candidate
 * within each project group.
 *
 * IT WRITES NOTHING NEW. Selecting is the same `decide('shortlist')` the
 * verdict already used — which opens the six commercial documents — and
 * rejecting is the same reject with its reason.
 */

const SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/** A property's four scores, and their average — the number to sort on. */
function scoresOf(row) {
  const byType = new Map((row.assessments || []).map((a) => [a.type, a]));
  const each = ASSESSMENTS.map(({ key, label }) => {
    const a = byType.get(key);
    const pct = a?.values ? SCORERS[key]?.(a.values) ?? null : null;
    return { key, label, pct };
  });
  const got = each.filter((s) => typeof s.pct === 'number');
  const average = got.length ? Math.round(got.reduce((n, s) => n + s.pct, 0) / got.length) : null;
  return { each, average, counted: got.length };
}

/**
 * Build the flat row list, enriched with scores and a `leads` flag for the
 * highest-average candidate within each project group.
 */
function enrichRows(rows) {
  /* Group by project to find the lead in each. */
  const groups = new Map();
  const enriched = (rows || []).map((r) => ({ ...r, scores: scoresOf(r) }));

  for (const r of enriched) {
    const key = r.projectId || 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  /* Mark the highest average per project. */
  for (const members of groups.values()) {
    if (members.length <= 1) continue;
    let best = null;
    for (const m of members) {
      if (m.scores.average != null && (best === null || m.scores.average > best.scores.average)) {
        best = m;
      }
    }
    if (best) best._isLead = true;
  }

  /* Sort: highest average first within each project, then projects with more
     candidates first — the same order the old card grid used. */
  return enriched.sort((a, b) => {
    const projCmp = (a.projectName || '').localeCompare(b.projectName || '');
    if (projCmp !== 0) return projCmp;
    return (b.scores.average ?? -1) - (a.scores.average ?? -1);
  });
}

export default function PropertySelectionPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.manage(user?.role);

  const q = usePropertyQuery('selection');
  /* No withdrawal here — see the note on the action cell; Step 2 owns it. */
  const [deciding, setDeciding] = useState(null);
  const [media, setMedia] = useState(null);
  /* Which property's full report is open - opened from a numbered box. */
  const [details, setDetails] = useState(null);

  /** The existing Site Evaluation form, opened on one assessment. */
  const openForm = (row, type) => {
    if (!row.projectId || !row.recordId) return;
    navigate(`/projects/${row.projectId}/site-evaluation/${row.recordId}?form=${type}`);
  };


  const columns = useMemo(() => [
    /**
     * HOW FAR THROUGH THE ASKED-FOR ASSESSMENTS THIS PROPERTY IS.
     *
     * On the first row of the block only — it is a fact about the property,
     * not about the assessment on this line.
     *
     * ASKED FOR, NOT ALL FOUR, and counted by the same rule Step 3 uses or
     * the two steps print different numbers for the same property: "kirti
     * nagar" read 1/1 on the assessment queue and 1/4 here, on pages one
     * click apart. The MD's own decision sets the size of the job.
     */
    {
      key: 'assessments', label: 'A/NO', width: 84,
      render: (r) => {
        if (!r.isFirst) return null;
        const asked = askedAssessments(r.property);
        const total = asked.length;
        const { counted } = r.property.scores;
        /* `counted` is how many actually SCORED, which can be fewer than were
           filed — a form answered only in its free-text fields scores
           nothing. Capped, so it can never read 3/1. */
        const done = Math.min(counted, total);
        if (!total) {
          return <span className="prop-assess-no is-none" title="No assessment was asked for">—</span>;
        }
        const skipped = skippedAssessments(r.property);
        return (
          <span
            className={`prop-assess-no${done === total ? ' is-done' : ''}`}
            title={`${done} of ${total} asked-for assessment${total === 1 ? '' : 's'} scored`
              + (skipped.length ? ` — ${skipped.map((a) => a.label).join(', ')} not asked for` : '')}
          >
            {done}/{total}
          </span>
        );
      },
    },

    /**
     * ONE ROW PER ASSESSMENT, exactly as Step 3 now reads.
     *
     * NO FORM AND NO WHO/WHEN on this step. Assigned, Plan date, Filed by and
     * Filed on belong to the step that chases the work; the question here is
     * which of a project's sites wins, and that is answered by the scores.
     * Four columns of somebody else's schedule between the properties and
     * their numbers is four the reader has to cross to compare them.
     */
    ...assessmentRowColumns({
      onOpenForm: openForm,
      onFiles: (row, at) => setMedia({ row, at }),
      onDetail: (row) => setDetails(row),
      onDetails: setDetails,
      showForm: false,
      showWhoWhen: false,
    }),

    /**
     * THE AVERAGE, AND WHICH SITE LEADS ITS PROJECT.
     *
     * Back on this step and not on Step 3, because this is the step that
     * compares sites: the badge marks the highest average among a project's
     * candidates, which is the single thing the MD is here to see. On the
     * first row of the block — it is the property's number, not one
     * assessment's, and the per-assessment scores are already on the rows
     * below it.
     */
    {
      key: 'average', label: 'Average', width: 132,
      render: (r) => {
        if (!r.isFirst) return null;
        const { average } = r.property.scores;
        if (average == null) return <span className="prop-dim">—</span>;
        const grade = scoreGradeFor(average);
        return (
          <span className="psel-avg">
            <b style={{ color: grade.color }}>{average}%</b>
            {r.property._isLead && (
              <span className="psel-lead" title="Highest average among this project's candidates">
                <Trophy size={11} /> Highest
              </span>
            )}
          </span>
        );
      },
    },

    /* PROPERTY-LEVEL FACTS, on the first row of the block only. */
    {
      key: 'source', label: 'Source', width: 122, sort: true,
      render: (r) => (r.isFirst ? <SourceBadge source={r.property.source} /> : null),
    },
    {
      key: 'submittedBy', label: 'Submitted by', width: 146, sort: true,
      render: (r) => (r.isFirst ? <ContactCell row={r.property} /> : null),
    },
    {
      key: 'area', label: 'Area', width: 110,
      render: (r) => (r.isFirst
        ? (r.property.areaSqft
          ? `${Number(r.property.areaSqft).toLocaleString('en-IN')} sq ft`
          : <span className="prop-dim">—</span>)
        : null),
    },
    {
      key: 'floor', label: 'Floor', width: 80,
      render: (r) => (r.isFirst ? (r.property.floor || <span className="prop-dim">—</span>) : null),
    },

    /**
     * THE ACTION, LAST AND PINNED, and ON THE PROPERTY.
     *
     * The verdict is about the site, not about one of its assessments, so it
     * is printed once per block. Repeating Shortlist on each row would offer
     * three buttons that all record the same decision.
     */
    {
      key: 'action', pin: 'right', label: 'Action', width: canDecide ? 262 : 168,
      render: (r) => {
        if (!r.isFirst) return null;
        const p = r.property;
        const askedCount = askedAssessments(p).length;
        const pending = Math.max(0, askedCount - (p.scores.counted || 0));
        /**
         * ALREADY THROUGH THE GATE. This step lists the decided properties
         * too, so a row is in one of two states, and offering Shortlist on a
         * site already in commercial closure is a click that fails.
         */
        const decided = p.stage === 'commercial' || p.statusKey === 'approved';
        return (
          /* THREE FIXED SLOTS, whether or not a row earns all three, so a
             decided row still prints View where every other row prints it. */
          <span className="pc2-acts is-slots">
            {/* NO REVERT HERE. Undoing a decision is Step 2's act — having it
                on both screens meant two places to undo one thing. */}
            {canDecide && decided ? null : canDecide ? (
              <>
                <button
                  type="button"
                  className="pc2-act a-go"
                  onClick={(e) => { e.stopPropagation(); setDeciding({ row: p, mode: 'approve' }); }}
                  /* Said, never blocked: what is outstanding is a fact the
                     reader should have, not a reason to refuse the answer. */
                  title={pending > 0
                    ? `${pending} assessment(s) still outstanding — you can shortlist on what is in, and the dialog says so`
                    : 'Take this site forward — then choose commercial closure or games & dates'}
                >
                  {/* "Shortlist", not "Approve": the verdict is the same one
                      Step 2 records, and one desk calling it two names is how
                      two people come to believe they are different decisions. */}
                  <ThumbsUp size={12} /> Shortlist
                </button>
                <button
                  type="button"
                  className="pc2-act a-reject"
                  onClick={(e) => { e.stopPropagation(); setDeciding({ row: p, mode: 'reject' }); }}
                  /* Aimed at the assessment, not the site: saying no here
                     sends the work back to be done again. Killing a property
                     is Step 2's act. */
                  title="Not good enough — the assessment goes back to the doer to be done again"
                >
                  <ThumbsDown size={12} /> Reject
                </button>
              </>
            ) : (
              <span className="tiny muted" title="Only the MD decides where a property goes">View only</span>
            )}
            <button
              type="button"
              className="pc2-act a-view"
              onClick={(e) => { e.stopPropagation(); setDetails(p); }}
              title="Read this property's report — the assessments it was sent for"
            >
              <Eye size={12} /> View
            </button>
          </span>
        );
      },
    },
  ], [canDecide, navigate]);

  /* Properties first, then scored and ranked, then expanded into their
     asked-for assessments. Ranking runs on PROPERTIES so "highest average in
     this project" is still worked out across every candidate. */
  const rows = useMemo(
    () => assessmentRows(enrichRows(propertiesOf(q.rows))),
    [q.rows],
  );


  return (
    <>
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn't respond." />
          : !rows.length ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing ready to choose between'}
              hint={q.active
                ? 'Clear the filters to see the whole step.'
                : 'A property appears here once all of its assessments are filed. Ones still being assessed are on Step 3.'}
            />
          ) : (
            <>
              {/* The note about what approval does, above the table. */}
              <p className="psel-table-note">
                <AlertTriangle size={12} />
                Approving one opens its six commercial documents and its games &amp; dates planning
                together. The others stay here until they are decided — they are not rejected for you.
              </p>
              <div className="pc2-tablewrap">
                <PropTable
                  columns={columns}
                  rows={rows}
                  rowClass={(r) => `pcx-row${r.isFirst ? ' is-first' : ''}${r.isLast ? ' is-last' : ''}`}
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

      {/* Step 4 - the MD reads all four before deciding, so the report carries them. */}
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

      {deciding && (
        <PropertyApproveModal
          row={deciding.row}
          mode={deciding.mode}
          onClose={() => setDeciding(null)}
          onDone={(route) => {
            setDeciding(null);
            if (route?.to) navigate(route.to);
          }}
        />
      )}
    </>
  );
}
