import { Fragment } from 'react';
import {
  SourceBadge, filesColumn, fmtDate, whoWhenColumns,
  sitesOf, NotesCell, person,
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
export const locationColumn = ({ width = 204 } = {}) => ({
  key: 'city', label: 'Location', width, sort: true,
  render: (r) => {
    if (!r.city) return dash;
    return (
      <div className="prop-name" title={r.city}>
        {r.city}
      </div>
    );
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
export const PER_SITE_KEYS = [
  'source',
  'captureAssigned', 'captureDoneBy', 'capturePlanDate', 'captureDoneAt',
  'area', 'frontage', 'floor', 'gps', 'ctype',
  'rent', 'deposit', 'available', 'lease', 'leaseYrs',
  'owner', 'broker',
  'files', 'documents', 'remarks',
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
export function propertySheetColumns({
  page = 1, limit = 25, onMedia, onDetails, onWhy, insertAfter = {},
}) {
  const base = [
    /* A plain row number. Not an id and not sortable: it answers "which of
       these am I looking at" while reading down a long table, and an id in
       that position would invite people to quote it. */
    {
      key: 'rowNo', label: '#', width: 46,
      render: (_r, i) => <span className="prop-dim">{(page - 1) * limit + i + 1}</span>,
    },

    /* SOURCE LEADS. The first fact decides how the row is read at all: a
       franchisee's application and a site our own team sourced are different
       objects that happen to share a table. */
    { key: 'source', label: 'Source', width: 148, sort: true, render: (r) => <SourceBadge source={r.source} /> },

    locationColumn(),
    propertyBoxesColumn({ onDetails }),

    /* BESIDE THE PROPERTY, NOT AT THE FAR END OF THE ROW. "Where has this got
       to" is asked while looking at the property, and at the end of fourteen
       columns it was a scroll away from the thing it describes. Stacked per
       site for the same reason the who/when columns are: five properties in
       one location are at five different points, and one word for all five
       would be wrong four times. */
    {
      key: 'siteStatus', label: 'Status', width: 132,
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
    },

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
    filesColumn((row, at) => onMedia?.(row, at)),
    {
      key: 'documents', label: 'Documents', width: 132, sort: true,
      render: (r) => (r.documents?.length
        ? <span className={`prop-tally${r.documentsFiled === 6 ? ' is-done' : ''}`}>{r.documentsFiled}/6 filed</span>
        : dash),
    },

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
