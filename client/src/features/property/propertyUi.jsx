import { Search, Image as ImageIcon, Video, FileText, Link2, Music, Paperclip } from 'lucide-react';
import { fileNameOf } from './PropertyMediaModal.jsx';

/**
 * The pieces all four property steps share.
 *
 * Extracted because the alternative is four copies of the same toolbar, badge
 * and property cell drifting apart — which is how one step ends up showing a
 * phone number the other three do not.
 */

/** Source and stage tags. The class carries the colour; see property-capture.css. */
export const Badge = ({ kind, children, title }) => (
  /* The label doubles as the tooltip: the badge truncates in a narrow column,
     and a truncated word nobody can read in full is worse than no badge. */
  <span className={`prop-badge ${kind || ''}`} title={title || (typeof children === 'string' ? children : undefined)}>
    {children}
  </span>
);

/* Broker: the label the business uses for a site that came from outside
   it — an agent, a landlord, anyone who is not us and is not applying to
   run the centre. Renamed from 'Random Opportunities', which described
   how the lead arrived rather than who sent it. */
const SOURCE_LABEL = { franchise: 'Franchisee', broker: 'Broker', other: 'Other', demand: 'New Store', captured: 'Company Owned' };
const SOURCE_CLASS = { franchise: 'franchisee', broker: 'broker', other: 'neutral', demand: 'wanted', captured: 'captured' };
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
 * What is attached to a property — as NAMED LINKS, one per file.
 *
 * NOT THUMBNAILS, and not a count either. A grid of previews in a table cell
 * makes the browser fetch every photo of every property on the page to answer
 * a question nobody asked yet, and these are signed S3 objects, so that is
 * real megabytes each time the queue is opened. A count ("3 photos") is cheap
 * but says nothing about WHICH three. Named links cost one line of text, say
 * what is actually there, and fetch the bytes only for the one that is
 * clicked — which opens it in a preview over the sheet, not in a new tab.
 *
 * ALWAYS RENDERED, even when empty: a cell that vanishes makes the reader
 * wonder whether the files failed to load or were never sent. "None" answers
 * that; a blank does not.
 */
const KIND_ICON = { photo: ImageIcon, video: Video, document: FileText, audio: Music, link: Link2 };
const SHOWN = 3;

export function FilesCell({ row, onOpen }) {
  const files = row.media?.files || [];
  if (!files.length) {
    return <span className="prop-files is-empty">None</span>;
  }

  const head = files.slice(0, SHOWN);
  const rest = files.length - head.length;

  return (
    <span className="prop-files-list">
      {head.map((f, i) => {
        const Icon = KIND_ICON[f.kind] || Paperclip;
        return (
          <button
            key={f.url + i}
            type="button"
            className="prop-file-link"
            onClick={() => onOpen(row, i)}
            title={`${fileNameOf(f, i)} — preview it here`}
          >
            <Icon size={11} />
            <span>{fileNameOf(f, i)}</span>
          </button>
        );
      })}
      {rest > 0 && (
        <button type="button" className="prop-file-more" onClick={() => onOpen(row, SHOWN)}>
          +{rest} more
        </button>
      )}
    </span>
  );
}

/** The Files column, identical on every step so a row reads the same anywhere. */
export const filesColumn = (onOpen) => ({
  key: 'files',
  label: 'Files',
  width: 200,
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
 * WHO / WHEN, on every step — the four pillars as four columns.
 *
 * The standard the whole module is built to says each step must name one owner
 * (WHO), a planned turnaround (WHEN), and produce a tangible thing somebody
 * can point at (WHAT). A queue that shows only the WHAT is half a report: it
 * says a property is at commercial closure and not who is closing it, when it
 * was due, or when it actually happened. These four say all of it, in the same
 * order on every step, so a reader learns them once:
 *
 *   Assigned    — the single owner of THIS step (from its own tasks)
 *   Done by     — who actually produced the deliverable
 *   Plan date   — the planned end, coloured on-time / delayed
 *   Actual date — when it was really done, beside the date it was due
 *
 * THEY SIT AT THE FRONT, right after the action, on every step. Who owns it
 * and whether it is on time is the question asked of a queue before any
 * particular fact about a property is — and these were at the far right, past
 * a horizontal scroll, which is the same as not being there.
 *
 * PLANNED AND ACTUAL ARE ADJACENT AND DISTINCT. The pair is the whole point of
 * the standard: one column is a promise and the other is what happened, so
 * they are named "Plan date" and "Actual date" and never merged. While a step
 * is still open the actual column says what it is still waiting on ("due 30
 * Sept"), because "not finished" and "nobody recorded it" are different states
 * and a queue that blurs them cannot be chased.
 */
export const whoWhenColumns = (keyPrefix, { getPlan, getDoneBy, getDoneAt, doneLabels } = {}) => {
  const [byLabel, atLabel] = doneLabels || ['Done by', 'Actual date'];
  return [
    {
      key: `${keyPrefix}Assigned`, label: 'Assigned', width: 140,
      render: (r) => <AssignedCell plan={getPlan?.(r)} />,
    },
    {
      key: `${keyPrefix}DoneBy`, label: byLabel, width: 140,
      render: (r) => {
        const by = getDoneBy?.(r);
        return by
          ? <span className="prop-person" title={by}>{by}</span>
          : <span className="prop-dim">Not yet</span>;
      },
    },
    {
      key: `${keyPrefix}PlanDate`, label: 'Plan date', width: 108,
      render: (r) => <PlanDateCell plan={getPlan?.(r)} />,
    },
    {
      key: `${keyPrefix}DoneAt`, label: atLabel, width: 126,
      render: (r) => {
        const at = getDoneAt?.(r);
        if (at) return <span className="as-when">{fmtDate(at)}</span>;
        const plan = getPlan?.(r);
        /* Not done: what it is waiting on, said as a plan so the two kinds of
           date can never be read as the same thing. */
        return plan?.planDate
          ? <span className="as-due" title="Planned date — not done yet">due {fmtDate(plan.planDate)}</span>
          : <span className="prop-dim">—</span>;
      },
    },
  ];
};

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
 *
 * THE TAB STRIP IS NOT ALWAYS A SOURCE FILTER, which is why `tab`/`onTab` are
 * passed in rather than read off `q.source`. Step 1's Rejected tab is a
 * different question — a stage, not a door the property came in through — and
 * a strip hard-wired to `q.source` could not hold both. Callers that only
 * switch sources can still leave them out.
 */
export function PropertyToolbar({ q, tabs, tab, onTab }) {
  const current = tab !== undefined ? tab : q.source;
  const pick = onTab || q.setSource;
  return (
    <div className={`prop-toolbar${tabs ? '' : ' is-bare'}`}>
      {tabs && (
        <div className="prop-tabs">
          {tabs.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              className={`prop-tab${current === t.key ? ' active' : ''}${t.tone ? ` is-${t.tone}` : ''}`}
              onClick={() => pick(t.key)}
              title={t.hint}
            >
              {t.label}
              {/* A count only where the tab has one to give. Rejected earns it:
                  it is the one tab people open to ask "how many did we turn
                  down", and the answer being on the tab saves the click. */}
              {t.count != null && <span className="prop-tab-count">{t.count}</span>}
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

        {/* NO "Rejected" TICKBOX HERE ANY MORE, on any step.
            It was on all six, and on five of them it was an invitation to mix
            properties we have said no to into a queue of work still to be
            done — which is the one thing a step's count must never be wrong
            about. Rejected properties now live in one place, their own tab on
            Step 1, where they are the subject rather than a contaminant. See
            PropertyCapturePage. */}

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
