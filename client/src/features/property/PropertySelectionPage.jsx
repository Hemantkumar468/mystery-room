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
  filesColumn, SourceBadge, groupByCity, stackPerSite,
} from './propertyUi.jsx';
/* The location row and its numbered property boxes - the same two cells
   Steps 1, 2 and 3 render, from the one place they are declared. */
import {
  serialNumberColumn, sourceColumn, cityColumn, locationColumn,
  propertyBoxesColumn, statusColumn, PropertySheetFooter, sentToColumn,
} from './PropertySheet.jsx';
/* And the four assessment bands, exactly as Step 3 draws them. */
import { assessmentColumns } from './AssessmentScoreCell.jsx';
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

  const tableRows = useMemo(() => enrichRows(q.rows), [q.rows]);

  const columns = useMemo(() => [
    serialNumberColumn({ page: q.page, limit: q.limit }),
    sourceColumn({ width: 130 }),
    cityColumn({ width: 140 }),
    locationColumn({ width: 150 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),
    statusColumn(),

    /* ── Assessment Count / Progress ─────────────────────────────────── */
    {
      key: 'assessments', label: 'A/NO', width: 70,
      render: (r) => {
        const slots = r.assessmentSlots || [];
        const asked = slots.filter((a) => a.state !== 'not_routed');
        const total = asked.length;
        const { counted } = r.scores;
        const done = Math.min(counted, total);

        if (!total) {
          return <span className="prop-assess-no is-none" title="No assessment was asked for">—</span>;
        }
        const skipped = slots.filter((a) => a.state === 'not_routed');
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
     * NO WHO / WHEN COLUMNS HERE.
     *
     * Assigned, Done by, Plan date and Actual date belong to the step that
     * does the work, and every step carries its own set: Step 3 shows them per
     * assessment, Step 5 per document, Step 6 per plan. Repeating Step 3's
     * four on this screen said nothing this screen is for — the question here
     * is which of a project's sites wins, and that is answered by the scores.
     * Four columns of somebody else's schedule between the properties and
     * their scores is four columns the reader has to cross to compare them.
     *
     * Nothing is lost: the property's own report (View) carries who was on it
     * and when it was filed, per site, which is where that detail is read.
     */

    /**
     * NO AVERAGE COLUMN.
     *
     * It was a second number beside the one that decides — each assessment's
     * own score is already on the row, and an average of one filed assessment
     * is that assessment printed twice. Averaging two 70s and a 30 also hides
     * the 30, which is the number a site is refused on.
     */

    {
      key: 'submittedBy', label: 'Submitted by', width: 146, sort: true,
      render: (r) => <ContactCell row={r} />,
    },

    /* No Project column. This step groups BY project already — every row
       under one heading belongs to it — so the cell repeated the heading
       above it on every line, and read as a second, contradictory name for
       the property. The project is still reachable from View. */

    /* ── Sent to — the shared column, see PropertySheet.jsx ─────────── */
    sentToColumn({ width: 148 }),

    /* ── Area ───────────────────────────────────────────────────────── */
    {
      key: 'area', label: 'Area', width: 110,
      render: (r) => (r.areaSqft
        ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft`
        : <span className="prop-dim">—</span>),
    },

    /* ── Floor ──────────────────────────────────────────────────────── */
    {
      key: 'floor', label: 'Floor', width: 80,
      render: (r) => r.floor || <span className="prop-dim">—</span>,
    },

    /* ── ACTION, LAST AND PINNED RIGHT ──────────────────────────────── */
    {
      /* Sized to what it actually holds, which differs by reader: Approve,
         Reject and Details for somebody who can decide; "View only" and
         Details for everybody else. One fixed width for both left ~120px of
         empty column pinned to the right of every row for the second group,
         and a pinned gap follows the reader as they scroll — so it reads as
         a column that failed to load. Same fix as Steps 2 and 6. */
      key: 'action', pin: 'right', label: 'Action', width: canDecide ? 262 : 168,
      /* ONE LINE PER PROPERTY. The column is stacked now, so each verdict has
         to sit on the same fixed line as the numbered box it answers for; a
         taller cell is clipped, and half a button over the wrong site is worse
         than no button. Same three controls, compact - the form Steps 1 to 3
         already use. */
      render: (r, _i, group) => {
        const pending = (r.assessments?.length || 0) - (r.assessmentsFiled || 0);
        /**
         * ALREADY THROUGH THE GATE.
         *
         * This step lists the decided properties now, not only the ones
         * waiting — so a row is in one of two states, and offering Shortlist
         * on a site already in commercial closure is a click that fails.
         * Past the gate it gets the one thing left to do to it: put the
         * decision back.
         */
        const decided = r.stage === 'commercial' || r.statusKey === 'approved';
        return (
          /* THREE FIXED SLOTS, WHETHER OR NOT A ROW EARNS ALL THREE.
             Shortlist | Reject | View, each in its own column by class rather
             than by how many buttons happen to precede it — so a decided row,
             which offers View alone, still prints View where every other row
             prints it. Free-flowing buttons put it 82px to the left on those
             rows, and a verdict column whose buttons move is one the eye has
             to re-find on every line. */
          <span className="pc2-acts is-slots">
            {/* NO REVERT HERE. Undoing a decision is Step 2's act — that is
                where a property's road is set and where it can be taken back
                — and having it on both screens meant two places to undo one
                thing, with no way to tell from here which of them had. A
                decided row keeps the one thing left to do to it: read it. */}
            {canDecide && decided ? null : canDecide ? (

              <>
                <button
                  type="button"
                  className="pc2-act a-go"
                  onClick={(e) => { e.stopPropagation(); setDeciding({ row: r, mode: 'approve' }); }}
                  /* Said, never blocked: what is outstanding is a fact the
                     reader should have, not a reason to refuse the answer. */
                  title={pending > 0
                    ? `${pending} assessment(s) still outstanding — you can shortlist on what is in, and the dialog says so`
                    : 'Take this site forward — then choose commercial closure or games & dates'}
                >
                  {/* "Shortlist", not "Approve". The verdict this step records
                      is the same one Step 2 records, and one desk calling it
                      two names is how two people come to believe they are
                      different decisions. */}
                  <ThumbsUp size={12} /> Shortlist
                </button>
                <button
                  type="button"
                  className="pc2-act a-reject"
                  onClick={(e) => { e.stopPropagation(); setDeciding({ row: r, mode: 'reject' }); }}
                  /* The word is the MD's, and on this step it is aimed at the
                     assessment, not the site: saying no here sends the work
                     back to be done again. Killing a property is Step 2's
                     act. Said on hover as well as in the dialog, because the
                     button sits on a row that names a property. */
                  title="Not good enough — the assessment goes back to the doer to be done again"
                >
                  <ThumbsDown size={12} /> Reject
                </button>
              </>
            ) : (
              <span className="tiny muted" title="Only the MD decides where a property goes">View only</span>
            )}
            {/* LAST, against the right edge — see PropertyMdReviewPage. */}
            <button
              type="button"
              className="pc2-act a-view"
              /* OPENED ON THIS PROPERTY, CARRYING THE WHOLE LOCATION.
                 Bhopal holds two sites and each has four assessments; reading
                 them meant opening one report, going back, and opening the
                 other. The report starts on the site whose button was pressed
                 and lists every site in the location under it. */
              onClick={(e) => {
                e.stopPropagation();
                setDetails(group?.siblings ? { ...r, siblings: group.siblings } : r);
              }}
              title="Read the whole report here — this location’s properties and all four assessments of each"
            >
              <Eye size={12} /> View
            </button>
          </span>
        );
      },
    },
  ], [canDecide, navigate]);

  /**
   * Every column except the location belongs to ONE property, the action
   * included: a Mumbai row holding five sites needs five verdicts, and a
   * single Approve on it would take whichever site came back first.
   */
  const perSiteKeys = useMemo(() => [
    'assessments', 'source', 'locality', 'assigned', 'doneBy', 'planDate', 'actualDate', 'average',
    'files', 'submittedBy', 'project', 'area', 'floor', 'action',
    ...ASSESSMENTS.flatMap((a) => [
      `${a.key}_score`, `${a.key}_form`, `${a.key}_notes`, `${a.key}_headline`,
      `${a.key}_by`, `${a.key}_files`, `${a.key}_at`,
    ]),
  ], []);

  const perSite = useMemo(() => stackPerSite(columns, perSiteKeys), [columns, perSiteKeys]);
  /* One row per location - the same fold Steps 1 to 3 use, from the same
     helper. Applied AFTER enrichRows, so the "highest average in this project"
     badge is still worked out across every candidate rather than within a
     city. */
  const grouped = useMemo(() => groupByCity(tableRows), [tableRows]);

  return (
    <>
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn't respond." />
          : !grouped.length ? (
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
                  columns={perSite}
                  rows={grouped}
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
