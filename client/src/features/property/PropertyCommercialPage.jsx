import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentState, documentOpensAsForm } from './DocumentCell.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty,
  fmtDate, AssignedCell, PlanDateCell, PersonName,
} from './propertyUi.jsx';
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

/** The one extra fact each form carries that is worth a column of its own. */
const DETAIL = {
  loi: () => null,
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
/* `ClosureStatus` lived here — it drew the Progress column, which is
   gone: five document rows each carrying a Status already say what a
   tally of them would. */

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
      key: 'rowNo', label: 'No', width: 56, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? DOCUMENTS.length : 0),
      render: (r, i) => (
        <span style={{ fontWeight: 700, color: 'var(--c-ink, #0f172a)' }}>
          {(q.page - 1) * q.limit + Math.floor(i / DOCUMENTS.length) + 1}
        </span>
      ),
    },
    /**
     * SOURCE AND LOCALITY ARE NOT ON THIS STEP ANY MORE.
     *
     * Where a site came from — company owner, broker, franchise application —
     * decides nothing about whether its lease is signed, and by Step 5 that
     * question was settled three steps ago. Locality was a second address
     * column beside City saying very nearly the same thing. Together they cost
     * 250px of a sheet whose real subject, the document, was being pushed off
     * the right-hand edge to carry them.
     *
     * Neither is lost: both are on the property's own report, which the View
     * button at the end of every row opens. That is the trade this step makes
     * throughout — identify the property in as few columns as will do it, and
     * put the rest one click away.
     */
    {
      /**
       * CITY AND PROPERTY IN ONE MERGED CELL, and the Progress column gone.
       *
       * They were three columns — City, Property, Progress — against a block
       * of five document rows, and together they took 402px of a sheet that
       * has about 1,060. Asked to cut: the important columns here are the
       * document, who owes it, when it is due, when it landed, and the form.
       *
       * City and Property are not two questions. "Which site is this" is one,
       * and the answer is a name with a place under it — the same shape every
       * other step in this module uses for a property. Folded, they cost 186
       * instead of 284 and read better, because the name and its city stop
       * being separated by a column border.
       *
       * PROGRESS WENT ENTIRELY. It said "Pending · 2/5" against the block —
       * a count of how many of the five documents on screen were in. The five
       * rows underneath it already say that, one Status each, and a reader
       * who wants the tally can see it without a column spelling it out.
       * It was the only column on the sheet restating its own neighbours.
       */
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
          {/* The city under the name, where the Location column used to be a
              column. Area and floor went with Progress — both are on the
              report, and this cell is an identity, not a specification. */}
          <div className="prop-sub" title={r.property.city}>{r.property.city || '\u2014'}</div>
        </>
      ),
    },

    /* THE DOCUMENT THIS ROW IS. The whole point of the layout. */
    {
      /* The document this row IS, with the one fact its own form carries
         underneath it — the LOI's number, the advocate, the deposit. It had
         a column of its own ("Details") at the far right, which is the last
         place anybody looks for something that belongs to the name. */
      key: 'doc', label: 'Document', width: 140, align: 'left',
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
    /**
     * DUE, THEN FILED, THEN WHO OWES IT, THEN WHERE IT STANDS, THEN THE FORM.
     *
     * The order is the order the question is asked in. It used to run Form,
     * Status, Assigned, Done by, Plan date, Actual date — which opens with
     * the control and arrives at the dates last, so reading "is this late?"
     * meant crossing the two buttons that act on it. Dates together, people
     * after them, the state they add up to, and only then the thing to press.
     */
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
      /**
       * AND WHO FILED IT, which used to be a column of its own ("Done by")
       * holding the same date over again. Two columns for one event: the
       * name was never read apart from the date, and the date was printed
       * twice side by side.
       */
      key: 'actualDate', label: 'Actual date', width: 120,
      render: (r) => {
        const at = r.slot?.filedAt || r.doc?.at;
        if (!at) return <span className="prop-dim">Not yet</span>;
        const by = r.slot?.filedBy || r.doc?.by;
        const late = lateness(r.slot?.planDate, at);
        return (
          <>
            <div className="as-when">{fmtDate(at)}</div>
            {by && <div className="prop-sub" title={`Filed by ${by}`}>by <PersonName name={by} /></div>}
            {late && <span className={`pc2-expiry t-${late.tone}`}>{late.text}</span>}
          </>
        );
      },
    },

    { key: 'assigned', label: 'Assigned to', width: 112, render: (r) => <AssignedCell plan={r.slot?.assignedTo ? { assignedNames: [r.slot.assignedTo] } : null} row={r.property} /> },

    {
      /**
       * WHERE THE DOCUMENT HAS GOT TO — and nothing else.
       *
       * Three words, no button, nothing to press. Four states collapse to
       * three on purpose: filed-and-waiting and started-but-not-filed are
       * both "somebody still owes us something", and the difference between
       * them is already in the Actual date beside it and in the form itself.
       */
      key: 'state', label: 'Status', width: 120,
      render: (r) => {
        const s = STATE[documentState(r.doc)];
        return (
          <span className={`pc2-status ${s.statusCls}`} title={s.hint}>
            {s.status}
          </span>
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
      key: 'form', label: 'Form', width: 110,
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
      key: 'action', pin: 'right', label: 'Action', width: 108,
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
