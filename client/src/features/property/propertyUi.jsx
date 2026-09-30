import { useLayoutEffect, useRef, useState } from 'react';
import { Search, Image as ImageIcon, Video, FileText, Link2, Music, Paperclip } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { fileNameOf } from './PropertyMediaModal.jsx';
import { PropertyFilters } from './PropertyFilters.jsx';

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
/* `demand` and `captured` are one badge, because they are one thing: a store
   we are opening ourselves. They differ only in whether the site has been
   found yet, and the row says that for itself — a demand row has no property
   on it. Two labels here put our own stores under two different words in the
   column that is meant to answer "where did this come from". Same colour too:
   identical text in two colours reads as a bug. */
const SOURCE_LABEL = { franchise: 'Franchisee', broker: 'Broker', other: 'Other', demand: 'Company Owned', captured: 'Company Owned' };
const SOURCE_CLASS = { franchise: 'franchisee', broker: 'broker', other: 'neutral', demand: 'captured', captured: 'captured' };
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

/** "3:25 pm" - the other half of when something actually happened. */
export const fmtTime = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.valueOf())) return null;
  /* Midnight almost always means a date with no time on it rather than
     something filed at 00:00, and printing "12:00 am" against it invents a
     precision the record does not have. */
  if (!parsed.getHours() && !parsed.getMinutes()) return null;
  return parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
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
export function AssignedCell({ plan, row }) {
  const names = plan?.assignedNames || [];
  if (names.length) {
    return (
      <span title={names.join(', ')}>
        {names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]}
      </span>
    );
  }

  /**
   * NOBODY IS ON IT, AND WHY - the two cases are different problems.
   *
   * This said "Unassigned" whatever the reason, which reads as an oversight
   * somebody should go and fix. Half the time it is not: a site sent in
   * through the public form has no project and no task because we have not
   * taken it on yet, and there is nothing to assign. The other half IS the
   * oversight - the property is on a project and that project has no task
   * raised for this step, so the work has no owner and no due date and will
   * sit there.
   *
   * Saying which sends the reader to the right fix instead of to the task
   * board to look for something that was never created.
   */
  if (row && !row.projectId) {
    return (
      <span className="prop-dim" title="This site came in through the public form and has not been taken on yet, so there is no task to assign">
        Not taken on yet
      </span>
    );
  }
  return (
    <span className="prop-warn" title="This property is on a project, but no task has been raised for this step - so it has no owner and no due date">
      No task raised
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

export function PlanDateCell({ plan, row }) {
  /* Same two cases as AssignedCell, same reason: a dash says "no date" and
     leaves the reader to work out whether that is a gap or a not-yet. */
  if (!plan?.planDate) {
    if (row && !row.projectId) return <span className="prop-dim">—</span>;
    return (
      <span className="prop-warn" title="No task has been raised for this step, so nothing is due">
        No due date
      </span>
    );
  }
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
      render: (r) => <AssignedCell plan={getPlan?.(r)} row={r} />,
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
      render: (r) => <PlanDateCell plan={getPlan?.(r)} row={r} />,
    },
    {
      key: `${keyPrefix}DoneAt`, label: atLabel, width: 126,
      render: (r) => {
        const at = getDoneAt?.(r);
        /* WHEN IT REALLY HAPPENED, to the minute where the record has one.
           The client asked for the time as well as the date: "actual" is the
           column somebody reads to find out when a property was walked, and a
           date on its own does not answer that. */
        if (at) {
          const time = fmtTime(at);
          return (
            <span className="as-when" title={new Date(at).toLocaleString('en-IN')}>
              {fmtDate(at)}
              {time && <span className="as-when-time">{time}</span>}
            </span>
          );
        }
        /* NOT "due 04 Nov". This column used to fall back to the plan date, so
           a property nobody had touched showed a date under ACTUAL - and a
           column headed "actual date" showing a date reads as "it was done
           then", however it is styled. Two dates on the row, one of them
           invented, and no way to tell which step actually ran. The plan date
           has its own column immediately to the left; this one says nothing
           until something has happened. */
        return <span className="prop-dim">Not yet</span>;
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
              placeholder="Search property, city or person…"
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

        {/* SORT, SOURCE AND STATUS - the same three controls Step 1 carries,
            from the same component. Five steps had Search and City and nothing
            else: no way to put the oldest first, to see only the brokers'
            sites, or to pull up everything still awaiting a decision. */}
        <PropertyFilters q={q} showSource={!tabs} />

        {/* NO "Rejected" TICKBOX HERE ANY MORE, on any step.
            It was on all six, and on five of them it was an invitation to mix
            properties we have said no to into a queue of work still to be
            done — which is the one thing a step's count must never be wrong
            about. Rejected properties now live in one place, their own tab on
            Step 1, where they are the subject rather than a contaminant. See
            PropertyCapturePage. */}

        {/* The count of what matched, beside the controls that narrowed it.
            Clearing is PropertyFilters' own button now - two Clears, one of
            which only appeared sometimes, was one too many. */}
        {q.active > 0 && (
          <div className="prop-field">
            <span className="prop-field-label">&nbsp;</span>
            <span className="prop-found">{q.total.toLocaleString('en-IN')} found</span>
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

/* ══ THE CELLS THE FULL SHEET IS MADE OF ════════════════════════════════════
   Steps 1 and 2 print the same capture form, so they print it with the same
   cells. Two copies of "Owner" would be two ways of saying nothing when the
   phone is missing. */

/** A name over a dialable phone. Either half may be absent; both may be. */
export const person = (name, phone) => {
  if (!name && !phone) return <span className="prop-dim">-</span>;
  return (
    <>
      <div className="prop-person" title={name}>{name || '-'}</div>
      {phone && <a className="prop-phone" href={`tel:${phone}`}>{phone}</a>}
    </>
  );
};

/**
 * Notes, in a cell that cannot be stretched by them.
 *
 * Somebody pastes four paragraphs from a broker's WhatsApp into this field and
 * the row grows to the height of the paragraph, which pushes every other row
 * off the screen - one long note breaks the whole sheet. So the cell shows the
 * first two lines and offers the rest: the row keeps its height no matter what
 * was typed, and nothing is hidden, only folded.
 */
export function NotesCell({ row }) {
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

/**
 * EITHER/OR COLUMNS, HIDDEN WHEN NOTHING ON THE PAGE ANSWERS THEM.
 *
 * A lease column on a page of rented shops is twenty empty cells the reader
 * still has to scroll past. These fields are alternatives - rent OR lease,
 * frontage on a high street and not in a mall - so an empty one is a fact
 * about the question, not about the rows.
 *
 * Only either/or fields are treated this way. A column that is ALWAYS
 * meaningful (the property, the city, the status) stays even when a page of
 * rows happens to be missing it.
 */
/**
 * THE BROKER, WHERE THERE IS ONE.
 *
 * A franchise application has no agent behind it, but one used to be
 * invented: the applicant's own name was filed into `broker_name` as
 * "Name (franchisee)", so the BROKER column listed people who are not
 * brokers on properties that came through no broker at all. The server no
 * longer writes it (see franchise.service.js), and this keeps the records
 * already carrying it out of the column too — the value is wrong wherever
 * it came from, and showing it is what made the column unreadable.
 *
 * The person is still on the row: they are the submitter, they are named in
 * the remarks, and their number is the contact phone.
 */
export const brokerOf = (r) => {
  if (r?.source === 'franchise') return null;
  const name = r?.details?.brokerName || '';
  /* Belt and braces for rows filed before the server stopped adding it. */
  if (/\(franchisee\)\s*$/i.test(name)) return null;
  return { name, phone: r?.details?.brokerPhone || '' };
};

/**
 * WHAT A DOER IS ALLOWED TO SEE ABOUT A PROPERTY'S PROGRESS.
 *
 * The queue's status is a PIPELINE POSITION — Awaiting review, In Review,
 * In Commercial, Draft, Assigned — and those are the MD's business. A
 * consultant who filed a site was being shown "Assessment" on it, which
 * tells them the MD has routed it and roughly what is being weighed, before
 * any answer has been given. That is the MD's desk leaking onto theirs.
 *
 * The one thing a doer genuinely needs back is the VERDICT: was it taken
 * forward, or turned down. So for anybody who cannot decide, the ladder
 * collapses to those two and everything in between shows nothing at all —
 * not "In Review", not "Pending", which would only invite the same guessing
 * in different words.
 *
 * Returns null when there is no verdict yet; the caller draws nothing.
 */
export const decisionOnly = (r) => {
  const k = r?.statusKey || '';
  const d = r?.decision?.state || '';

  if (k === 'rejected' || d === 'rejected' || r?.stage === 'rejected') {
    return { cls: 's-no', label: 'Rejected' };
  }
  /* Approved, and in commercial closure, both mean one thing to the person
     who filed it: yes, it is going forward. */
  if (['approved', 'shortlisted', 'commercial'].includes(k)
    || ['approved', 'shortlisted'].includes(d)) {
    return { cls: 's-done', label: 'Shortlisted' };
  }
  /**
   * SOMEBODY IS LOOKING AT IT.
   *
   * `awaiting_review` is filed and waiting on the MD; `in_review` is out
   * with the assessors. Two different desks, and the filer's question is
   * the same either way — has anyone got to it? — so both answer "In
   * Review". This is the state that used to print the raw stage word
   * "assessment", which is the part that was never theirs to see.
   */
  if (['awaiting_review', 'in_review', 'captured'].includes(k)) {
    return { cls: 's-go', label: 'In Review' };
  }
  /* Draft, assigned, not started: nothing has been filed, so there is
     nothing under review and saying so would be a lie in three words. */
  return null;
};

export const OPTIONAL_COLUMNS = {
  frontage: (r) => r.details?.frontageFt,
  ctype: (r) => r.details?.commercialType,
  rent: (r) => r.details?.monthlyRent,
  deposit: (r) => r.details?.deposit,
  available: (r) => r.details?.availableFrom,
  lease: (r) => r.details?.leaseAmount,
  leaseYrs: (r) => r.details?.leaseDuration,
  gps: (r) => r.details?.liveLocation,
  owner: (r) => r.details?.ownerName || r.details?.ownerPhone,
  broker: (r) => { const b = brokerOf(r); return b && (b.name || b.phone); },
  remarks: (r) => r.remarks,
};

export const dropEmptyColumns = (columns, rows) => columns.filter((c) => {
  const read = OPTIONAL_COLUMNS[c.key];
  if (!read) return true;
  return (rows || []).some((r) => {
    const v = read(r);
    return v !== null && v !== undefined && v !== '';
  });
});

/* == ONE ROW PER LOCATION ==================================================
   Shared by Step 1 and Step 2, which ask the same question of the same feed:
   "what have we got in Bhopal?" Six rows all saying Bhopal answer it worse
   than one row with six properties listed inside it. Kept here rather than
   copied into each page so the two steps cannot drift into grouping the same
   data two different ways. */

/**
 * Folds consecutive rows that share a city into one, keeping every original
 * row on `siblings`. Rows with no city are left alone - a blank key would
 * collapse unrelated properties into a single meaningless group.
 *
 * A city with one row keeps no `siblings`, so a caller can tell a real group
 * from a group of one.
 */
export function groupByCity(rows) {
  const out = [];
  const seen = new Map();
  for (const r of rows || []) {
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
  return out.map(({ siblings, ...rest }) => (
    siblings && siblings.length > 1 ? { ...rest, siblings } : rest
  ));
}

/**
 * The properties a row stands for.
 *
 * `|| [r]` and not `|| []`: an ungrouped row IS its own property, and reading
 * it as "no sites" printed a dash where a captured property should have been
 * - the one case a city holds exactly one row.
 *
 * A `demand` row is a store still looking for a site. It is an ask, not a
 * property, so it is never listed or numbered.
 */
export const sitesOf = (r) => (r.siblings || [r]).filter((s) => s.stage !== 'demand' && s.title);

/**
 * A GROUPED ROW HAS NO SINGLE ANSWER TO A PER-PROPERTY COLUMN.
 *
 * Assigned, Done by, the rent, the decision - each belongs to one property,
 * and a location row stands for several. Left alone, every one of these
 * columns printed the FIRST property's value across the whole group, which is
 * not a rounding error: it names the wrong person and quotes the wrong rent.
 *
 * So each listed column renders one value per property instead, stacked in
 * the same fixed item height the numbered boxes in the Property column use.
 * That alignment is the whole point - line 3 here is line 3 there - and it is
 * why those boxes may not grow to fit their text.
 */
export const stackPerSite = (columns, keys) => {
  const want = new Set(keys);
  return columns.map((c) => (want.has(c.key)
    ? {
      ...c,
      /* THE GROUP RIDES ALONG as a third argument. A stacked cell is handed
         its own property and otherwise has no way back to the location row it
         is inside - which is fine for printing a rent, and not fine for a
         control that wants to open the whole location. Passed rather than
         looked up, because the cell cannot look it up. */
      render: (r, i) => {
        const sites = sitesOf(r);
        if (sites.length <= 1) return c.render(r, i, r);
        return (
          <span className="pc2-stack">
            {sites.map((s) => <span className="pc2-stack-i" key={s.id}>{c.render(s, i, r)}</span>)}
          </span>
        );
      },
    }
    : c));
};
