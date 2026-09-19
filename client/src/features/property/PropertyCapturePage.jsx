import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, RotateCcw, ClipboardCheck } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropertyIntakeBar } from './PropertyIntakeBar.jsx';
import { EnquiryDecisionModal } from './EnquiryDecisionModal.jsx';
import { PropertyCaptureModal } from './PropertyCaptureModal.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PropertyCell, ContactCell, SourceBadge, StageBadge,
  PropertyToolbar, PageHead, PropEmpty,
  filesColumn, fmtDate, whoWhenColumns,
} from './propertyUi.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyRevertModal } from './PropertyRevertModal.jsx';

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
/**
 * The tab strip. The first five are DOORS a property came in through; the
 * last is not — see REJECTED_TAB.
 */
const TABS = [
  { key: '', label: 'All Properties' },
  { key: 'franchise', label: 'Franchisee' },
  { key: 'broker', label: 'Random Opportunities' },
  /* A store we have decided to open and have no site for yet. It was called
     "Wanted", which named the SITE we are missing rather than the thing in
     front of us — and the button that creates these rows says New Store, so
     the tab that lists them now says the same. */
  { key: 'demand', label: 'New Store' },
  { key: 'captured', label: 'Company Owned' },
];

/**
 * REJECTED IS A PLACE, NOT A FILTER.
 *
 * It used to be a tickbox in the toolbar of all six steps, which offered to
 * blend properties we had said no to into a queue of work still outstanding —
 * so every step's count was one tick away from being wrong, and the properties
 * themselves had no home. They have one now: this tab. It asks the server for
 * the rejected stage rather than for a source, which is why it is kept out of
 * TABS above and why the strip takes `tab`/`onTab` instead of reading
 * `q.source` — see PropertyToolbar.
 *
 * Every rejected property is here whichever step it was turned down at, which
 * is the point: "what have we said no to" is one question, not six.
 */
const REJECTED_TAB = 'rejected';

/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'Properties arrive from the franchise link, the broker link and New Project.';

/** The step a rejected property was standing on, in the stepper's own words. */
const REJECTED_FROM_LABEL = {
  capture: 'MD Review & Decision',
  assessment: 'Property Assessment',
  commercial: 'Property Commercial',
};

/**
 * The sheet's cell formatters.
 *
 * A DASH, ALWAYS, where there is nothing. On a table this wide an empty cell
 * reads as a rendering fault rather than as a field nobody answered, and the
 * two are worth telling apart. Money prints in full rupees with Indian
 * grouping, because a rent shown as "1.2L" cannot be compared by eye against
 * one typed as 145000 in the row below it.
 */
const dash = <span className="prop-dim">-</span>;
const text = (v) => (v ? <span title={v}>{v}</span> : dash);
const money = (n) => (Number.isFinite(Number(n)) && Number(n) !== 0
  ? <span className="prop-num">{Number(n).toLocaleString('en-IN')}</span>
  : dash);
/**
 * Notes, in a cell that cannot be stretched by them.
 *
 * Somebody pastes four paragraphs from a broker's WhatsApp into this field and
 * the row grows to the height of the paragraph, which pushes every other row
 * off the screen — one long note breaks the whole sheet. So the cell shows the
 * first two lines and offers the rest: the row keeps its height no matter what
 * was typed, and nothing is hidden, only folded.
 */
function NotesCell({ row }) {
  const [open, setOpen] = useState(false);
  /* "Clipped" is MEASURED, not guessed from the length. What overflows two
     lines depends on the column width and on where the words break, so a
     character count offers "View more" on a short note in a narrow cell and
     hides it on a long one in a wide cell. This asks the layout. */
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  const text = (row.remarks || '').trim();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  if (!text) return <span className="prop-dim">-</span>;

  return (
    <>
      <span className="prop-notes" ref={ref}>{text}</span>
      {clipped && (
        <button type="button" className="prop-notes-more" onClick={() => setOpen(true)}>
          View more
        </button>
      )}
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Notes"
          subtitle={[row.title, row.city].filter(Boolean).join(' \u00b7 ')}
          width={560}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
          )}
        >
          <p className="prop-notes-full">{text}</p>
        </Modal>
      )}
    </>
  );
}

const person = (name, phone) => {
  if (!name && !phone) return dash;
  return (
    <>
      <div className="prop-person" title={name}>{name || '-'}</div>
      {phone && <a className="prop-phone" href={`tel:${phone}`}>{phone}</a>}
    </>
  );
};

export default function PropertyCapturePage() {
  const navigate = useNavigate();

  /**
   * ONE PIECE OF STATE FOR THE STRIP, because the tabs are two different
   * questions wearing one shape. Five of them narrow by source; Rejected asks
   * for a stage instead. Holding the ACTIVE TAB here and deriving both
   * parameters from it keeps them from ever both being set — a source filter
   * still applied while reading rejected properties would silently hide most
   * of them.
   */
  const [tab, setTab] = useState('');
  const rejectedView = tab === REJECTED_TAB;

  const q = usePropertyQuery(rejectedView ? 'rejected' : null);
  const pickTab = (key) => {
    setTab(key);
    q.setSource(key === REJECTED_TAB ? '' : key);
  };

  const [media, setMedia] = useState(null);
  /* Which rejected property is being put back — see PropertyRevertModal. */
  const [reverting, setReverting] = useState(null);
  /* A sourcing request opens the capture flow with what the lead already told
     us. "Find a site" ends in a captured property either way — see the
     PropertyCaptureModal at the foot of this file. */
  const [sourcing, setSourcing] = useState(null);
  /* Which submission's approve/reject dialog is open — see EnquiryDecisionModal. */
  const [deciding, setDeciding] = useState(null);
  /* Which property is being read — see PropertyDetailsModal. */
  const [details, setDetails] = useState(null);

  /**
   * The property, read over the queue.
   *
   * This used to navigate into Project Management, which answered "show me
   * this property" by throwing away the filters, the sort and the reader's
   * place in 46 rows. Nobody clicking it was asking to go anywhere. Where the
   * data LIVES is unchanged — the same p1 record on the same project — it is
   * only read here now. See PropertyDetailsModal.
   */

  const columns = useMemo(() => [
    {
      key: 'action', label: 'Action', width: 212,
      render: (r) => (
        /* `is-row`, not `is-grid`: the grid makes both of these full-width and
           stacks them, which doubled the height of all 52 rows to hold two
           buttons that fit side by side. */
        <div className="prop-action-cell is-row">
          {/**
           * ONE ACTION HERE, AND IT IS NOT A DECISION.
           *
           * Shortlist and Reject have moved to Step 2 — MD Review & Decision,
           * where the queue is only what is actually waiting on an answer.
           * This step is the intake: every site in front of us, whichever door
           * it came through, and the only thing to do from a row is add
           * another site for the same store or read what was captured.
           *
           * "Find a site" IS ON EVERY ROW, not just the ones with nothing
           * filed. A store can look at ten shops before it signs one, and the
           * button disappearing the moment the first was captured meant the
           * second had to be filed from inside the project — which is the
           * detour this queue exists to remove.
           */}
          {/**
           * A SUBMITTED APPLICATION IS DECIDED, NOT SOURCED.
           *
           * `EnquiryDecisionModal` — which lists an application's properties
           * with a tick box each, "3 properties — tick the ones to take
           * forward", and sends the ticked ones to `routeSubmission` — was
           * already imported and rendered on this page, but `setDeciding` was
           * never called anywhere: the picker was built and unreachable. These
           * rows are exactly the ones it is for, so this is the way in.
           *
           * Captured rows keep "Find a site": a store can look at ten shops
           * before it signs one, and that button is how the second is filed.
           */}
          {r.enquiryId ? (
            <button
              type="button" className="prop-action-btn"
              onClick={() => setDeciding({ id: r.enquiryId })}
              title={`Review what ${r.submittedByName || 'they'} sent and tick the sites to take forward`}
            >
              <ClipboardCheck size={12} /> Review sites
            </button>
          ) : (
            <button
              type="button" className="prop-action-btn is-quiet"
              onClick={() => setSourcing(r)}
              title={r.projectId
                ? `Capture another site for ${r.projectName}`
                : `Start a store in ${r.city || 'this city'}, then capture the site`}
            >
              <MapPin size={12} /> Find a site
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

    /* WHERE IT IS, AND WHERE IT CAME FROM — first after the action, because
       that is how this queue is scanned: the place, then who brought it, then
       whether anybody is on it. The four pillars follow immediately. */
    /* City is the sortable fact; the locality and the street address are the
       same answer at finer grain, so they are subtext rather than two more
       columns. */
    {
      key: 'city', label: 'Location', width: 204, sort: true,
      render: (r) => {
        const sub = [r.locality, r.address].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
        const s = r.submission;
        if (!r.city && !sub) return dash;
        return (
          <>
            <div className="prop-name" title={r.city}>
              {r.city || '—'}
              {/* ONE APPLICANT, SEVERAL SITES. Enquiries come off the server
                  newest-first with each application's properties consecutive,
                  so these rows already sit together — what was missing was any
                  mark saying so. Read without it they are three unrelated
                  cities that happen to share a phone number. The same fact is
                  on the Property column's chip, but that column is ~1,200px to
                  the right: a grouping you have to scroll to find is not a
                  grouping. */}
              {s?.total > 1 && (
                <span
                  className="prop-site-no"
                  title={`Property ${s.index} of ${s.total} sent by ${s.by} in one application`}
                >
                  {s.index}/{s.total}
                </span>
              )}
            </div>
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
            {s?.total > 1 && <div className="prop-sub" title={`Sent by ${s.by}`}>{s.by}</div>}
          </>
        );
      },
    },
    { key: 'source', label: 'Source', width: 148, sort: true, render: (r) => <SourceBadge source={r.source} /> },

    /* THE FOUR PILLARS — who owns this step, who did it, when it was due and
       when it actually happened. Right behind where and whence, and ahead of
       everything about the property itself: "is anyone on this and is it
       late" is answered before any particular fact about the site. */
    ...whoWhenColumns('capture', {
      getPlan: (r) => r.capturePlan,
      getDoneBy: (r) => r.filedBy,
      getDoneAt: (r) => r.filedAt,
    }),

    {
      /**
       * A STORE WITH NO SITE YET HAS NO PROPERTY, and says so.
       *
       * These rows printed "New store — Bareilly" in the Property column,
       * which reads as a property called that — a site somebody could open,
       * assess, sign. There is nothing: the store is an ask, the site is what
       * is missing, and the Location column already says where. A dash is the
       * truthful cell; the row's own name still drives search and the report.
       */
      key: 'title', label: 'Property', width: 210, sort: true,
      render: (r) => (r.stage === 'demand'
        ? <span className="prop-dim" title="No site captured for this store yet — use Find a site">—</span>
        : <PropertyCell row={r} />),
    },

    /* From here the columns are the Phase 1 capture form, field for field and
       in its own order — Property Information, then Commercial, then the
       contacts, then what was attached. A reader who filled that form in can
       find anything on this sheet without being told where it went. */
    {
      key: 'area', label: 'Carpet area', width: 138, sort: true,
      render: (r) => (r.areaSqft ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : dash),
    },
    { key: 'frontage', label: 'Frontage', width: 100, render: (r) => (r.details?.frontageFt ? `${r.details.frontageFt} ft` : dash) },
    { key: 'floor', label: 'Floor', width: 84, render: (r) => text(r.floor) },
    { key: 'gps', label: 'Live location', width: 134,
      render: (r) => (r.details?.liveLocation
        ? (
          <a
            className="prop-link"
            href={`https://www.google.com/maps?q=${r.details.liveLocation.lat},${r.details.liveLocation.lng}`}
            target="_blank"
            rel="noreferrer"
            title={`${r.details.liveLocation.lat}, ${r.details.liveLocation.lng}`}
          >
            Map ›
          </a>
        )
        : dash),
    },
    { key: 'ctype', label: 'Commercial type', width: 152, render: (r) => text(r.details?.commercialType) },
    { key: 'rent', label: 'Monthly rent', width: 132, render: (r) => money(r.details?.monthlyRent) },
    { key: 'deposit', label: 'Deposit', width: 112, render: (r) => money(r.details?.deposit) },
    { key: 'available', label: 'Available from', width: 142, render: (r) => fmtDate(r.details?.availableFrom) || dash },
    { key: 'lease', label: 'Lease amount', width: 136, render: (r) => money(r.details?.leaseAmount) },
    { key: 'leaseYrs', label: 'Lease (yrs)', width: 112, render: (r) => (r.details?.leaseDuration ? String(r.details.leaseDuration) : dash) },
    { key: 'owner', label: 'Owner', width: 140, render: (r) => person(r.details?.ownerName, r.details?.ownerPhone) },
    { key: 'broker', label: 'Broker', width: 140, render: (r) => person(r.details?.brokerName, r.details?.brokerPhone) },
    filesColumn((row, at) => setMedia({ row, at })),
    /* What the QUEUE knows on top of the form — where the property has got to
       and who is behind it. Last, because the form is what was asked for. */
    { key: 'stage', label: 'Stage', width: 104, sort: true, render: (r) => <StageBadge stage={r.stage} /> },
    /* The person on the OTHER side — the franchisee, the broker, whoever sent
       it. Not the same as who filed it for us, which is "Captured by". */
    { key: 'submittedBy', label: 'Contact', width: 140, sort: true, render: (r) => <ContactCell row={r} /> },
    {
      key: 'project', label: 'Project', width: 160, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">Not on a project yet</span>),
    },
    {
      key: 'assessments', label: 'Assessments', width: 142, sort: true,
      render: (r) => (r.assessments?.length
        ? <span className={`prop-tally${r.assessmentsComplete ? ' is-done' : ''}`}>{r.assessmentsFiled}/{r.assessments.length} filed</span>
        : <span className="prop-dim">Not routed</span>),
    },
    {
      key: 'documents', label: 'Documents', width: 132, sort: true,
      render: (r) => (r.documents?.length
        ? <span className={`prop-tally${r.documentsFiled === 6 ? ' is-done' : ''}`}>{r.documentsFiled}/6 filed</span>
        : dash),
    },

    /* LAST, and deliberately. Notes are the one free-text field on the form —
       they are read when somebody has already found the row they want, never
       scanned down a column, and putting them mid-sheet pushed the facts that
       ARE scanned off the right-hand edge. */
    { key: 'remarks', label: 'Notes', width: 260, render: (r) => <NotesCell row={r} /> },
  ], [navigate]);

  /**
   * The Rejected tab's own sheet — a SHORTER one, on purpose.
   *
   * A rejected property is not being worked, so the forty columns of rent,
   * frontage and lease term that the live queue needs are not what anybody is
   * here for. Three questions are: what was it, why did we say no, and how far
   * had it got. Those are the columns, and the action is the one thing left to
   * do with the row.
   */
  const rejectedColumns = useMemo(() => [
    {
      key: 'action', label: 'Action', width: 190,
      render: (r) => (
        <div className="prop-action-cell">
          {/* Only a property that is actually a record can be put back —
              a declined public submission has nothing to re-open. */}
          {r.recordId && (
            <button
              type="button"
              className="prop-action-btn"
              onClick={() => setReverting(r)}
              title="Put it back in the pipeline — you choose which step it starts from"
            >
              <RotateCcw size={12} /> Revert
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
    {
      key: 'city', label: 'Location', width: 204, sort: true,
      render: (r) => {
        const sub = [r.locality, r.address].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
        const s = r.submission;
        if (!r.city && !sub) return dash;
        return (
          <>
            <div className="prop-name" title={r.city}>
              {r.city || '—'}
              {/* ONE APPLICANT, SEVERAL SITES. Enquiries come off the server
                  newest-first with each application's properties consecutive,
                  so these rows already sit together — what was missing was any
                  mark saying so. Read without it they are three unrelated
                  cities that happen to share a phone number. The same fact is
                  on the Property column's chip, but that column is ~1,200px to
                  the right: a grouping you have to scroll to find is not a
                  grouping. */}
              {s?.total > 1 && (
                <span
                  className="prop-site-no"
                  title={`Property ${s.index} of ${s.total} sent by ${s.by} in one application`}
                >
                  {s.index}/{s.total}
                </span>
              )}
            </div>
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
            {s?.total > 1 && <div className="prop-sub" title={`Sent by ${s.by}`}>{s.by}</div>}
          </>
        );
      },
    },
    { key: 'title', label: 'Property', width: 220, sort: true, render: (r) => <PropertyCell row={r} /> },
    { key: 'source', label: 'Source', width: 148, sort: true, render: (r) => <SourceBadge source={r.source} /> },
    {
      /* HOW FAR IT GOT BEFORE WE SAID NO. The single most useful column here:
         it is the difference between a shop nobody visited and one we assessed
         four ways, and it is what the revert dialog defaults from. */
      key: 'rejectedFrom', label: 'Rejected at', width: 190,
      render: (r) => (REJECTED_FROM_LABEL[r.rejectedFrom]
        ? <span title={`It was standing on ${REJECTED_FROM_LABEL[r.rejectedFrom]} when it was rejected`}>{REJECTED_FROM_LABEL[r.rejectedFrom]}</span>
        : dash),
    },
    { key: 'decidedBy', label: 'Rejected by', width: 150, render: (r) => text(r.decision?.by) },
    { key: 'decidedOn', label: 'Rejected on', width: 130, render: (r) => fmtDate(r.decision?.at) || dash },
    {
      /* The reason, in full and never folded. It is the whole point of keeping
         the row, and a rejection reason truncated to one line is the sentence
         everybody has to open the record to finish reading. */
      key: 'reason', label: 'Reason', width: 320,
      render: (r) => (r.decision?.reason
        ? <span className="prop-notes-full" title={r.decision.reason}>{r.decision.reason}</span>
        : <span className="prop-dim">No reason recorded</span>),
    },
    {
      key: 'project', label: 'Project', width: 160, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">Not on a project yet</span>),
    },
    {
      key: 'assessments', label: 'Assessments', width: 142,
      render: (r) => (r.assessments?.length
        ? <span className="prop-tally">{r.assessmentsFiled}/{r.assessments.length} filed</span>
        : <span className="prop-dim">None opened</span>),
    },
    filesColumn((row, at) => setMedia({ row, at })),
    { key: 'remarks', label: 'Notes', width: 260, render: (r) => <NotesCell row={r} /> },
  ], [navigate]);

  /**
   * Columns nobody on this page has an answer for are dropped.
   *
   * The capture form asks either/or questions: a property on RENT has a
   * monthly rent and a deposit and no lease at all; one on LEASE has a lease
   * amount and a duration and no rent. Printing both sets for every row meant
   * half the commercial columns were a wall of dashes, and the reader had to
   * cross the empty half to reach anything real. So each of these columns
   * earns its place from the rows actually on screen — the ones the forms
   * behind this page were filled in with.
   *
   * Only the either/or fields are treated this way. A column that is
   * ALWAYS meaningful (the property, the city, the stage) stays even when a
   * page of rows happens to be missing it, because its absence is then a fact
   * about those rows rather than about the question.
   */
  const shown = useMemo(() => {
    const optional = {
      frontage: (r) => r.details?.frontageFt,
      ctype: (r) => r.details?.commercialType,
      rent: (r) => r.details?.monthlyRent,
      deposit: (r) => r.details?.deposit,
      available: (r) => r.details?.availableFrom,
      lease: (r) => r.details?.leaseAmount,
      leaseYrs: (r) => r.details?.leaseDuration,
      gps: (r) => r.details?.liveLocation,
    };
    const rows = q.rows || [];
    return columns.filter((c) => {
      const read = optional[c.key];
      if (!read) return true;
      return rows.some((r) => {
        const v = read(r);
        return v !== null && v !== undefined && v !== '';
      });
    });
  }, [columns, q.rows]);

  return (
    <>
      {/* The heading answers the tab, not the route. Reading the rejected pile
          under "Every property, whichever door it came in through" reads as a
          rendering fault — those rows came in through every door too, and the
          thing they have in common is the answer, not the door. */}
      <PageHead
        title={rejectedView
          ? 'Every property we have said no to'
          : 'Every property, whichever door it came in through'}
        subtitle={rejectedView
          ? 'Kept, with the reason and the step it was turned down at. Revert one and you choose where it starts again.'
          : 'Franchisee submissions, broker leads, sourcing requests and captured sites, in one queue.'}
      />
      {/* The intake bar adds properties. Nothing on the rejected list is being
          added, so the doors are put away rather than offered over a list of
          closed decisions. */}
      {!rejectedView && <PropertyIntakeBar />}
      <PropertyToolbar
        q={q}
        tab={tab}
        onTab={pickTab}
        tabs={[
          ...TABS,
          /* Last in the strip, and only once there is something in it. A
             permanently visible tab that opens an empty list is a control that
             teaches people to ignore controls — but it stays while you are
             STANDING on it, or reverting the last rejected property pulls the
             tab out from under the reader mid-click. */
          ...(q.counts?.rejected > 0 || rejectedView
            ? [{
              key: REJECTED_TAB,
              label: 'Rejected',
              count: q.counts.rejected,
              tone: 'rejected',
              hint: 'Properties we turned down, at whichever step — revert one from here',
            }]
            : []),
        ]}
      />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : q.rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters'
                : rejectedView ? 'Nothing has been rejected' : 'Nothing here yet'}
              hint={q.active ? 'Clear the filters to see the whole step.'
                : rejectedView ? 'Properties turned down at any step are kept here, with their reason.'
                  : EMPTY_HINT}
            />
          ) : (
            <>
              <PropTable
                columns={rejectedView ? rejectedColumns : shown}
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

      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}

      {/* PUTTING ONE BACK. The dialog asks the MD which step it restarts from
          and writes that through the same change-decision call Step 2 uses —
          see PropertyRevertModal. The row leaves this tab the moment it lands,
          which is why the flash names where it went: a row vanishing with no
          word for it reads as a row that was deleted. */}
      {reverting && (
        <PropertyRevertModal
          row={reverting}
          onClose={() => setReverting(null)}
          onDone={(_result, step) => {
            setReverting(null);
            flashSuccess(`${reverting.title || reverting.city} is back in the pipeline — it starts at ${step.label}`);
          }}
        />
      )}

      {deciding && (
        <EnquiryDecisionModal
          enquiryId={deciding.id}
          onClose={() => setDeciding(null)}
          onDone={(result) => {
            setDeciding(null);
            /* Follow the property to the step the server says it landed on —
               the decision and its consequence in one movement, same as a
               captured property's routing does. */
            if (result?.nextStage === 'commercial') navigate('/property/commercial');
            else if (result?.nextStage === 'assessment') navigate('/property/assessment');
          }}
        />
      )}

      {/* THE HAND-OFF, END TO END. "Find a site" is answered by capturing the
          site, so it opens the capture flow rather than stopping at a project
          form. A request that already has a project goes straight to the
          property form; one that does not creates the project first, seeded
          with what the lead told us, and carries on into the same form without
          anybody being sent to another page. Same component as the toolbar's
          own Capture a property — one capture form, in one place. */}
      <PropertyCaptureModal
        open={Boolean(sourcing)}
        onClose={() => setSourcing(null)}
        startProject={sourcing?.projectId
          /* The city rides along: the form states where the store is before it
             asks anything about the site, and the row already knows it. */
          ? { _id: sourcing.projectId, name: sourcing.projectName, city: sourcing.city }
          : null}
        prefill={sourcing && !sourcing.projectId ? {
          city: sourcing.city || '',
          name: sourcing.city ? `Mystery Rooms ${sourcing.city}` : '',
          /* Their own words on where they want it, carried into the brief so
             whoever picks up the search is not starting from a city name. */
          notes: [sourcing.locality && `Preferred area: ${sourcing.locality}`,
            sourcing.submittedByName && `Requested by ${sourcing.submittedByName}`
              + (sourcing.submittedByPhone ? ` (${sourcing.submittedByPhone})` : '')]
            .filter(Boolean).join('\n'),
        } : null}
      />
    </>
  );
}
