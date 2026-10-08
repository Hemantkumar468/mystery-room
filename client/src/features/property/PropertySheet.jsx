import { Fragment } from 'react';
import { SourceBadge, sitesOf, AssignedCell } from './propertyUi.jsx';
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
/* `text()` and `money()` went with the thirteen form-field columns they
   formatted — those facts are on the report behind View now. */

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
export const cityColumn = ({ width = 114 } = {}) => ({
  key: 'city', label: 'City', width, sort: true,
  render: (r) => {
    if (!r.city) return dash;
    /* HOW MANY SITES ARE UNDER THIS CITY, under its name. The sheet groups
       several properties into one city row, so the row and the property
       count are different numbers — and without this the reader has to
       count the boxes in the next column to find out which. */
    const n = sitesOf(r).length;
    return (
      <>
        <div className="prop-name" title={r.city}>{r.city}</div>
        {n > 0 && (
          <div className="prop-sub">{n} {n === 1 ? 'property' : 'properties'}</div>
        )}
      </>
    );
  },
});

export const locationColumn = ({ width = 160 } = {}) => ({
  key: 'locality', field: 'locality', label: 'Location', width, sort: true,
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
export const propertyBoxesColumn = ({ width = 226, onDetails } = {}) => ({
  key: 'title', field: 'property_name', label: 'Property', width, sort: true,
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
              {/* THE NAME IS THE LINK; THE VIEW BUTTON HAS GONE.
                  Every row already ends in View, so a second one inside the
                  Property cell was the same action twice on the same line —
                  and on a city holding two sites it was three View buttons
                  in one row. The name still opens that one property, which
                  is the thing the per-site button was for; it just stops
                  taking up a column's width to say so.
                  `stopPropagation` because the row is clickable too, and
                  that would open the wrong property. */}
              <button
                type="button"
                className="prop-sitelist-name is-link"
                title={`Open the full report for ${s.title}`}
                onClick={(e) => { e.stopPropagation(); onDetails?.(s); }}
              >
                {s.title}
              </button>
              {(s.locality || s.city) && (
                <span className="prop-sitelist-sub">
                  {[s.locality, s.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' \u00b7 ')}
                </span>
              )}
            </span>
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
export const serialNumberColumn = ({ page = 1, limit = 25, width = 56 } = {}) => ({
  /* "No", not "S.No." — four characters plus two full stops in a 56px
     column clipped to "S.No". The column is a counter; one short word says
     so and fits. */
  key: 'rowNo', label: 'No', width,
  render: (_r, i) => (
    <span style={{ fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>
      {(page - 1) * limit + i + 1}
    </span>
  ),
});

export const sourceColumn = ({ width = 124 } = {}) => ({
  key: 'source', label: 'Source', width, sort: true,
  render: (r) => <SourceBadge source={r.source} />,
});

/* 132px fitted "Shortlisted" and cut "Awaiting review" to "Awaiting revie" —
   mid-word, with no ellipsis to say so, because a chip is an inline-flex box
   and `text-overflow` does not reach the text inside one. The column is sized
   to its longest label instead: the status is a word, and half a word is a
   different word. */
export const statusColumn = ({ width = 150, onWhy } = {}) => ({
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

/**
 * HOW PROMISING THE FILER THOUGHT THIS SITE WAS.
 *
 * New on the capture form, and on the sheet because it is the field the MD
 * sorts a long queue by: of thirty properties, which three are worth looking
 * at first. Coloured, because that question is answered by scanning a column
 * rather than by reading it — and in the same three colours the rest of the
 * product uses for priority, so a High here looks like a High anywhere else.
 */
const PRIORITY_TONE = { high: '#dc2626', medium: '#d97706', low: '#0891b2' };

export const priorityColumn = ({ width = 90 } = {}) => ({
  key: 'priority', field: 'property_priority', label: 'Priority', width, sort: true,
  render: (r) => {
    const v = String(r.details?.propertyPriority || '').trim();
    if (!v) return <span className="prop-dim">Not set</span>;
    return (
      <span className="prop-prio" style={{ '--prio': PRIORITY_TONE[v.toLowerCase()] || 'var(--text)' }}>
        {v}
      </span>
    );
  },
});

/**
 * THE SHEET STEPS 1 AND 2 SHARE — SEVEN COLUMNS, NOT TWENTY.
 *
 * It used to be the capture form transcribed field for field: carpet area,
 * frontage, floor, GPS, commercial type, monthly rent, deposit, available
 * from, lease amount, term, owner, broker, files, notes — plus four
 * who-and-when columns. Twenty-two columns of 150px is 3,000px of sheet, so
 * reading one property meant scrolling sideways past nineteen facts to reach
 * the button that would have shown you all of them at once.
 *
 * That was the trade being got wrong. Every one of those fields is on the
 * property's report, and every row has a View that opens it. A column earns
 * its place on this sheet only if it is read DOWN — compared across
 * properties — and on this step that is: where is it, what is it, where did
 * it come from, where has it got to, how good is it, and whose job is it.
 *
 * Six questions, six columns, plus the number and the action. No horizontal
 * scroll on a 14-inch screen.
 *
 * WHAT WENT, AND WHERE IT WENT: Location folded into Property (the name sits
 * above its own address already); the three remaining who-and-when columns
 * (Done by, Plan date, Actual date) and all thirteen form fields are on the
 * report behind View. Nothing was deleted — it moved one click away, which is
 * where the client asked for it.
 */
/* THE WIDTHS ARE A BUDGET, NOT A PREFERENCE. At 1366 — the screen the
   client works on — the sheet has about 1,060px. Eight columns have to fit
   inside that or the horizontal scroll this change exists to remove comes
   straight back, so each one is sized to its longest real content and no
   more. Widen one and something else has to give. */
export function propertySheetColumns({
  page = 1, limit = 25, onMedia, onDetails, onWhy, insertAfter = {},
}) {
  const base = [
    serialNumberColumn({ page, limit }),
    cityColumn(),
    /* Carries the location under the name, so Location is not a column of
       its own repeating half of this one. */
    propertyBoxesColumn({ onDetails }),
    sourceColumn(),
    statusColumn({ onWhy }),
    priorityColumn(),
    /* ONE of the four who-and-when columns. "Whose job is this" is read down
       a queue; when it was planned and when it was done are read about a
       single property, which is what the report is for. */
    {
      /* 136 fitted the avatar and "Vikram Rao" but cut "Manoj Parihar". The
         14px comes from Priority, whose longest value is "Medium". */
      key: 'captureAssigned', label: 'Assigned to', width: 150,
      render: (r) => <AssignedCell plan={r.capturePlan} row={r} />,
    },
  ];

  /* Spliced rather than appended: a step's own facts belong beside the ones
     they qualify. Step 2's "Sent to" reads as part of the property, and its
     decision columns as part of the status they explain. */
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
/**
 * WHAT THE FOUR BADGE COLOURS MEAN, said once under the sheet.
 *
 * The statuses are filled badges now, which makes the column scannable — but
 * only to somebody who already knows that green is shortlisted. A legend is a
 * great deal cheaper than making thirty rows each explain themselves, and it
 * is what the approved design puts here.
 *
 * It names only the four that appear on this sheet. A legend listing every
 * state the ladder can produce would be a second, longer thing to learn.
 */
export function StatusLegend() {
  const items = [
    ['Shortlisted', '#16a34a'],
    ['In review', '#4f46e5'],
    ['Documents pending', '#b45309'],
    ['Rejected', '#dc2626'],
  ];
  return (
    <div className="pc2-legend">
      <span className="pc2-legend-title">Status colours</span>
      {items.map(([label, colour]) => (
        <span className="pc2-legend-i" key={label}>
          <span className="pc2-legend-sw" style={{ '--sw': colour }} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

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
          {[5, 10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </span>
    </div>
  );
}
