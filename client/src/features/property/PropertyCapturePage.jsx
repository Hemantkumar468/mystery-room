import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  RotateCcw, Building2, CheckCircle2, Clock, XCircle,
  Users, FileText, ArrowRight, ChevronDown, ChevronRight, Search,
  Upload, Download, Eye, Link2, Plus,
} from 'lucide-react';
import '../../styles/property-capture-blue.css';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropertyIntakeBar } from './PropertyIntakeBar.jsx';
import { PropertyFilters } from './PropertyFilters.jsx';
import { EnquiryDecisionModal } from './EnquiryDecisionModal.jsx';
import { PropTable } from './PropTable.jsx';
import {
  /* Still used by the Rejected tab's own shorter sheet, below. */
  PropertyCell, SourceBadge, filesColumn, fmtDate, NotesCell,
  PropertyToolbar, PageHead, PropEmpty,
  groupByCity, stackPerSite, dropEmptyColumns,
} from './propertyUi.jsx';
/* Step 2 asks the same question of the same rows, so the status ladder and
   the dialog that explains it live in one place and are imported by both. */
/* THE SHEET ITSELF. Step 1 and Step 2 show the same table of the same
   properties; it is declared once, there, and this page supplies only the
   Action column it owns. */
import { propertySheetColumns, PropertySheetFooter, PER_SITE_KEYS } from './PropertySheet.jsx';
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
  /* The rows the Capture Property button makes, and the tab that lists them,
     now say the same words - the precedent New Store set right above. It was
     "Company Owned", which described who owns the site rather than how it got
     into the queue, and left the control and the filter for one set of rows
     with two different names. */
  { key: 'captured', label: 'Capture Property' },
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
 * Has this row already been turned down?
 *
 * A LOCATION ROW STANDS FOR SEVERAL PROPERTIES, so it only counts as rejected
 * when every site filed under it is. A city holding one dead shop and three
 * live ones is still a city with work in it, and taking Edit and Reject off
 * that row would take them away from the three that still need them.
 *
 * `statusKey` is the server's own answer — the same field the Status chip and
 * the status filter read, so the three cannot disagree.
 */
const isRejected = (r) => {
  const sites = r.siblings?.length ? r.siblings : [r];
  return sites.every((s) => s.statusKey === 'rejected' || s.stage === 'rejected');
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

  /**
   * ALL PROPERTIES MEANS ALL OF THEM, INCLUDING THE NOs.
   *
   * A rejected property used to drop out of this sheet the moment it was
   * turned down, and the only trace left was the Rejected tab — so "I said no
   * to the Lucknow shop, where did it go?" had no answer on the step that
   * lists everything. Worse, the Status dropdown still offered "Rejected"
   * (its options are built from the whole queue) and picking it returned an
   * empty table, because the filter runs after rejected rows are dropped.
   *
   * They are back in, wearing the red Rejected chip in the Status column, and
   * the Action column offers Revert rather than a second rejection.
   *
   * ONLY HERE. Steps 2-7 are queues of work outstanding, and a property we
   * have finished with is not outstanding — see the note in usePropertyQuery.
   */
  const q = usePropertyQuery(rejectedView ? 'rejected' : null, { includeRejected: true });
  const pickTab = (key) => {
    setTab(key);
    q.setSource(key === REJECTED_TAB ? '' : key);
  };

  const [media, setMedia] = useState(null);
  /* Which rejected property is being put back — see PropertyRevertModal. */
  const [reverting, setReverting] = useState(null);
  /* Which submission's approve/reject dialog is open — see EnquiryDecisionModal. */
  const [deciding, setDeciding] = useState(null);
  /* Which property is being read — see PropertyDetailsModal. */
  const [details, setDetails] = useState(null);
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

  /**
   * THE SHEET, FROM THE ONE PLACE IT IS DECLARED.
   *
   * These twenty columns used to be written out here and written out again in
   * PropertyMdReviewPage, and every time one copy was edited the two screens
   * disagreed about the same property — a column on one and not the other, a
   * label spelled two ways, a location's properties counted two ways. Each of
   * those was reported as missing data, which from the reader's side is
   * exactly what it was.
   *
   * The Action column stays here, below, because it is the one thing that is
   * genuinely this step's: Step 1 opens and edits a property, Step 2 rules on
   * it.
   */
  const columns = useMemo(() => propertySheetColumns({
    page: q.page,
    limit: q.limit,
    onMedia: (row, at) => setMedia({ row, at }),
    onDetails: (row) => setDetails(row),
    /* NO onWhy HERE. This is the register — every property we have ever
       looked at — and the Status column is read down, not clicked. Making
       each chip a button meant pressing one on a property nobody had ruled
       on opened a dialog that existed only to say it had nothing to show.
       The decision and its reason are read on Step 2, where deciding is the
       job. */
  }), [q.page, q.limit]);

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
    { key: 'source', label: 'Source', width: 148, sort: true, render: (r) => <SourceBadge source={r.source} /> },
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
      /* View, and Revert on a rejected row — two buttons at most now that
         Edit and Reject have gone to Step 2, so the column no longer needs
         the 232px three of them took. */
      width: 150,
      /* Pinned right so a 14" screen does not have to scroll a 2,000px
         table to reach it. */
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
          {/*
            * VIEW ONLY, PLUS THE WAY BACK.
            *
            * Edit and Reject are gone from this step. Step 1 is the capture
            * register — what has been listed — and deciding is Step 2's job,
            * where the same Reject lives with the rest of the decision.
            * Two places to turn a property down meant two audit trails for
            * one answer, and Edit beside them invited changing a property in
            * the middle of being judged.
            *
            * Revert stays, because a rejected row is the one case with
            * nothing else to offer: it cannot be captured again and it is
            * already turned down, so the only useful action is putting it
            * back in the pipeline.
            */}
          {isRejected(r) && (
            <button
              type="button"
              className="pc2-act"
              onClick={(e) => { e.stopPropagation(); setReverting(r); }}
              title="Put it back in the pipeline — you choose which step it starts from"
            >
              <RotateCcw size={12} /> Revert
            </button>
          )}
        </span>
      ),
    },
  ], []);

  /* Applied after the columns are built, so the shared helper stays shared
     and only this page's grouping is accounted for. */
  const perSiteAware = useMemo(() => stackPerSite(columns, PER_SITE_KEYS), [columns]);

  const shown = useMemo(() => dropEmptyColumns(perSiteAware, q.rows), [perSiteAware, q.rows]);

  /* THE LOCATION IS THE ROW. Bhopal held six rows - two stores opened twice,
     a franchise application and captured sites - and reading down the city
     column you met the same word six times without learning they were the
     same place. One row per city, everything filed there listed inside it, is
     the question people bring to this queue: "what have we got in Bhopal?" */
  const grouped = useMemo(() => groupByCity(q.rows), [q.rows]);

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
          {/* The real thing. This was a button labelled "Filters" whose only
              action was to clear them - it named one thing and did the
              opposite. Source is left out here because the tab strip above IS
              the source filter, and two controls for one state is how they
              come to disagree. */}
          <PropertyFilters q={q} showSource={false} />
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
                /* NO `onRowClick`. The whole row used to open the property
                   report, which meant a stray click anywhere in a wide sheet
                   — while reading a cell, or after dismissing something —
                   threw a dialog over the table. The Action column already
                   carries View, and it says what it will do before you press
                   it. Nothing is lost: View reaches the report (or the
                   submission's decision), Edit opens the capture form for a
                   location with no site yet, and Reject the decision dialog. */
              />
              </div>
              <PropertySheetFooter q={q} />
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

      {/* The reject dialog and its state went with the Reject button: Step 1
          had the only way in, and a dialog nothing can open is a component
          that will be edited for years without ever being seen. Turning a
          property down lives in Step 2 now. */}

      {deciding && (
        <EnquiryDecisionModal
          enquiryId={deciding.id}
          initialMode={deciding.mode || null}
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
      {/* The capture form that Edit opened went with it. The toolbar's own
          "Capture Property" still opens the same component — this instance
          had no other way in, so it only ever rendered closed. */}
    </>
  );
}
