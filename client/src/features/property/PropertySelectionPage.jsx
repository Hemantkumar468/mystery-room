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
  PlanDateCell, fmtDate, filesColumn, AssignedCell, SourceBadge,
  groupByCity, stackPerSite,
} from './propertyUi.jsx';
/* The location row and its numbered property boxes - the same two cells
   Steps 1, 2 and 3 render, from the one place they are declared. */
import { locationColumn, propertyBoxesColumn, PropertySheetFooter } from './PropertySheet.jsx';
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
const lastFiled = (list) => (list || [])
  .filter((x) => x?.at)
  .sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;

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
    /* ── Progress ────────────────────────────────────────────────────── */
    {
      key: 'assessments', label: '#', width: 62,
      render: (r) => {
        const { counted } = r.scores;
        const total = ASSESSMENTS.length;
        return (
          <span
            className={`prop-assess-no${counted === total ? ' is-done' : ''}`}
            title={`${counted} of ${total} assessments scored`}
          >
            {counted}/{total}
          </span>
        );
      },
    },

    /* ── Location, then its properties ───────────────────────────────
       Mumbai was five rows here, one per site, repeating the city five times -
       the same thing Steps 1 to 3 stopped doing. One row per location, its
       properties listed and numbered inside it, and every column to the right
       lines up with the box it belongs to. */
    { key: 'source', label: 'Source', width: 130, sort: true, render: (r) => <SourceBadge source={r.source} /> },
    locationColumn({ width: 170 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),

    /* ── Who / When (from assessment plan) ────────────────────────────── */
    {
      key: 'assigned', label: 'Assigned', width: 140,
      render: (r) => <AssignedCell plan={r.assessmentPlan} />,
    },
    {
      key: 'doneBy', label: 'Done by', width: 130,
      render: (r) => {
        const lf = lastFiled(r.assessments);
        return lf?.by
          ? <span className="prop-person" title={lf.by}>{lf.by}</span>
          : <span className="prop-dim">Not yet</span>;
      },
    },
    {
      key: 'planDate', label: 'Plan date', width: 108,
      render: (r) => <PlanDateCell plan={r.assessmentPlan} />,
    },
    {
      key: 'actualDate', label: 'Actual date', width: 115,
      render: (r) => {
        const lf = lastFiled(r.assessments);
        if (lf?.at) return <span className="as-when">{fmtDate(lf.at)}</span>;
        const plan = r.assessmentPlan;
        return plan?.planDate
          ? <span className="as-due" title="Planned date — not done yet">due {fmtDate(plan.planDate)}</span>
          : <span className="prop-dim">—</span>;
      },
    },

    /* ── Average Score ────────────────────────────────────────────────── */
    {
      /* NOT SORTABLE, and it cannot be: the average is worked out here, from
         the four assessments' answers, and the server has no column to order
         by - clicking this header asked it to sort on `average` and got a
         refusal back. The table is already ordered by it within each project
         group, which is what the click was reaching for. */
      key: 'average', label: 'Average', width: 150,
      render: (r) => {
        const { average, counted } = r.scores;
        if (average == null) return <span className="prop-dim">Not scored</span>;
        const grade = scoreGradeFor(average);
        return (
          <div className="psel-avg-cell">
            {r._isLead && (
              <span className="psel-lead-badge" title="Highest average in this project group">
                <Trophy size={10} />
              </span>
            )}
            <b className="psel-avg-pct" style={{ color: grade.color }}>{average}%</b>
            <span className="psel-avg-grade">{grade.label} · avg of {counted}</span>
          </div>
        );
      },
    },

    /**
     * EACH ASSESSMENT IN FULL, AND OPENABLE - the same bands Step 3 draws.
     *
     * These were four columns headed FEAS / FINA / TECH / OPER, each showing a
     * bare percentage and nothing else. Two problems with that, and the second
     * is the one that mattered: a number with no purpose, no finding and no
     * author is not something anybody can approve a nine-year lease on; and an
     * assessment that had NOT come back showed a dash with no way to do
     * anything about it.
     *
     * Now an unfilled assessment is an empty cell that OPENS ITS FORM, so the
     * MD who wants the technical read before deciding can start it from here
     * instead of going to find Step 3. That is the whole point of letting a
     * property reach this step on one filed assessment.
     */
    ...ASSESSMENTS.flatMap((a) => assessmentColumns(a, openForm, (row, at) => setMedia({ row, at }))),

    /* ── Files ──────────────────────────────────────────────────────── */
    filesColumn((row, at) => setMedia({ row, at })),

    /* ── Submitted by ──────────────────────────────────────────────── */
    {
      key: 'submittedBy', label: 'Submitted by', width: 146, sort: true,
      render: (r) => <ContactCell row={r} />,
    },

    /* ── Project ────────────────────────────────────────────────────── */
    {
      key: 'project', label: 'Project', width: 158, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">—</span>),
    },

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
        return (
          <span className="pc2-acts">
            {canDecide ? (
              <>
                <button
                  type="button"
                  className="pc2-act a-go"
                  onClick={(e) => { e.stopPropagation(); setDeciding({ row: r, mode: 'approve' }); }}
                  /* Said, never blocked: what is outstanding is a fact the
                     reader should have, not a reason to refuse the answer. */
                  title={pending > 0
                    ? `${pending} assessment(s) still outstanding — you can approve on what is in, and the dialog says so`
                    : 'Take this site forward — then choose commercial closure or games & dates'}
                >
                  <ThumbsUp size={12} /> Approve
                </button>
                <button
                  type="button"
                  className="pc2-act a-reject"
                  onClick={(e) => { e.stopPropagation(); setDeciding({ row: r, mode: 'reject' }); }}
                  title="Off the table, with a reason"
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
              <Eye size={12} /> Details
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
    'assessments', 'source', 'assigned', 'doneBy', 'planDate', 'actualDate', 'average',
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

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

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
