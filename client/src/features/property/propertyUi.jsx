import { Search, Image as ImageIcon, Video, FileText, Link2, Paperclip } from 'lucide-react';

/**
 * The pieces all four property steps share.
 *
 * Extracted because the alternative is four copies of the same toolbar, badge
 * and property cell drifting apart — which is how one step ends up showing a
 * phone number the other three do not.
 */

/** Source and stage tags. The class carries the colour; see property-capture.css. */
export const Badge = ({ kind, children }) => (
  <span className={`prop-badge ${kind || ''}`}>{children}</span>
);

const SOURCE_LABEL = { franchise: 'Franchisee', broker: 'Broker', demand: 'Wanted', captured: 'Captured' };
const SOURCE_CLASS = { franchise: 'franchisee', broker: 'broker', demand: 'wanted', captured: 'captured' };
const STAGE_LABEL = {
  demand: 'Sourcing', capture: 'Captured', assessment: 'Assessment',
  commercial: 'Commercial', rejected: 'Rejected',
};

export const SourceBadge = ({ source }) => (
  <Badge kind={SOURCE_CLASS[source] || ''}>{SOURCE_LABEL[source] || source}</Badge>
);

export const StageBadge = ({ stage }) => (
  <Badge kind={stage === 'demand' ? 'sourcing' : stage}>{STAGE_LABEL[stage] || stage}</Badge>
);

/** The property: what it is called, then where it is, as subtext. */
export function PropertyCell({ row }) {
  const sub = [row.locality, row.address].filter(Boolean).join(' · ');
  const s = row.submission;
  return (
    <>
      <div className="prop-name" title={row.title}>{row.title}</div>
      {/* One applicant can send six sites in one form. Without this, those are
          six unrelated-looking rows that happen to share a phone number — and
          the reader cannot tell which submission they are deciding about. */}
      {s?.total > 1 && (
        <span className="prop-sub-chip" title={`Property ${s.index} of ${s.total} sent by ${s.by} in one submission`}>
          Site {s.index} of {s.total} · {s.by}
        </span>
      )}
      {sub && <div className="prop-sub" title={sub}>{sub}</div>}
    </>
  );
}

/** Who sent it, and the number to ring them on. */
export function ContactCell({ row }) {
  if (!row.submittedByName && !row.submittedByPhone) return <span className="prop-dim">—</span>;
  return (
    <>
      <div className="prop-person" title={row.submittedByName}>{row.submittedByName || '—'}</div>
      {row.submittedByPhone && (
        <a className="prop-phone" href={`tel:${row.submittedByPhone}`}>{row.submittedByPhone}</a>
      )}
    </>
  );
}

/**
 * What is attached to a property, as a clickable summary.
 *
 * ALWAYS RENDERED, even when empty. A column that disappears when there is
 * nothing in it makes the reader wonder whether the files failed to load or
 * were never sent — "None" answers the question, a blank does not. The cell is
 * a button either way so the row's shape never shifts.
 */
export function FilesCell({ row, onOpen }) {
  const c = row.media?.counts || {};
  const parts = [
    [ImageIcon, c.photo, 'photo'],
    [Video, c.video, 'video'],
    [FileText, c.document, 'document'],
    [Link2, c.link, 'Drive link'],
  ].filter(([, n]) => n > 0);

  if (!c.total) {
    return <button type="button" className="prop-files is-empty" disabled>None</button>;
  }

  return (
    <button
      type="button"
      className="prop-files"
      onClick={() => onOpen(row)}
      title={parts.map(([, n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`).join(' · ')}
    >
      <Paperclip size={11} />
      {parts.map(([Icon, n], i) => (
        <span key={i} className="prop-files-bit"><Icon size={11} />{n}</span>
      ))}
    </button>
  );
}

/** The Files column, identical on every step so a row reads the same anywhere. */
export const filesColumn = (onOpen) => ({
  key: 'files',
  label: 'Files',
  width: 132,
  render: (r) => <FilesCell row={r} onOpen={onOpen} />,
});

/** "12 Sep '26" — short enough for a column, unambiguous across a year end. */
export const fmtDate = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.valueOf())
    ? String(d)
    : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};

/**
 * Who is assigned, and whether the plan date is being kept.
 *
 * Both cells read a `plan` object shaped `{ assignedNames, planDate, status }`
 * — built once, in propertyCapture.service.js#planFrom, off the real Task
 * documents for that step. Nothing here computes a date or a colour itself:
 * this file only decides how to DISPLAY what the server already decided, so
 * the colour on this row can never disagree with the same task open in My
 * Tasks or on the MIS delay report.
 */
export function AssignedCell({ plan }) {
  const names = plan?.assignedNames || [];
  if (!names.length) return <span className="prop-dim">Unassigned</span>;
  return (
    <span title={names.join(', ')}>
      {names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]}
    </span>
  );
}

/* done_ontime / ontime both read green — "finished on schedule" and "still
   within schedule" are the same colour of news. done_late / delayed both read
   red — the plan date was or is being missed, whether or not the work behind
   it is finished yet. */
const PLAN_STATUS_CLASS = {
  ontime: 'is-ontime', done_ontime: 'is-ontime',
  delayed: 'is-delayed', done_late: 'is-delayed',
};
const PLAN_STATUS_TITLE = {
  ontime: 'Still within the planned date',
  done_ontime: 'Finished on or before the planned date',
  delayed: 'Past the planned date and not yet finished',
  done_late: 'Finished after the planned date',
};

export function PlanDateCell({ plan }) {
  if (!plan?.planDate) return <span className="prop-dim">—</span>;
  const cls = PLAN_STATUS_CLASS[plan.status] || '';
  return (
    <span className={`plan-date-pill${cls ? ` ${cls}` : ''}`} title={PLAN_STATUS_TITLE[plan.status] || undefined}>
      {fmtDate(plan.planDate)}
    </span>
  );
}

/**
 * The two columns together — "Assigned" then "Plan Date" — for whichever
 * step's plan a page passes in. `keyPrefix` keeps the column keys distinct
 * across pages (PropTable keys columns by `key`, and three pages import this
 * on the same table shape), `getPlan` picks the row field: `assessmentPlan`,
 * `commercialPlan` or `planningPlan`.
 */
export const planColumns = (keyPrefix, getPlan) => [
  {
    key: `${keyPrefix}Assigned`, label: 'Assigned', width: 140,
    render: (r) => <AssignedCell plan={getPlan(r)} />,
  },
  {
    key: `${keyPrefix}PlanDate`, label: 'Plan Date', width: 108,
    render: (r) => <PlanDateCell plan={getPlan(r)} />,
  },
];

/** The serif headline and its one-line explanation, above the toolbar. */
export const PageHead = ({ title, subtitle }) => (
  <div className="prop-head">
    <h1>{title}</h1>
    {subtitle && <p>{subtitle}</p>}
  </div>
);

/**
 * Tabs on the left, labelled filters on the right, one row.
 *
 * Reads straight off the query hook (`usePropertyQuery`), because the filters
 * are now server parameters rather than a client-side predicate — the city
 * list comes back with the page, and typing in the search box changes what the
 * server is asked for rather than what the browser hides.
 *
 * Every field carries its label. An unlabelled box floating in a toolbar makes
 * the reader click it to find out what it narrows.
 */
export function PropertyToolbar({ q, tabs }) {
  return (
    <div className={`prop-toolbar${tabs ? '' : ' is-bare'}`}>
      {tabs && (
        <div className="prop-tabs">
          {tabs.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              className={`prop-tab${q.source === t.key ? ' active' : ''}`}
              onClick={() => q.setSource(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="prop-filters">
        <label className="prop-field">
          <span className="prop-field-label">SEARCH</span>
          <span className="prop-search">
            <Search size={14} style={{ flexShrink: 0, opacity: .6 }} />
            <input
              value={q.search}
              onChange={(e) => q.setSearch(e.target.value)}
              placeholder="Property, city or person…"
            />
            {/* The one honest signal that a debounced search is still
                resolving — without it, typing feels like nothing happened. */}
            {q.isFetching && <span className="prop-spin" aria-hidden="true" />}
          </span>
        </label>

        <label className="prop-field">
          <span className="prop-field-label">CITY</span>
          <select className="prop-city" value={q.city} onChange={(e) => q.setCity(e.target.value)}>
            <option value="">All cities</option>
            {q.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        {/* Only offered when there is something to show. A permanently
            visible toggle for a filter that would change nothing is a control
            that teaches people to ignore controls. */}
        {q.counts?.rejected > 0 && (
          <div className="prop-field">
            <span className="prop-field-label">&nbsp;</span>
            <label className={`prop-rejected-toggle${q.includeRejected ? ' active' : ''}`}>
              <input
                type="checkbox"
                checked={q.includeRejected}
                onChange={(e) => q.setIncludeRejected(e.target.checked)}
              />
              Rejected · {q.counts.rejected}
            </label>
          </div>
        )}

        {q.active > 0 && (
          <div className="prop-field">
            <span className="prop-field-label">&nbsp;</span>
            <button type="button" className="prop-clear" onClick={q.clear}>
              Clear · {q.total.toLocaleString('en-IN')} found
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One place to say "nothing here", so all four steps say it the same way. */
export const PropEmpty = ({ title, hint }) => (
  <div className="prop-table-wrap">
    <div className="prop-empty"><b>{title}</b>{hint}</div>
  </div>
);
