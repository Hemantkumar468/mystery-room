import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  RotateCcw, Building2, CheckCircle2, Clock, XCircle,
  Users, FileText, ArrowRight, ChevronDown, ChevronRight, Search, SlidersHorizontal,
  Upload, Download, Eye, Pencil, Trash2, Link2, Plus,
} from 'lucide-react';
import '../../styles/property-capture-blue.css';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropertyIntakeBar } from './PropertyIntakeBar.jsx';
import { EnquiryDecisionModal } from './EnquiryDecisionModal.jsx';
import { PropertyCaptureModal } from './PropertyCaptureModal.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PropertyCell, SourceBadge,
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
  { key: 'broker', label: 'Broker' },
  /* Not an agent and not an applicant — someone who simply knows of a site. */
  { key: 'other', label: 'Other' },
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

/**
 * WHERE A PROPERTY HAS GOT TO, in one word.
 *
 * The DECISION leads, because that is the thing people are waiting on and
 * the thing that changes under them: a site sitting in Assessment that the
 * MD has just turned down is Rejected, not "In Review", and a queue that
 * kept saying In Review until some background stage moved would be telling
 * yesterday's news. `decision.state` is written by the same decide() call
 * the MD screens use, so this follows those the moment they happen.
 *
 * Stage is the fallback, for a property nobody has ruled on yet.
 */
function rowStatus(r) {
  const d = r.decision?.state;
  if (d === 'rejected' || r.stage === 'rejected') return { cls: 's-no', label: 'Rejected' };
  if (d === 'approved') return { cls: 's-go', label: 'Approved' };
  if (d === 'shortlisted' || r.status === 'shortlisted') return { cls: 's-done', label: 'Shortlisted' };

  if (r.stage === 'commercial') return { cls: 's-go', label: 'In Commercial' };
  if (r.stage === 'assessment') return { cls: 's-go', label: 'In Review' };
  if (r.status === 'draft') return { cls: 's-wait', label: 'Draft' };
  if (r.status === 'awaiting_review' || r.status === 'submitted') return { cls: 's-go', label: 'Awaiting review' };
  if (r.filedAt || r.recordId) return { cls: 's-done', label: 'Captured' };
  if (r.capturePlan?.assignedNames?.length) return { cls: 's-wait', label: 'Assigned' };
  return { cls: 's-wait', label: 'Not Started' };
}

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
  /* Which property's decision is being read — see the Status column. */
  const [whyRow, setWhyRow] = useState(null);
  /* The phase rail is reference material, not the work — open by default,
     but foldable so it stops eating a fifth of the screen once known. */
  const [flowOpen, setFlowOpen] = useState(true);

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
    /* A plain row number. Not an id and not sortable: it answers "which of
       these am I looking at" while reading down a long table, and an id in
       that position would invite people to quote it. */
    {
      key: 'rowNo',
      label: '#',
      width: 46,
      render: (_r, i) => <span className="prop-dim">{(q.page - 1) * q.limit + i + 1}</span>,
    },

    /* SOURCE LEADS. The first fact decides how the row is read at all: a
       franchisee's application and a site our own team sourced are different
       objects that happen to share a table. */
    { key: 'source', label: 'Source', width: 148, sort: true, render: (r) => <SourceBadge source={r.source} /> },

    /* WHERE IT IS — first after the action, because
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
              {/* The row IS the whole application now, so "1/2" — which meant
                  "you are looking at the first of two rows" — would be a lie
                  about a row that holds both. The count is the honest form. */}
              {r.siblings?.length > 1 && (() => {
                const n = r.siblings.filter((x) => x.stage !== 'demand' && x.title).length;
                return (
                  <span
                    className="prop-site-no"
                    title={`${r.siblings.length} rows in this location — ${n} of them with a property on it`}
                  >
                    {n ? `${n} propert${n === 1 ? 'y' : 'ies'}` : `${r.siblings.length} rows`}
                  </span>
                );
              })()}
            </div>
            {sub && <div className="prop-sub" title={sub}>{sub}</div>}
            {s?.total > 1 && <div className="prop-sub" title={`Sent by ${s.by}`}>{s.by}</div>}
          </>
        );
      },
    },
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
      key: 'title', label: 'Property', width: 260, sort: true,
      render: (r) => {
        /* ONE LOCATION, ONE ROW, ITS PROPERTIES LISTED AND NUMBERED.
           Bhopal was six rows that looked unrelated and repeated the city six
           times. The location is what people ask about, so it is the row; the
           properties are what the row is about, so they are its contents.

           Only the rows that hold a site are listed — a "New Store" row is a
           store waiting for a property, not a property, and numbering it
           would claim a site that does not exist. */
        const sites = (r.siblings || []).filter((s) => s.stage !== 'demand' && s.title);
        /* Checked AFTER the group, not before it: the row standing for a
           location is whichever of its rows came back first, and that is
           often a "New Store" with no site of its own. Testing `demand`
           first made a location with four properties print a dash, because
           its representative happened to be the store still looking. */
        if (!sites.length) {
          /* Nothing filed here yet. No button: clicking anywhere on the row
             opens the capture form on this location, so a second control in
             the cell was one affordance too many for the same act. */
          return <span className="prop-dim" title="Nothing captured here yet — click the row to add it">—</span>;
        }
        if (sites.length) {
          return (
            /* Still an <ol>: the numbering is content, not decoration —
               "property 2" is what gets said on the phone. The marker is drawn
               explicitly because a default one sits outside the box, and each
               site needs to read as its own row inside the cell. */
            <ol className="prop-sitelist">
              {sites.map((s, n) => (
                <li key={s.id} title={[s.title, s.locality, s.city].filter(Boolean).join(' · ')}>
                  <span className="prop-sitelist-no" aria-hidden="true">{n + 1}</span>
                  <span className="prop-sitelist-body">
                    <span className="prop-sitelist-name">{s.title}</span>
                    {(s.locality || s.city) && (
                      <span className="prop-sitelist-sub">
                        {[s.locality, s.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}
                      </span>
                    )}
                  </span>
                  {/* `stopPropagation` because the row is clickable too, and
                      that would open the wrong property. */}
                  <button
                    type="button"
                    className="prop-sitelist-view"
                    title={`Open the full report for ${s.title}`}
                    onClick={(e) => { e.stopPropagation(); setDetails(s); }}
                  >
                    View
                  </button>
                </li>
              ))}
            </ol>
          );
        }
        return <PropertyCell row={r} />;
      },
    },


    /* THE FOUR PILLARS — who owns this step, who did it, when it was due and
       when it actually happened. Right behind where and whence, and ahead of
       everything about the property itself: "is anyone on this and is it
       late" is answered before any particular fact about the site. */
    {
      /* BESIDE THE PROPERTY, NOT AT THE FAR END OF THE ROW.
         "Where has this got to" is asked while looking at the property, and
         at the end of fourteen columns it was a scroll away from the thing
         it describes. Stacked per site for the same reason the who/when
         columns are: five properties in one location are at five different
         points, and one word for all five would be wrong four times. */
      key: 'siteStatus',
      label: 'Status',
      width: 132,
      render: (r) => {
        const sites = (r.siblings || []).filter((s) => s.stage !== 'demand' && s.title);
        /* THE WORD, AND THE REASON BEHIND IT.
           "Rejected" answers what happened and not why, and the why is the
           part somebody rings up about. The chip opens the decision that
           produced it: who said so, when, and what they wrote. */
        const chip = (x) => {
          const s = rowStatus(x);
          return (
            <button
              type="button"
              className="pc2-status-btn"
              title="Who decided this, when, and why"
              onClick={(e) => { e.stopPropagation(); setWhyRow(x); }}
            >
              <span className={`pc2-status ${s.cls}`}>{s.label}</span>
            </button>
          );
        };
        if (sites.length <= 1) return chip(r);
        return (
          <span className="pc2-stack">
            {sites.map((s) => <span className="pc2-stack-i" key={s.id}>{chip(s)}</span>)}
          </span>
        );
      },
    },


    /**
     * A GROUPED ROW HAS NO SINGLE ANSWER TO THESE.
     *
     * Assigned / Done by / Plan date / Actual date are per-property facts,
     * and a location row stands for several. Left as they were, each column
     * printed the FIRST property's value across the whole group, which is
     * not a rounding error — it names the wrong person. Where the group has
     * more than one site the cell says where to look instead; the boxes in
     * the Property column carry each site's own.
     */
    ...whoWhenColumns('capture', {
      getPlan: (r) => r.capturePlan,
      getDoneBy: (r) => r.filedBy,
      getDoneAt: (r) => r.filedAt,
    }),



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
    /* Stage, Contact and Assessments are gone from this sheet. The tabs and
       the flow rail above already say where a row stands, and the assessment
       tally is Step 3 reading matter - three columns of it mid-sheet pushed
       the captured facts off the right-hand edge. */
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
  ], []);

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
              {/* The row IS the whole application now, so "1/2" — which meant
                  "you are looking at the first of two rows" — would be a lie
                  about a row that holds both. The count is the honest form. */}
              {r.siblings?.length > 1 && (
                <span
                  className="prop-site-no"
                  title={`${r.siblings.length} sites sent by ${s?.by || 'this applicant'} in one application`}
                >
                  {r.siblings.length} sites
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

    /* The action last and pinned, as on every other step — read the row,
       then answer it. See `pin: 'right'` in PropTable.jsx. */
    {
      key: 'action', pin: 'right', label: 'Action', width: 190,
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
  /* WHERE IT IS, WHAT IS NEXT, AND WHAT YOU CAN DO — the three the mockup
     ends every row with. All three are derived from the row rather than
     stored, so none of them can drift out of step with the data beside it. */
  const endColumns = useMemo(() => [
    {
      key: 'rowActions',
      label: 'Action',
      /* Measured, not guessed: View + Edit + Reject come to 230px with the
         cell's padding, so 208 clipped Reject. It only showed once the column
         was pinned — until then `overflow: hidden` cut it off in silence. */
      width: 232,
      /* Last already, and now pinned to the right edge so a 14" screen does
         not have to scroll a 2,000px table to reach View, Edit and Reject. */
      pin: 'right',
      render: (r) => (
        <span className="pc2-acts">
          <button
            type="button"
            className="pc2-act a-view"
            onClick={(e) => { e.stopPropagation(); if (r.enquiryId) setDeciding({ id: r.enquiryId }); else setDetails(r); }}
          >
            <Eye size={12} /> View
          </button>
          {/* Edit opens the capture form on this row — the same one the
              toolbar opens, started on the store this property belongs to. */}
          <button
            type="button"
            className="pc2-act"
            onClick={(e) => { e.stopPropagation(); setSourcing(r); }}
          >
            <Pencil size={12} /> Edit
          </button>
          {/* Reject is the existing decision, not a new one: same dialog, same
              reason-required rule, same audit trail. */}
          <button
            type="button"
            className="pc2-act a-reject"
            onClick={(e) => {
              e.stopPropagation();
              if (r.enquiryId) setDeciding({ id: r.enquiryId });
              else setDetails(r);
            }}
          >
            <Trash2 size={12} /> Reject
          </button>
        </span>
      ),
    },
  ], []);

  /* Applied to the who/when columns after they are built, so the shared
     helper stays shared and only this page's grouping is accounted for. */
  const perSiteAware = useMemo(() => {
    const keys = new Set(['captureAssigned', 'captureDoneBy', 'capturePlanDate', 'captureDoneAt']);
    return columns.map((c) => (keys.has(c.key)
      ? {
        ...c,
        /**
         * ONE VALUE PER PROPERTY, ON THE PROPERTY'S OWN LINE.
         *
         * A location row stands for several sites with several owners and
         * several dates, so a single cell value here named the first site's
         * person for all of them. Each site now gets its own line, and the
         * lines are height-matched to the boxes in the Property column so
         * line 3 here is line 3 there. That alignment is why those boxes are
         * a fixed height: ragged boxes would put the right answer beside the
         * wrong property, which is worse than saying nothing.
         */
        render: (r, i) => {
          const sites = (r.siblings || []).filter((s) => s.stage !== 'demand' && s.title);
          if (sites.length <= 1) return c.render(r, i);
          return (
            <span className="pc2-stack">
              {sites.map((s) => (
                <span className="pc2-stack-i" key={s.id}>{c.render(s, i)}</span>
              ))}
            </span>
          );
        },
      }
      : c));
  }, [columns]);

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
    return perSiteAware.filter((c) => {
      const read = optional[c.key];
      if (!read) return true;
      return rows.some((r) => {
        const v = read(r);
        return v !== null && v !== undefined && v !== '';
      });
    });
  }, [perSiteAware, q.rows]);

  /**
   * One row per APPLICATION, not per property.
   *
   * The server emits a franchise application as one row per property, already
   * consecutive. Folding them here rather than server-side keeps every other
   * consumer of that feed — the step counts, the other queues — reading the
   * shape they always did; only this table wants the submission view.
   */
  const grouped = useMemo(() => {
    const out = [];
    const seen = new Map();
    for (const r of q.rows || []) {
      /* THE LOCATION IS THE ROW. Bhopal held six rows — two stores opened
         twice, a franchise application and captured sites — and reading down
         the city column you met the same word six times without learning they
         were the same place. One row per city, everything filed there listed
         inside it, is the question people bring to this queue: "what have we
         got in Bhopal?" */
      const key = String(r.city || '').trim().toLowerCase();
      if (!key) { out.push(r); continue; }
      const at = seen.get(key);
      if (at == null) {
        seen.set(key, out.length);
        out.push({ ...r, siblings: [r] });
      } else {
        out[at] = { ...out[at], siblings: [...out[at].siblings, r] };
      }
    }
    /* A city with a single row is just that row — nothing to collapse, so
       `siblings` is dropped and the cell renders exactly as it always did. */
    return out.map(({ siblings, ...rest }) => (
      siblings && siblings.length > 1 ? { ...rest, siblings } : rest
    ));
  }, [q.rows]);

  const allTabs = [
    ...TABS,
    /* Last in the strip, and only once there is something in it. A
       permanently visible tab that opens an empty list teaches people to
       ignore controls — but it stays while you are STANDING on it, or
       reverting the last rejected property pulls the tab out mid-click. */
    ...(q.counts?.rejected > 0 || rejectedView
      ? [{ key: REJECTED_TAB, label: 'Rejected', count: q.counts.rejected }]
      : []),
  ];

  const k = q.counts || {};
  const total = q.total ?? 0;
  const from = total === 0 ? 0 : (q.page - 1) * q.limit + 1;
  const to = Math.min(q.page * q.limit, total);

  return (
    <>
      {/* The page head, the KPI strip and the phase rail are drawn by
          PropertySteps for all six steps — see the comment there. What is left
          on this page is what is actually particular to it: the intake doors,
          the source tabs, the table and its footer. */}
      {/* The intake bar adds properties. Nothing on the rejected list is being
          added, so the doors are put away rather than offered over a list of
          closed decisions. */}
      {!rejectedView && <PropertyIntakeBar />}

      <div className="pc2-bar">
        <div className="pc2-tabs">
          {allTabs.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              className={`pc2-tab${tab === t.key ? ' is-on' : ''}`}
              onClick={() => pickTab(t.key)}
            >
              {t.label}
              {t.count != null && <span className="pc2-tab-c">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="pc2-bar-right">
          <span className="pc2-search">
            <Search size={14} />
            <input
              value={q.search || ''}
              onChange={(e) => q.setSearch(e.target.value)}
              placeholder="Search property, city or person…"
            />
          </span>
          <select className="pc2-select" value={q.city || ''} onChange={(e) => q.setCity(e.target.value)}>
            <option value="">All Cities</option>
            {(q.cities || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="pc2-btn" onClick={() => q.clear?.()} title="Clear every filter">
            <SlidersHorizontal size={13} /> Filters
          </button>
        </div>
      </div>

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
              <div className="pc2-tablewrap">
              <PropTable
                columns={rejectedView ? rejectedColumns : [...shown, ...endColumns]}
                rows={grouped}
                rowKey={(r) => r.id}
                sort={q.sort}
                onSort={q.toggleSort}
                busy={q.isFetching}
                onRowClick={(r) => {
                  if (r.enquiryId) return setDeciding({ id: r.enquiryId });
                  /* A location with no site has no report to open — sending
                     the reader to an empty one answers a question they did
                     not ask. What they want from that row is to fill it. */
                  const hasSite = (r.siblings || [r]).some((s) => s.stage !== 'demand' && s.title);
                  return hasSite ? setDetails(r) : setSourcing(r);
                }}
              />
              </div>
              <div className="pc2-foot">
                <span>Showing {from} to {to} of {total} properties</span>
                <span className="pc2-pages">
                  <button type="button" className="pc2-page" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>&lsaquo;</button>
                  {Array.from({ length: q.totalPages || 1 }, (_, i) => i + 1)
                    /* Only a window around the current page: 20 numbered
                       buttons is a paragraph, not a control. */
                    .filter((n) => Math.abs(n - q.page) <= 2 || n === 1 || n === q.totalPages)
                    .map((n, i, arr) => (
                      <Fragment key={n}>
                        {i > 0 && arr[i - 1] !== n - 1 && <span className="prop-dim">…</span>}
                        <button
                          type="button"
                          className={`pc2-page${n === q.page ? ' is-on' : ''}`}
                          onClick={() => q.setPage(n)}
                        >
                          {n}
                        </button>
                      </Fragment>
                    ))}
                  <button type="button" className="pc2-page" disabled={q.page >= (q.totalPages || 1)} onClick={() => q.setPage(q.page + 1)}>&rsaquo;</button>
                </span>
                <span className="pc2-rows">
                  Rows per page
                  <select className="pc2-select" value={q.limit} onChange={(e) => q.setLimit(Number(e.target.value))}>
                    {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </span>
              </div>
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
      {whyRow && (() => {
        const s = rowStatus(whyRow);
        const d = whyRow.decision || {};
        return (
          <Modal
            open
            onClose={() => setWhyRow(null)}
            title="Why this status"
            subtitle={[whyRow.title, whyRow.city].filter(Boolean).join(' \u00b7 ')}
            width={520}
            footer={(
              <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setWhyRow(null)}>Close</button>
              </div>
            )}
          >
            <div className="pc2-why">
              <div className="pc2-why-row">
                <span>
                  <span className="pc2-why-k">Status</span>
                  <span className={`pc2-status ${s.cls}`}>{s.label}</span>
                </span>
                <span>
                  <span className="pc2-why-k">Decided by</span>
                  <span className="pc2-why-v">{d.by || '\u2014'}</span>
                </span>
                <span>
                  <span className="pc2-why-k">Decided on</span>
                  <span className="pc2-why-v">{d.at ? fmtDate(d.at) : '\u2014'}</span>
                </span>
              </div>
              <div>
                <span className="pc2-why-k" style={{ marginBottom: 4 }}>Reason</span>
                <div className="pc2-why-reason">
                  {d.reason
                    ? d.reason
                    : (
                      /* Said plainly rather than left blank: "no reason" is
                         itself worth knowing when somebody is asking why. */
                      <span className="pc2-why-none">
                        {d.state && d.state !== 'waiting'
                          ? 'No reason was recorded with this decision.'
                          : 'Nobody has decided on this property yet, so there is no reason to show.'}
                      </span>
                    )}
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

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
