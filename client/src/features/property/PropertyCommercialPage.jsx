import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Eye, Paperclip } from 'lucide-react';
import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentState, daysLeft } from './DocumentCell.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty,
  fmtDate, AssignedCell, PlanDateCell,
} from './propertyUi.jsx';
import { PropertySheetFooter } from './PropertySheet.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';

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
 * THE PROPERTY IS NAMED ON ITS FIRST ROW AND NOT REPEATED. Six rows all saying
 * "db mall" is the city column of Step 1 before it was grouped — the eye reads
 * repetition as separate things. The block is bordered instead, so where one
 * property's six end and the next begins is visible without being spelled out.
 *
 * `project_creation` is not one of the six. It is the handover after them, and
 * counting it would mean the bar never reached full until the project had
 * already started.
 */
const EMPTY_HINT = 'Shortlist a property in Step 2, or skip assessment in Step 1.';

const dim = <span className="prop-dim">—</span>;

/** Which of a document's own dates matter, and what that form calls them. */
const DATES = {
  loi: { from: 'loi_date', fromLabel: 'Dated', to: 'valid_until', toLabel: 'Valid until' },
  lease: { from: 'lease_start_date', fromLabel: 'Starts', to: 'lease_end_date', toLabel: 'Runs to' },
  legal: { from: 'verification_date', fromLabel: 'Verified' },
  deposit: { from: 'available_from', fromLabel: 'Available from' },
  nocs: { to: 'expiry_date', toLabel: 'Expires' },
  approvals: {},
};

/** The one extra fact each form carries that is worth a column of its own. */
const DETAIL = {
  loi: (v) => v.loi_number && `LOI ${v.loi_number}`,
  lease: (v) => v.renewal_option && `Renewal: ${v.renewal_option}`,
  legal: (v) => v.advocate_name,
  deposit: (v) => (Number(v.deposit) ? `₹${Number(v.deposit).toLocaleString('en-IN')}` : null),
  nocs: (v) => v.noc_type,
  approvals: (v) => v.approval_level,
};

const STATE = {
  start: { label: 'Open form', cls: 'is-start', hint: 'Nothing filed yet — this opens a blank form' },
  open: { label: 'In progress', cls: 'is-open', hint: 'Started but not filed — this opens what is there' },
  filed: { label: 'Filed', cls: 'is-filed', hint: 'Filed and waiting on approval — this opens it' },
  done: { label: 'Approved', cls: 'is-done', hint: 'Approved — this opens it' },
};

/** Whatever was attached to a document's own form. */
const attachmentsOf = (doc) => {
  const v = doc?.values || {};
  return []
    .concat(v.documents || [], v.lease_document || [], v.noc_document || [], v.approval_document || [])
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
  const navigate = useNavigate();
  const q = usePropertyQuery('commercial');
  const [media, setMedia] = useState(null);
  const [details, setDetails] = useState(null);

  const openDoc = (row, type, doc) => {
    if (!row.projectId) return;
    navigate(doc?.id
      ? `/projects/${row.projectId}/commercial-finalization/record/${doc.id}`
      : `/projects/${row.projectId}/commercial-finalization?form=${type}`);
  };

  const columns = useMemo(() => [
    /* WHERE AND WHAT, on the first of a property's six rows only. Six rows all
       repeating the same name is what the eye reads as six properties. */
    {
      key: 'city', label: 'Location', width: 116, sort: true,
      render: (r) => (r.isFirst
        ? (
          <>
            <div className="prop-name" title={r.property.city}>{r.property.city || '—'}</div>
            {r.property.locality && <div className="prop-sub" title={r.property.locality}>{r.property.locality}</div>}
          </>
        )
        : null),
    },
    {
      key: 'title', label: 'Property', width: 168, sort: true,
      render: (r) => (r.isFirst
        ? (
          <>
            <button
              type="button"
              className="prop-link pcx-prop"
              onClick={(e) => { e.stopPropagation(); setDetails(r.property); }}
              title="Read the whole report for this property"
            >
              {r.property.title}
            </button>
            <div className="prop-sub">
              {r.property.areaSqft ? `${Number(r.property.areaSqft).toLocaleString('en-IN')} sq ft` : ''}
              {r.property.floor ? ` · ${r.property.floor}` : ''}
            </div>
          </>
        )
        : null),
    },
    /* Source is gone from this step. It is the same for all six of a
       property's rows, it repeats what Step 1 already says, and it was
       costing 130px on the one sheet that has the most to show — which is
       what pushed "Uploaded", the column this step exists to answer, off
       the right-hand edge. */

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
      /* The cell is the action: empty opens a blank form, filled opens what
         was filed. One control that both reports the state and changes it. */
      key: 'state', label: 'Status', width: 124,
      render: (r) => {
        const s = STATE[documentState(r.doc)];
        return (
          <button
            type="button"
            className={`pc2-doc ${s.cls}`}
            onClick={(e) => { e.stopPropagation(); openDoc(r.property, r.docKey, r.doc); }}
            title={`${r.docLabel} — ${s.hint}`}
          >
            {documentState(r.doc) === 'done' ? <Check size={11} /> : null}
            {s.label}
          </button>
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
       * THE DOCUMENT'S OWN DATES, in one column.
       *
       * Each form has at most two that matter and they are never the same
       * two — a lease starts and runs to, an LOI is dated and expires, a
       * legal check is simply verified. Two fixed columns meant one of them
       * was empty on most rows and the header lied about what it held.
       * Labelled per row instead, which is the only way it reads true.
       */
      key: 'dates', label: 'Dates', width: 140,
      render: (r) => {
        const cfg = DATES[r.docKey] || {};
        const v = r.doc?.values || {};
        const from = cfg.from ? fmtDate(v[cfg.from]) : null;
        const to = cfg.to ? v[cfg.to] : null;
        if (!from && !to) return dim;
        const left = to ? daysLeft(to) : null;
        return (
          <>
            {from && <div className="as-when">{cfg.fromLabel}: {from}</div>}
            {to && (
              <div className="as-when">
                {cfg.toLabel}: {fmtDate(to)}
                {left && <span className={`pc2-expiry t-${left.tone}`}>{left.text}</span>}
              </div>
            )}
          </>
        );
      },
    },

    {
      /**
       * WHAT WAS ACTUALLY UPLOADED against this document, and a way to look at
       * it. Closure is a paperwork step: "Approved" with nothing attached and
       * "Approved" with the signed lease behind it are different states, and
       * the sheet could not tell them apart.
       */
      key: 'attachments', label: 'Uploaded', width: 124,
      render: (r) => {
        const files = attachmentsOf(r.doc);
        if (!files.length) {
          return <span className="prop-dim" title="Nothing has been uploaded against this document">None</span>;
        }
        return (
          <button
            type="button"
            className="pc2-act a-view"
            onClick={(e) => {
              e.stopPropagation();
              setMedia({
                row: {
                  ...r.property,
                  title: `${r.property.title} — ${r.docLabel}`,
                  media: { files: files.map((f) => (typeof f === 'string' ? { url: f, kind: 'document' } : f)) },
                },
                at: 0,
              });
            }}
            title={`${files.length} file(s) uploaded against the ${r.docLabel}`}
          >
            <Paperclip size={12} /> View {files.length}
          </button>
        );
      },
    },
  ], [navigate]);

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

      {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
      {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}
    </>
  );
}
