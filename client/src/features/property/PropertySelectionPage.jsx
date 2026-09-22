import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, ThumbsUp, ThumbsDown, AlertTriangle,
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
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PageHead, PropEmpty, PropertyToolbar, PropertyCell, ContactCell,
  PlanDateCell, fmtDate, filesColumn, AssignedCell,
} from './propertyUi.jsx';
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

    /* ── Location ────────────────────────────────────────────────────── */
    {
      key: 'city', label: 'Location', width: 170, sort: true,
      render: (r) => {
        const sub = [r.locality, r.address].filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(' · ');
        if (!r.city && !sub) return <span className="prop-dim">—</span>;
        return (
          <>
            <div className="prop-name" title={r.city}>{r.city || '—'}</div>
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
          </>
        );
      },
    },

    /* ── Property ────────────────────────────────────────────────────── */
    {
      key: 'title', label: 'Property', width: 220, sort: true,
      render: (r) => <PropertyCell row={r} />,
    },

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
      key: 'average', label: 'Average', width: 150, sort: true,
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

    /* ── Individual assessment scores ──────────────────────────────────── */
    ...ASSESSMENTS.map((a) => ({
      key: a.key,
      label: a.label.slice(0, 4).toUpperCase(),
      width: 78,
      render: (r) => {
        const s = r.scores.each.find((e) => e.key === a.key);
        if (!s || s.pct == null) return <span className="prop-dim">—</span>;
        const grade = scoreGradeFor(s.pct);
        return (
          <span
            className="psel-score-cell"
            title={`${a.label}: ${s.pct}% — ${grade.label}`}
            style={{ color: grade.color }}
          >
            {s.pct}%
          </span>
        );
      },
    })),

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
      key: 'action', pin: 'right', label: 'Action', width: 260,
      render: (r) => (
        <div className="prop-action-cell">
          <button
            type="button"
            className="prop-open"
            onClick={() => navigate(`/projects/${r.projectId}/property-identification/${r.recordId}`)}
          >
            Open ›
          </button>
          {canDecide ? (
            <>
              <button
                type="button"
                className="psel-approve"
                onClick={() => setDeciding({ row: r, mode: 'approve' })}
                title="Take this site forward — then choose commercial closure or games & dates"
              >
                <ThumbsUp size={12} /> Approve
              </button>
              <button
                type="button"
                className="prop-action-btn is-danger"
                onClick={() => setDeciding({ row: r, mode: 'reject' })}
                title="Off the table, with a reason"
              >
                <ThumbsDown size={12} /> Reject
              </button>
            </>
          ) : (
            <span className="tiny muted">View only</span>
          )}
        </div>
      ),
    },
  ], [canDecide, navigate]);

  return (
    <>
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn't respond." />
          : !tableRows.length ? (
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
              <PropTable
                columns={columns}
                rows={tableRows}
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

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}

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
