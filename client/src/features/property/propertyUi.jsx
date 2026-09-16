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
const STAGE_LABEL = { demand: 'Sourcing', capture: 'Captured', assessment: 'Assessment', commercial: 'Commercial' };

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
