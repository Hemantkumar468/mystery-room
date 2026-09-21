import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import { PropertyRouteModal } from './PropertyRouteModal.jsx';
import { PropertyRejectModal } from './PropertyRejectModal.jsx';
import { PropertyChangeDecisionModal } from './PropertyChangeDecisionModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import {
  PropertyCell, SourceBadge, PropertyToolbar, PageHead, PropEmpty,
  filesColumn, fmtDate, whoWhenColumns,
} from './propertyUi.jsx';

/**
 * Step 2 — MD Review & Decision.
 *
 * WHAT IT IS FOR. A captured property is a candidate, not a plan. Somebody has
 * walked the shop, filled the Phase 1 form and filed it; nothing happens next
 * until one person says which road it takes. That decision is this step, and
 * it belongs to one desk — which is exactly why it is a step and not a button
 * buried in the intake queue, where twenty-five rows of sourcing noise sit
 * around the three that are actually waiting on an answer.
 *
 * WHAT IS IN THE QUEUE. Filed properties with nowhere to go yet — the server's
 * `stage=routing` filter, which is narrower than Step 1's: no standing asks
 * ("we want a store in Agra" is not a property), and no public submissions
 * that have not been filed as records. Everything here has a form behind it
 * that somebody can read before deciding.
 *
 * THE DECISION, AND WHERE IT SENDS THE PROPERTY.
 *   Shortlist → assessment (and which of the four), or straight to commercial
 *               closure, or straight to project — the three roads, asked in
 *               one dialog, because they are one question.
 *   Reject    → off the table with a reason, which is what the expansion map
 *               is built from later.
 *
 * NOTHING IS FILED HERE. This step reads what was captured and records a
 * decision about it; the property record itself is unchanged apart from the
 * status that decision sets.
 */
const EMPTY_HINT = 'A property appears here the moment its Phase 1 form is filed in Step 1.';

const dash = <span className="prop-dim">-</span>;
const text = (v) => (v ? <span title={v}>{v}</span> : dash);
const money = (n) => (Number.isFinite(Number(n)) && Number(n) !== 0
  ? <span className="prop-num">{Number(n).toLocaleString('en-IN')}</span>
  : dash);

export default function PropertyMdReviewPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.manage(user?.role);

  const q = usePropertyQuery('routing');
  const [routing, setRouting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  /* A row whose decision is being CHANGED, not taken for the first time. */
  const [changing, setChanging] = useState(null);
  const [details, setDetails] = useState(null);
  const [media, setMedia] = useState(null);

  const columns = useMemo(() => [

    /* WHERE IT IS, AND WHERE IT CAME FROM — first after the action, because
       that is how this queue is scanned: the place, then who brought it, then
       whether anybody is on it. The four pillars follow immediately. */
    {
      key: 'city', label: 'Location', width: 180, sort: true,
      render: (r) => {
        const sub = [r.locality, r.address].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
        if (!r.city && !sub) return dash;
        return (
          <>
            <div className="prop-name" title={r.city}>{r.city || '—'}</div>
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
          </>
        );
      },
    },
    { key: 'source', label: 'Source', width: 148, sort: true, render: (r) => <SourceBadge source={r.source} /> },

    /* THE FOUR PILLARS, then the decision's own pair — who filed the capture
       this row is about, and who answered it. */
    ...whoWhenColumns('capture', {
      getPlan: (r) => r.capturePlan,
      getDoneBy: (r) => r.filedBy,
      getDoneAt: (r) => r.filedAt,
    }),
    {
      key: 'decidedBy', label: 'Decided by', width: 140,
      render: (r) => (r.decision?.by
        ? <span className="prop-person" title={r.decision.by}>{r.decision.by}</span>
        : <span className="prop-dim">Waiting</span>),
    },
    {
      key: 'decidedOn', label: 'Decided on', width: 112,
      render: (r) => (r.decision?.at
        ? <span className="as-when">{fmtDate(r.decision.at)}</span>
        : <span className="prop-dim">—</span>),
    },

    { key: 'title', label: 'Property', width: 220, sort: true, render: (r) => <PropertyCell row={r} /> },

    /* THE FACTS THE DECISION TURNS ON, and only those. The full sheet lives on
       Step 1; here the question is "is this worth assessing, closing on, or
       neither", and that is answered by size, terms and what was attached. */
    {
      key: 'area', label: 'Carpet area', width: 138, sort: true,
      render: (r) => (r.areaSqft ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : dash),
    },
    { key: 'floor', label: 'Floor', width: 82, render: (r) => text(r.floor) },
    { key: 'ctype', label: 'Terms', width: 104, render: (r) => text(r.details?.commercialType) },
    { key: 'rent', label: 'Monthly rent', width: 132, render: (r) => money(r.details?.monthlyRent) },
    { key: 'deposit', label: 'Deposit', width: 112, render: (r) => money(r.details?.deposit) },
    { key: 'lease', label: 'Lease amount', width: 136, render: (r) => money(r.details?.leaseAmount) },
    filesColumn((row, at) => setMedia({ row, at })),
    {
      key: 'project', label: 'Project', width: 160, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">Not on a project yet</span>),
    },
    { key: 'createdAt', label: 'Waiting since', width: 112, sort: true, render: (r) => fmtDate(r.createdAt) || dash },

    /* THE ACTION, LAST AND PINNED. Last because a row has to be read
       before it can be answered — leading with two buttons asks for the
       decision before the facts it turns on. Pinned because being last on
       a table this wide would otherwise mean scrolling to reach it; see
       `pin: 'right'` in PropTable.jsx. */
    {
      key: 'action', pin: 'right', label: 'Action', width: 210,
      render: (r) => (
        <div className="prop-action-cell is-grid">
          {canDecide && r.decision ? (
            /* ALREADY DECIDED. Shortlist and Reject are the first answer, and
               offering them again on a decided row was a click that failed:
               a rejected property cannot be re-shortlisted straight (see
               recordService.decide's transition table). Changing the answer is
               its own action, with its own dialog and its own reason. */
            <button
              type="button" className="prop-action-btn"
              onClick={() => setChanging(r)}
              title={`Change this decision — it is ${r.decision.state} now`}
            >
              <RotateCcw size={12} /> Change decision
            </button>
          ) : canDecide ? (
            <>
              <button
                type="button" className="prop-action-btn"
                onClick={() => setRouting(r)}
                title="Take it forward — assessment (and which), commercial closure, or straight to project"
              >
                <ThumbsUp size={12} /> Shortlist
              </button>
              <button
                type="button" className="prop-action-btn is-danger"
                onClick={() => setRejecting(r)}
                title="Take it off the table, with a reason"
              >
                <ThumbsDown size={12} /> Reject
              </button>
            </>
          ) : (
            <button type="button" className="prop-action-btn is-quiet" disabled title="Only the MD decides where a property goes">
              View only
            </button>
          )}
          <button
            type="button"
            className="prop-open"
            onClick={() => setDetails(r)}
            title="Read the whole property report here, without leaving the queue"
          >
            View Details
          </button>
        </div>
      ),
    },
  ], [canDecide, navigate]);

  return (
    <>
      <PageHead
        title="Filed properties waiting on one decision"
        subtitle="Read what was captured, then send it for assessment, straight to commercial, or straight to project."
      />
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : q.rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing waiting on a decision'}
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

      {routing && (
        <PropertyRouteModal
          row={routing}
          /* All three roads: this step IS the routing decision. */
          allowProject
          onClose={() => setRouting(null)}
          onDone={(result) => {
            setRouting(null);
            /* Follow the property to where the server says it landed — the
               decision and its consequence in one movement. */
            const to = result?.nextStage === 'commercial' ? '/property/commercial'
              : result?.nextStage === 'planning' ? '/property/planning'
                : '/property/assessment';
            navigate(to);
          }}
        />
      )}

      {rejecting && (
        <PropertyRejectModal
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => setRejecting(null)}
        />
      )}

      {changing && (
        <PropertyChangeDecisionModal
          row={changing}
          onClose={() => setChanging(null)}
          onDone={() => setChanging(null)}
        />
      )}

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
    </>
  );
}
