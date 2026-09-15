import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropertyRouteModal } from './PropertyRouteModal.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PropertyCell, ContactCell, SourceBadge, StageBadge,
  PropertyToolbar, PageHead, PropEmpty,
  filesColumn,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';

/**
 * Step 1 — Property Capturing. Every property in front of the business.
 *
 * ACTION IS THE FIRST COLUMN and it is pinned, which is the point of the
 * layout: the table is wider than any screen, and an action at the far right
 * meant scrolling to the end of a row to act and back again to read the next.
 *
 * The columns are declared, not drawn. PropTable owns scrolling, sticking and
 * sorting; this file owns what a property column IS.
 */
const TABS = [
  { key: '', label: 'Everything' },
  { key: 'franchise', label: 'Franchisee' },
  { key: 'broker', label: 'Broker' },
  { key: 'demand', label: 'Wanted' },
  { key: 'captured', label: 'Captured' },
];


/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'Properties arrive from the franchise link, the broker link and New Project.';

export default function PropertyCapturePage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.manage(user?.role);

  const q = usePropertyQuery(null);
  const [media, setMedia] = useState(null);
  const [routing, setRouting] = useState(null);

  const openRow = (r) => {
    if (r.recordId && r.projectId) navigate(`/projects/${r.projectId}/property-identification/${r.recordId}`);
    else if (r.projectId) navigate(`/projects/${r.projectId}`);
    else if (r.enquiryId) navigate('/franchise/enquiries');
  };

  const columns = useMemo(() => [
    {
      key: 'action', label: 'Action', width: 232,
      render: (r) => (
        <div className="prop-action-cell">
          {/* EVERY row gets a button, never bare text. The fill says which
              kind: gold is "this one is yours to do now", muted is "this is
              waiting on somebody else" — and the muted one still goes
              somewhere, because "approve the enquiry first" is useless unless
              it takes you to the enquiry. */}
          {r.stage === 'demand' ? (
            <button
              type="button" className="prop-action-btn is-quiet"
              onClick={() => openRow(r)}
              title={`No property yet — somebody has to source a site in ${r.city || 'this city'}`}
            >
              <MapPin size={12} /> Find a site
            </button>
          ) : r.blockedReason ? (
            <button
              type="button" className="prop-action-btn is-quiet"
              onClick={() => navigate('/franchise/enquiries')}
              title={r.blockedReason}
            >
              Approve enquiry
            </button>
          ) : canDecide && r.recordId ? (
            <button type="button" className="prop-action-btn" onClick={() => setRouting(r)}>
              {r.stage === 'capture' ? 'Review & route' : 'Re-route'}
            </button>
          ) : (
            <button type="button" className="prop-action-btn is-quiet" disabled title="You do not have permission to route properties">
              View only
            </button>
          )}
          <button type="button" className="prop-open" onClick={() => openRow(r)} title="Open the full record">
            Open ›
          </button>
        </div>
      ),
    },
    { key: 'title', label: 'Property', width: 240, sort: true, render: (r) => <PropertyCell row={r} /> },
    filesColumn(setMedia),
    { key: 'city', label: 'City', width: 100, sort: true, render: (r) => r.city || <span className="prop-dim">—</span> },
    { key: 'source', label: 'Source', width: 108, sort: true, render: (r) => <SourceBadge source={r.source} /> },
    { key: 'submittedBy', label: 'Submitted by', width: 125, sort: true, render: (r) => <ContactCell row={r} /> },
    {
      key: 'project', label: 'Project', width: 165, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">Not on a project yet</span>),
    },
    {
      key: 'area', label: 'Area / Floor', width: 125, sort: true,
      render: (r) => [r.areaSqft ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : null, r.floor]
        .filter(Boolean).join(' · ') || <span className="prop-dim">—</span>,
    },
    { key: 'stage', label: 'Stage', width: 112, sort: true, render: (r) => <StageBadge stage={r.stage} /> },
  ], [canDecide, navigate]);

  return (
    <>
      <PageHead
        title="Every property, whichever door it came in through"
        subtitle="Franchisee submissions, broker leads, sourcing requests and captured sites, in one queue."
      />
      <PropertyToolbar q={q} tabs={TABS} />

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

      {routing && (
        <PropertyRouteModal
          row={routing}
          onClose={() => setRouting(null)}
          onDone={(result) => {
            const to = result?.nextStage === 'commercial' ? '/property/commercial' : '/property/assessment';
            setRouting(null);
            // Follow the property to the step the server says it landed on —
            // the decision and its consequence in one movement.
            navigate(to);
          }}
        />
      )}

      {media && <PropertyMediaModal row={media} onClose={() => setMedia(null)} />}
    </>
  );
}
