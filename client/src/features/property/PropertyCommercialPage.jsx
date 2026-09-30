import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentState, documentOpensAsForm } from './DocumentCell.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty,
  fmtDate, AssignedCell, PlanDateCell, SourceBadge,
} from './propertyUi.jsx';
import { StatusChip } from './PropertyWhyStatusModal.jsx';
import { PropertySheetFooter } from './PropertySheet.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { ClosureFormModal } from './ClosureFormModal.jsx';

/**
 * Step 5 — Commercial Finalization.
 *
 * ONE ROW PER DOCUMENT, NOT PER PROPERTY.
 *
 * The six documents were six bands laid across the sheet, so reading a
 * property's closure meant scrolling right past thirty columns — LOI first,
 * NOCs somewhere off the edge — and comparing two properties' leases meant
 * scrolling back and forth. Six documents on one line is a wide table however
 * carefully it is built.
 *
 * Turned on its side it is the shape the work actually has: a property that
 * reaches closure owes six documents, so it gets six rows, one each, and every
 * column then means the same thing all the way down. "Who owns this" is one
 * column, not six; "when is it due" is one column, not six. Nothing is off the
 * right-hand edge because there is nothing left to put there.
 *
 * THE PROPERTY IS ONE CELL SIX ROWS TALL, NOT A NAME ON THE FIRST OF SIX. Six
 * rows all saying "db mall" is the city column of Step 1 before it was grouped
 * — the eye reads repetition as separate things — but naming it once and
 * leaving the other five blank only moved the problem: the name sat at the top
 * with a column of emptiness beneath it, so the block read as a heading and
 * five orphans. Merged, it is what it is: one property, six documents against
 * it, the name centred against all six.
 *
 * `project_creation` is not one of the six. It is the handover after them, and
 * counting it would mean the bar never reached full until the project had
 * already started.
 */
const EMPTY_HINT = 'Shortlist a property in Step 2, or skip assessment in Step 1.';

const dim = <span className="prop-dim">—</span>;

/** The one extra fact each form carries that is worth a column of its own. */
const DETAIL = {
  loi: (v) => v.loi_number && `LOI ${v.loi_number}`,
  lease: (v) => v.renewal_option && `Renewal: ${v.renewal_option}`,
  /* Ownership is the first question on the legal form and the one people
     actually answer; the advocate's name is often left blank. */
  legal: (v) => v.property_ownership || v.advocate_name || v.title_verification,
  deposit: (v) => (Number(v.security_deposit)
    ? `₹${Number(v.security_deposit).toLocaleString('en-IN')}`
    : v.payment_mode || null),
  nocs: (v) => v.noc_type,
  approvals: (v) => v.approval_level,
};

/**
 * Each state twice: what the FORM button offers, and what the STATUS says.
 *
 * They were one string doing both, which is why the status column read
 * "Open form" — an instruction where a state belongs — on every document
 * nobody had touched.
 */
const STATE = {
  start: {
    form: 'Open form', cls: 'is-start',
    /* PENDING, not "Not started yet". Three states put the reader in the
       business of telling "nobody has begun" from "somebody has begun and
       not finished", and nothing on this sheet is decided differently by the
       answer — both mean the document is not in. Which of the two it is, is
       already on the Form button beside it (Open form vs Continue). */
    status: 'Pending', statusCls: 's-go',
    hint: 'Nothing filed yet — the form opens blank',
  },
  open: {
    form: 'Continue', cls: 'is-open',
    status: 'Pending', statusCls: 's-go',
    hint: 'Started but not filed — the form opens on what is there',
  },
  /* Filed once, sent back from Document Approvals, and with the doer again.
     It is a draft like `open` — the difference is that somebody is waiting on
     a correction, and "Pending" does not say that. */
  back: {
    form: 'Fix and resubmit', cls: 'is-open',
    status: 'Sent back', statusCls: 's-no',
    hint: 'Sent back to be filled in again — the form opens on what was filed, with the reason',
  },
  filed: {
    form: 'View form', cls: 'is-filed',
    status: 'Pending', statusCls: 's-go',
    hint: 'Filed and waiting on approval',
  },
  done: {
    form: 'View form', cls: 'is-done',
    status: 'Completed', statusCls: 's-done',
    hint: 'Filed and approved',
  },
};

/**
 * Whatever was attached to a document's own form.
 *
 * Each of the six keeps its file under its own key rather than in the
 * record's `attachments`, so they are listed by name. `payment_proof` and
 * `legal_opinion` were missing, which meant a deposit receipt and a legal
 * opinion could be uploaded and still read as "None".
 */
/**
 * Filed against due: how late, or how early, in whole days.
 *
 * Returns null where either date is missing — "on time" is a claim, and a
 * document with no due date cannot support it. Same tone vocabulary as
 * `daysLeft` so the two read alike in the same table.
 */
const lateness = (planned, actual) => {
  if (!planned || !actual) return null;
  const a = new Date(actual); const b = new Date(planned);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const DAY = 24 * 60 * 60 * 1000;
  /* Compared by DAY, not by instant: a form filed at 9am on its due date is
     on time, and subtracting timestamps makes it several hours early. */
  const days = Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
    - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / DAY);
  if (days > 0) return { days, tone: 'bad', text: `${days}d late` };
  if (days < 0) return { days, tone: 'good', text: `${-days}d early` };
  return { days: 0, tone: 'good', text: 'On time' };
};

const attachmentsOf = (doc) => {
  const v = doc?.values || {};
  return []
    .concat(
      v.documents || [], v.lease_document || [], v.noc_document || [],
      v.approval_document || [], v.payment_proof || [], v.legal_opinion || [],
    )
    .filter(Boolean);
};

/**
 * ONE TABLE ROW PER (PROPERTY × DOCUMENT).
 *
 * Built here rather than by the table, because "six rows per property" is a
 * fact about closure and not about rendering: a property owes all six whether
 * or not anybody has started them, so the empty ones are rows too — that is
 * the list of what is left to do.
 */
function documentRows(properties) {
  const out = [];
  for (const p of properties) {
    DOCUMENTS.forEach((d, i) => {
      const doc = (p.documents || []).find((x) => x.type === d.key) || null;
      const slot = (p.documentSlots || []).find((x) => x.type === d.key) || null;
      out.push({
        id: `${p.id}:${d.key}`,
        property: p,
        doc,
        slot,
        docKey: d.key,
        docLabel: d.label,
        /* The property is named once per block and the block is bordered from
           the next — see the page header. */
        isFirst: i === 0,
        isLast: i === DOCUMENTS.length - 1,
      });
    });
  }
  return out;
}

export default function PropertyCommercialPage() {
  const q = usePropertyQuery('commercial');
  const [details, setDetails] = useState(null);
  const [filling, setFilling] = useState(null);

  /**
   * THE FORM BUTTON, AND IT NEVER LEAVES THIS PAGE.
   *
   * Both halves used to navigate into the project module — a blank form went
   * to `?form=loi`, a filed one to `/record/:id` — so filing six documents
   * was six round trips out of the sheet and back. Now:
   *
   *   nothing filed  -> the document's own form, over the row (ClosureFormModal)
   *   already filed  -> its report, which is what "View form" means
   *
   * Reading a filed document deliberately does NOT reopen the form. The
   * question from this row is what the document says, and a form answers it
   * in editable inputs with a Submit button under them — which is how a
   * signed lease gets resubmitted by somebody who only meant to read it.
   */
  const openDoc = (row, type, doc) => {
    if (!row.projectId) return;
    if (documentOpensAsForm(doc)) {
      setFilling({ property: row, docKey: type, doc });
      return;
    }
    setDetails({ property: row, docKey: type });
  };

  const columns = useMemo(() => [
    /**
     * WHERE AND WHAT — ONE MERGED BOX ACROSS THE PROPERTY'S SIX ROWS.
     *
     * These were printed on the first of the six and left blank on the other
     * five, which put the name at the TOP of a tall block and left a column of
     * emptiness under it. The block then read as a labelled row followed by
     * five orphans, when what it is is one property with six documents against
     * it — the same shape All Properties already draws, where a location is
     * one cell beside the several properties it holds.
     *
     * A real `rowSpan`, not a visual trick: the cell genuinely is six rows
     * tall, so the browser centres it against them and it cannot drift out of
     * step if a document is ever added or removed. `pcx-span` gives the two of
     * them the box — its own ground and an edge the eye can follow down.
     */
    {
      key: 'rowNo', label: 'S.No.', width: 64, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r, i) => (
        <span style={{ fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>
          {(q.page - 1) * q.limit + Math.floor(i / DOCUMENTS.length) + 1}
        </span>
      ),
    },
    {
      key: 'source', label: 'Source', width: 130, sort: true, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r) => <SourceBadge source={r.property.source} />,
    },
    {
      key: 'city', label: 'City', width: 116, sort: true, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r) => (
        <div className="prop-name" title={r.property.city}>{r.property.city || '—'}</div>
      ),
    },
    {
      key: 'locality', label: 'Location', width: 120, sort: true, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r) => (
        <div className="prop-name" title={r.property.locality || r.property.address}>
          {r.property.locality || r.property.address || '—'}
        </div>
      ),
    },
    {
      key: 'title', label: 'Property', width: 168, sort: true, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r) => (
        <>
          <button
            type="button"
            className="prop-link pcx-prop"
            onClick={(e) => { e.stopPropagation(); setDetails({ property: r.property }); }}
            title="Read the whole report for this property"
          >
            {r.property.title}
          </button>
          <div className="prop-sub">
            {r.property.areaSqft ? `${Number(r.property.areaSqft).toLocaleString('en-IN')} sq ft` : ''}
            {r.property.floor ? ` · ${r.property.floor}` : ''}
          </div>
          <div className="pcx-span-n">{DOCUMENTS.length} documents</div>
        </>
      ),
    },
    {
      key: 'siteStatus', label: 'Status', width: 130, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r) => <StatusChip row={r.property} />,
    },

    /* THE DOCUMENT THIS ROW IS. The whole point of the layout. */
    {
      /* The document this row IS, with the one fact its own form carries
         underneath it — the LOI's number, the advocate, the deposit. It had
         a column of its own ("Details") at the far right, which is the last
         place anybody looks for something that belongs to the name. */
      key: 'doc', label: 'Document', width: 152,
      render: (r) => {
        const read = DETAIL[r.docKey];
        const text = read ? read(r.doc?.values || {}) : null;
        return (
          <>
            <span className="pcx-doc-name">{r.docLabel}</span>
            {text && <div className="prop-sub" title={text}>{text}</div>}
          </>
        );
      },
    },
    {
      /**
       * THE FORM, ON ITS OWN. Pressing a status used to open the form, which
       * is how "Approved" — a statement of fact — behaved as a navigation
       * control and carried the reader off to the project screen. One cell
       * was doing two jobs and the destructive-feeling one was invisible.
       */
      key: 'form', label: 'Form', width: 122,
      render: (r) => {
        const s = STATE[documentState(r.doc)];
        return (
          <button
            type="button"
            className={`pc2-doc ${s.cls}`}
            onClick={(e) => { e.stopPropagation(); openDoc(r.property, r.docKey, r.doc); }}
            title={`${r.docLabel} — ${s.hint}`}
          >
            {s.form}
          </button>
        );
      },
    },
    {
      /**
       * WHERE THE DOCUMENT HAS GOT TO — and nothing else.
       *
       * Three words, no button, nothing to press. Four states collapse to
       * three on purpose: filed-and-waiting and started-but-not-filed are
       * both "somebody still owes us something", and the difference between
       * them is already in Done by and in the form itself.
       */
      key: 'state', label: 'Status', width: 128,
      render: (r) => {
        const s = STATE[documentState(r.doc)];
        return (
          <span className={`pc2-status ${s.statusCls}`} title={s.hint}>
            {s.status}
          </span>
        );
      },
    },

    { key: 'assigned', label: 'Assigned', width: 120, render: (r) => <AssignedCell plan={r.slot?.assignedTo ? { assignedNames: [r.slot.assignedTo] } : null} row={r.property} /> },
    {
      /* Who filed it and when — one fact in two halves, so one column. They
         were two, and the date was only ever read next to the name. */
      key: 'doneBy', label: 'Done by', width: 126,
      render: (r) => {
        const by = r.slot?.filedBy || r.doc?.by;
        const at = r.slot?.filedAt || r.doc?.at;
        if (!by && !at) return <span className="prop-dim">Not yet</span>;
        return (
          <>
            {by ? <span className="prop-person" title={by}>{by}</span> : dim}
            {at && <div className="prop-sub">{fmtDate(at)}</div>}
          </>
        );
      },
    },
    { key: 'planDate', label: 'Plan date', width: 98, render: (r) => <PlanDateCell plan={r.slot?.planDate ? { planDate: r.slot.planDate } : null} row={r.property} /> },

    {
      /**
       * WHEN IT WAS ACTUALLY FILED, against the date it was due.
       *
       * This column held the DOCUMENT'S own dates — an LOI's issue and
       * expiry, a lease's term. Useful, but it is not the question a closure
       * sheet is read to answer, and sitting beside Plan date it looked like
       * the actual against that plan and was not: a lease planned for 20 Oct
       * showed "Starts: 30 Sept", which reads as twenty days early on work
       * that had not been done.
       *
       * So the pair is honest now — planned, actual, and the gap between
       * them. The document's own dates are not lost; they are on its report,
       * under the form that asked for them.
       */
      key: 'actualDate', label: 'Actual date', width: 132,
      render: (r) => {
        const at = r.slot?.filedAt || r.doc?.at;
        if (!at) return <span className="prop-dim">Not yet</span>;
        const late = lateness(r.slot?.planDate, at);
        return (
          <>
            <div className="as-when">{fmtDate(at)}</div>
            {late && <span className={`pc2-expiry t-${late.tone}`}>{late.text}</span>}
          </>
        );
      },
    },

    {
      /**
       * ONE DOCUMENT'S REPORT — what was filed, by whom, when, and what came
       * with it.
       *
       * The column was headed "Uploaded" and held a file count, which is a
       * fact about the attachment rather than about the document: an LOI with
       * every term filled in and no scan attached read as "None", the same as
       * an LOI nobody had opened. And with nothing filed there was nothing to
       * press at all, so the one row that most needs explaining offered the
       * reader nothing.
       *
       * It is an action now, and it is always available. What it opens is
       * this document alone — not the whole closure file — because that is
       * the question being asked from this row: what does OUR LOI say?
       */
      key: 'action', label: 'Action', width: 108,
      render: (r) => {
        const files = attachmentsOf(r.doc);
        const filed = documentState(r.doc) === 'filed' || documentState(r.doc) === 'done';
        return (
          <button
            type="button"
            className="pc2-act a-view"
            onClick={(e) => { e.stopPropagation(); setDetails({ property: r.property, docKey: r.docKey }); }}
            title={filed
              ? `Read the ${r.docLabel} — everything filed against it${files.length ? `, and its ${files.length} file(s)` : ''}`
              : `The ${r.docLabel} has not been filed yet — this says who it is with`}
          >
            <Eye size={12} /> View
          </button>
        );
      },
    },
  ], []);

  /* The properties, then their six documents each. */
  const rows = useMemo(() => documentRows(q.rows || []), [q.rows]);

  return (
    <>
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing here yet'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <div className="pc2-tablewrap">
                <PropTable
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  rowClass={(r) => `pcx-row${r.isFirst ? ' is-first' : ''}${r.isLast ? ' is-last' : ''}`}
                  sort={q.sort}
                  onSort={q.toggleSort}
                  busy={q.isFetching}
                />
              </div>
              <PropertySheetFooter q={q} />
            </>
          )}

      {filling && (
        <ClosureFormModal
          property={filling.property}
          docKey={filling.docKey}
          doc={filling.doc}
          onClose={() => setFilling(null)}
        />
      )}
      {details && (
        <PropertyDetailsModal
          row={details.property}
          showClosure
          focusDocument={details.docKey}
          onClose={() => setDetails(null)}
        />
      )}
    </>
  );
}
