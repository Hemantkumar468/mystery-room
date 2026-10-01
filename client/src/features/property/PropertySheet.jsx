import { Fragment } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import {
  SourceBadge, filesColumn, fmtDate, whoWhenColumns,
  sitesOf, NotesCell, person, brokerOf,
} from './propertyUi.jsx';
import { StatusChip } from './PropertyWhyStatusModal.jsx';

/**
 * THE PROPERTY SHEET — declared once, rendered by every step that shows it.
 *
 * Step 1 and Step 2 are the same table of the same properties asked two
 * different questions. They were two files that each declared the same
 * twenty-odd columns, and the cost of that was not the duplication itself but
 * what it let happen quietly: one file gained a column, the other did not; one
 * spelled a label "Terms" and the other "Commercial type"; one counted a
 * location's properties one way and the other another. Every one of those was
 * reported as missing data, because from the reader's side that is exactly
 * what it looks like.
 *
 * So the columns live here and the pages import them. A step supplies only
 * what is genuinely its own:
 *
 *   - `action`   the one column it owns, pinned right. Step 1 offers View /
 *                Edit / Reject; Step 2 offers the verdict. That is the whole
 *                difference between the two screens.
 *   - `insertAfter`  a map of {columnKey: [columns]} for facts one step has
 *                and the other does not — Step 2's Decided by / Decided on
 *                sit behind the capture dates, not at the end.
 *
 * Everything else — the row number, the grouping chip, the numbered property
 * boxes, the status chips, the four pillars, the whole capture form, Files,
 * Documents, Notes — is this file's, and neither page can change it alone.
 */

const dash = <span className="prop-dim">—</span>;
const text = (v) => (v ? <span title={v}>{v}</span> : dash);
const money = (n) => (Number.isFinite(Number(n)) && Number(n) !== 0
  ? <span className="prop-num">{Number(n).toLocaleString('en-IN')}</span>
  : dash);

/**
 * WHERE IT IS — the row's own identity, and the one column on the sheet that
 * genuinely belongs to the whole group rather than to a property in it.
 *
 * City is the sortable fact; the locality and the street address are the same
 * answer at finer grain, so they are subtext rather than two more columns.
 *
 * Exported because every step that groups by location needs exactly this cell
 * and its count chip. Two steps writing their own is how one of them ends up
 * counting a location's properties differently from the other.
 */
export const cityColumn = ({ width = 140 } = {}) => ({
  key: 'city', label: 'City', width, sort: true,
  render: (r) => {
    if (!r.city) return dash;
    return (
      <div className="prop-name" title={r.city}>
        {r.city}
      </div>
    );
  },
});

export const locationColumn = ({ width = 160 } = {}) => ({
  key: 'locality', label: 'Location', width, sort: true,
  render: (r, _i, group) => {
    const renderLoc = (x) => {
      const loc = x?.locality || x?.details?.locality || x?.address;
      if (!loc) return dash;
      return (
        <div className="prop-name" title={loc} style={{ fontWeight: 500 }}>
          {loc}
        </div>
      );
    };
    if (!group) {
      const sites = sitesOf(r);
      if (sites.length > 1) {
        return (
          <span className="pc2-stack">
            {sites.map((s) => (
              <span className="pc2-stack-i" key={s.id}>
                {renderLoc(s)}
              </span>
            ))}
          </span>
        );
      }
    }
    return renderLoc(r);
  },
});

/**
 * ONE LOCATION, ONE ROW, ITS PROPERTIES LISTED AND NUMBERED.
 *
 * Bhopal was six rows that looked unrelated and repeated the city six times.
 * The location is what people ask about, so it is the row; the properties are
 * what the row is about, so they are its contents. The numbering is content,
 * not decoration - "property 2" is what gets said on the phone, and it is the
 * line every stacked column to the right is keyed to.
 *
 * A STORE WITH NO SITE YET HAS NO PROPERTY, and says so. Those rows printed
 * "New store - Bareilly" here, which reads as a property called that: a site
 * somebody could open, assess, sign. There is nothing.
 */
export const propertyBoxesColumn = ({ width = 260, onDetails } = {}) => ({
  key: 'title', label: 'Property', width, sort: true,
  render: (r) => {
    /* Checked AFTER the group, not before it: the row standing for a location
       is whichever of its rows came back first, and that is often a "New
       Store" with no site of its own. Testing `demand` first made a location
       with four properties print a dash, because its representative happened
       to be the store still looking. */
    const sites = sitesOf(r);
    if (!sites.length) {
      return <span className="prop-dim" title="Nothing captured here yet">—</span>;
    }
    return (
      <ol className="prop-sitelist">
        {sites.map((s, n) => (
          <li key={s.id} title={[s.title, s.locality, s.city].filter(Boolean).join(' \u00b7 ')}>
            <span className="prop-sitelist-no" aria-hidden="true">{n + 1}</span>
            <span className="prop-sitelist-body">
              <span className="prop-sitelist-name">{s.title}</span>
              {(s.locality || s.city) && (
                <span className="prop-sitelist-sub">
                  {[s.locality, s.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' \u00b7 ')}
                </span>
              )}
            </span>
            {/* `stopPropagation` because the row is clickable too, and that
                would open the wrong property. */}
            <button
              type="button"
              className="prop-sitelist-view"
              title={`Open the full report for ${s.title}`}
              onClick={(e) => { e.stopPropagation(); onDetails?.(s); }}
            >
              View
            </button>
          </li>
        ))}
      </ol>
    );
  },
});

/**
 * Every column of the shared sheet that describes ONE property rather than the
 * location.
 *
 * Listed in one place because the failure is silent: add a per-property column
 * and forget to name it here, and it quietly prints the first site’s value
 * across all five — which names the wrong person and quotes the wrong rent.
 * A step’s own action and extra keys belong in its own list beside this one;
 * every page that groups passes both.
 */

/**
 * WHERE THE MD SENT IT — 'assessment' | 'commercial closure' | 'project
 * creation' — as one column both decision steps render.
 *
 * It is the only outcome either step produces, so both were printing it and
 * they were printing different things: Step 4 read `sentTo`, the road the MD
 * actually chose, while Step 2 read `stage`, where the property happens to
 * stand. Those agree right up until they do not — a site sent to project
 * creation stands at `commercial` like every other shortlisted site, because
 * both roads open the same six documents — so Step 2's column could not tell
 * the two apart on the very rows its own buttons had just decided.
 *
 * TWO ROADS, TWO COLOURS. Blue is work in progress (the paperwork), green is
 * the further commitment (we are opening here) — the same vocabulary as the
 * status dots on these steps. `pc2-status`, not `prop-chip`: s-go/s-done are
 * modifiers of that class in property-capture-blue.css, and these are the blue
 * screens.
 */
const SENT_TO_SAID = {
  assessment: { text: 'Assessment', cls: 's-wait' },
  commercial: { text: 'Commercial closure', cls: 's-go' },
  project: { text: 'Project creation', cls: 's-done' },
};

export const sentToColumn = ({ width = 148 } = {}) => ({
  key: 'sentTo', label: 'Sent to', width, sort: true,
  render: (r) => {
    const said = SENT_TO_SAID[r.sentTo];
    if (!said) {
      return (
        <span className="prop-dim" title="Not sent anywhere yet — shortlist it to choose the road">
          —
        </span>
      );
    }
    return <span className={`pc2-status ${said.cls}`}>{said.text}</span>;
  },
});

export const PER_SITE_KEYS = [
  'source',
  'locality',
  'captureAssigned', 'captureDoneBy', 'capturePlanDate', 'captureDoneAt',
  'area', 'frontage', 'floor', 'gps', 'ctype',
  'rent', 'deposit', 'available', 'lease', 'leaseYrs',
  'owner', 'broker',
  'files', 'remarks',
];

/**
 * The shared column list.
 *
 * A plain function rather than a hook so each page can wrap it in its own
 * `useMemo` with its own dependencies — the alternative was a hook whose deps
 * both pages had to get right identically, which is the same trap in a new
 * shape.
 *
 * @param page,limit      for the row number, which is a position in the whole
 *                        result and not in the page
 * @param onMedia         (row, index) -> open the file viewer
 * @param onDetails       (row) -> open the full property report
 * @param onWhy           (row) -> open "why this status"
 * @param insertAfter     {columnKey: [column, ...]} spliced in behind that key
 */
export const serialNumberColumn = ({ page = 1, limit = 25, width = 64 } = {}) => ({
  key: 'rowNo', label: 'S.No.', width,
  render: (_r, i) => (
    <span style={{ fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>
      {(page - 1) * limit + i + 1}
    </span>
  ),
});

export const sourceColumn = ({ width = 148 } = {}) => ({
  key: 'source', label: 'Source', width, sort: true,
  render: (r) => <SourceBadge source={r.source} />,
});

/* 132px fitted "Shortlisted" and cut "Awaiting review" to "Awaiting revie" —
   mid-word, with no ellipsis to say so, because a chip is an inline-flex box
   and `text-overflow` does not reach the text inside one. The column is sized
   to its longest label instead: the status is a word, and half a word is a
   different word. */
export const statusColumn = ({ width = 168, onWhy } = {}) => ({
  key: 'siteStatus', label: 'Status', width,
  render: (r) => {
    const sites = sitesOf(r);
    const chip = (x) => <StatusChip row={x} onWhy={onWhy} />;
    if (sites.length <= 1) return chip(r);
    return (
      <span className="pc2-stack">
        {sites.map((s) => <span className="pc2-stack-i" key={s.id}>{chip(s)}</span>)}
      </span>
    );
  },
});

export function propertySheetColumns({
  page = 1, limit = 25, onMedia, onDetails, onWhy, insertAfter = {},
}) {
  const base = [
    serialNumberColumn({ page, limit }),
    sourceColumn(),
    cityColumn(),
    locationColumn(),
    propertyBoxesColumn({ onDetails }),
    statusColumn({ onWhy }),

    /* THE FOUR PILLARS — who owns this step, who did it, when it was due and
       when it actually happened. Right behind where and whence, and ahead of
       everything about the property itself: "is anyone on this and is it
       late" is answered before any particular fact about the site. */
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
    {
      key: 'gps', label: 'Live location', width: 134,
      render: (r) => (r.details?.liveLocation
        ? (
          <a
            className="prop-map-link"
            style={{ width: 68, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            href={`https://www.google.com/maps?q=${r.details.liveLocation.lat},${r.details.liveLocation.lng}`}
            target="_blank"
            rel="noreferrer"
            title={`${r.details.liveLocation.lat}, ${r.details.liveLocation.lng}`}
          >
            <MapPin size={12} className="prop-map-icon" />
            <span>Map</span>
            <ExternalLink size={10} className="prop-map-arrow" />
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
    { key: 'broker', label: 'Broker', width: 140, render: (r) => { const b = brokerOf(r); return person(b?.name, b?.phone); } },

    /* EVERYTHING FILED AGAINST THE PROPERTY, behind one button. This is where the
       "N/6 filed" tally used to sit: a count of closure slots that said nothing
       about what was actually attached, and counted against six when closure is
       five. See FilesCell / collectPropertyFiles. */
    filesColumn((row, at) => onMedia?.(row, at)),

    /* LAST, and deliberately. Notes are the one free-text field on the form —
       read once somebody has found the row they want, never scanned down a
       column — and mid-sheet they pushed the facts that ARE scanned off the
       right-hand edge. */
    { key: 'remarks', label: 'Notes', width: 260, render: (r) => <NotesCell row={r} /> },
  ];

  /* Spliced rather than appended: a step's own facts belong beside the ones
     they qualify. Decided by/on read as part of the who-and-when block, not as
     an afterthought forty columns away from it. */
  const out = [];
  for (const c of base) {
    out.push(c);
    const extra = insertAfter[c.key];
    if (extra) out.push(...extra);
  }
  return out;
}

/**
 * The footer, so both steps count the same way in the same words.
 *
 * It says "Showing 1 to 25 of 54 properties" and it means properties, not
 * rows: the table groups several properties into one location row, so a
 * footer counting rows would disagree with both the sheet above it and the
 * figure on the flow rail.
 */
export function PropertySheetFooter({ q }) {
  const total = q.total ?? 0;
  const from = total === 0 ? 0 : (q.page - 1) * q.limit + 1;
  const to = Math.min(q.page * q.limit, total);
  const pages = q.totalPages || 1;
  return (
    <div className="pc2-foot">
      <span>Showing {from} to {to} of {total} properties</span>
      <span className="pc2-pages">
        <button type="button" className="pc2-page" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>&lsaquo;</button>
        {Array.from({ length: pages }, (_, i) => i + 1)
          /* Only a window around the current page: 20 numbered buttons is a
             paragraph, not a control. */
          .filter((n) => Math.abs(n - q.page) <= 2 || n === 1 || n === pages)
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
        <button type="button" className="pc2-page" disabled={q.page >= pages} onClick={() => q.setPage(q.page + 1)}>&rsaquo;</button>
      </span>
      <span className="pc2-rows">
        Rows per page
        <select className="pc2-select" value={q.limit} onChange={(e) => q.setLimit(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </span>
    </div>
  );
}
