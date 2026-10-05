import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Eye, AlertTriangle, RotateCcw } from 'lucide-react';
import { DOCUMENTS, useSendDocumentsBack } from '../../app/api/propertyCaptureApi.js';
import { useBulkRecordDecision } from '../../app/api/recordsApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentState, documentOpensAsForm, DOC_STATE } from './DocumentCell.jsx';
import { documentRows } from './documentRows.jsx';
import { propertiesOf } from './assessmentRows.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty, fmtDate,
} from './propertyUi.jsx';
import { PropertySheetFooter } from './PropertySheet.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

/**
 * Step 6 — Document Approvals.
 *
 * WHY THIS STEP EXISTS. Submitting a document and having it accepted are two
 * different acts by two different people, and the flow only modelled the
 * first. A doer filled the LOI, pressed submit, and it sat there reading
 * "Filed" — which on the closure sheet looked finished. Nobody had a list of
 * what was waiting on them, and no row could say whether anything was blocked.
 * Closure would report six of six filed with all six still unapproved.
 *
 * So the approver gets an in-tray: every property with a document a doer has
 * submitted and nobody has ruled on. Approve it, or send it back with a
 * reason. Once every document on a property has been answered the property
 * leaves this step on its own — there is nothing to mark complete.
 *
 * IT IS THE SAME SHEET AS STEP 5, deliberately: the same six bands, the same
 * dates, the same expiry clocks. The person approving a lease needs what the
 * person chasing it needed, and one of the two screens being a cut-down
 * version of the other is how they come to disagree.
 *
 * WHAT IT IS NOT. It is not a gate in front of project creation. A property
 * can be planned while its NOC is still being argued about — the client was
 * explicit that a slow document must not hold up games and dates. This step
 * reports and decides; it blocks nothing.
 */
const EMPTY_HINT = 'A property appears here the moment a doer submits one of its six documents.';

/** The documents on one property that are waiting on an answer. */
const pending = (row) => (row.documents || [])
  .filter((d) => documentState(d) === 'filed');

export default function PropertyDocApprovalPage() {
  const navigate = useNavigate();
  const q = usePropertyQuery('docreview');
  const [media, setMedia] = useState(null);
  const [details, setDetails] = useState(null);
  /* `{ row }` — whose documents are being sent back. */
  const [ruling, setRuling] = useState(null);
  /* `{ row, docs }` — a Shortlist over MORE THAN ONE document, held for a
     confirm. See `shortlist`. */
  const [confirming, setConfirming] = useState(null);
  const [banner, setBanner] = useState(null);
  const approve = useBulkRecordDecision();

  /**
   * SHORTLIST — approve the paperwork that is waiting.
   *
   * One document goes through on the press, because that is the whole of what
   * was asked and a confirm on it is a second click to say yes twice. Several
   * do not: "Shortlist" over a row with an LOI, a lease and three NOCs behind
   * it would approve five documents the approver never named, and approving a
   * lease you have not read is exactly what this step exists to stop. Those
   * get a list and one button.
   */
  const shortlist = useCallback(async (row, docs) => {
    if (docs.length > 1) { setConfirming({ row, docs }); return; }
    setBanner(null);
    try {
      await approve.mutateAsync({ ids: docs.map((d) => d.id), decision: 'approve' });
      setBanner({ tone: 'ok', text: `${labelOf(docs[0].type)} approved on ${row.title}.` });
    } catch (err) {
      setBanner({ tone: 'bad', text: err?.response?.data?.message || 'Could not approve that document.' });
    }
  }, [approve]);

  /**
   * OPEN THE DOCUMENT, not the property.
   *
   * View on this step used to open the property's capture report — the
   * wrong report for this screen. The question here is what the LOI says:
   * its number, the day it runs from, the day it expires, what is attached.
   * That is the document's own report page, which is also where Approve and
   * Reject live, so the decision can be taken after reading rather than
   * from a row.
   */
  const openDocReport = (r) => {
    const projectId = r.property?.projectId;
    if (!projectId || !r.doc?.id) return;
    navigate(`/projects/${projectId}/commercial-finalization/record/${r.doc.id}`);
  };

  const openDoc = (row, type, doc) => {
    if (!row.projectId) return;
    navigate(documentOpensAsForm(doc)
      ? `/projects/${row.projectId}/commercial-finalization?form=${type}`
      : `/projects/${row.projectId}/commercial-finalization/record/${doc.id}`);
  };

  const columns = useMemo(() => [
    /**
     * ONE ROW PER DOCUMENT, exactly as Step 5 reads.
     *
     * This was one row per property with the six documents banded across it,
     * so the approver's own question — "which document is waiting on me?" —
     * was answered by scrolling a 2,000px sheet sideways through six groups
     * of five columns. The six are a list, and a list belongs down the page.
     *
     * The property is named once at the top of its block; everything to the
     * right of the name belongs to the one document on that line.
     */
    {
      key: 'city', label: 'Location', width: 140, sort: true, className: 'pcx-span',
      /* ONE MERGED CELL, as a spreadsheet would draw it — see pcx-span in
         property-capture-blue.css, which centres it down the block. It was
         a value on the top line with four empty cells beneath, which reads
         as four rows whose location nobody filled in. */
      rowSpan: (r) => (r.isFirst ? (r.span || 1) : 0),
      render: (r) => (
        <>
          <div className="prop-name" title={r.property.city}>{r.property.city || '—'}</div>
          {r.property.locality && <div className="prop-sub" title={r.property.locality}>{r.property.locality}</div>}
        </>
      ),
    },
    {
      key: 'title', label: 'Property', width: 150, sort: true, className: 'pcx-span',
      rowSpan: (r) => (r.isFirst ? (r.span || 1) : 0),
      render: (r) => (
        <>
          <button
            type="button"
            className="prop-link pcx-prop"
            onClick={(e) => { e.stopPropagation(); setDetails(r.property); }}
            title="Read the whole capture report for this property"
          >
            {r.property.title}
          </button>
          <div className="prop-sub">{r.property.source || ''}</div>
        </>
      ),
    },

    /* THE DOCUMENT THIS ROW IS — the whole point of the layout. */
    {
      key: 'doc', label: 'Document type', width: 126,
      render: (r) => <span className="pcx-doc-name">{r.docLabel}</span>,
    },

    /* WHO OWES IT AND BY WHEN, read from this document's own slot — so the
       name beside a row is always the name for the document on that row. */
    {
      key: 'assigned', label: 'Assigned to', width: 120,
      render: (r) => (r.slot?.assignedTo
        ? <span className="prop-person" title={r.slot.assignedTo}>{r.slot.assignedTo}</span>
        : <span className="prop-dim">Unassigned</span>),
    },
    {
      key: 'plan', label: 'Plan date', width: 106,
      render: (r) => (r.slot?.planDate ? <span className="as-when">{fmtDate(r.slot.planDate)}</span> : <span className="prop-dim">—</span>),
    },
    {
      key: 'actual', label: 'Actual date', width: 106,
      render: (r) => (r.slot?.filedAt ? <span className="as-when">{fmtDate(r.slot.filedAt)}</span> : <span className="prop-dim">Not yet</span>),
    },

    /* WHERE IT STANDS. One word, from the same reader the rest of the module
       uses, so this screen can never disagree with Step 5 about a document. */
    {
      key: 'status', label: 'Current status', width: 134,
      render: (r) => {
        const st = documentState(r.doc);
        const meta = DOC_STATE[st] || DOC_STATE.start;
        const label = st === 'start' ? 'Not started' : meta.label;
        return <span className={`pc2-status doc-${st}`} title={meta.hint}>{label}</span>;
      },
    },

    /**
     * THE VERDICT, LAST AND PINNED, AND ON THE DOCUMENT.
     *
     * It used to be one Shortlist per PROPERTY that approved every waiting
     * document at once — so an approver who was happy with the LOI and not
     * the NOC had no way to say so without sending the whole property back.
     * The decision belongs to the thing being decided.
     *
     * View opens the DOCUMENT, not the property: on this step the question
     * is what the lease says, and the property report was answering a
     * different one.
     */
    {
      key: 'action', pin: 'right', label: 'Action', width: 218,
      render: (r) => {
        const st = documentState(r.doc);
        const waiting = st === 'filed';
        return (
          <span className="pc2-acts is-slots">
            {waiting ? (
              <>
                <button
                  type="button"
                  className="pc2-act a-go"
                  onClick={(e) => { e.stopPropagation(); shortlist(r.property, [r.doc]); }}
                  title={`Approve the ${r.docLabel} as filed`}
                >
                  <Check size={12} /> Approve
                </button>
                <button
                  type="button"
                  className="pc2-act a-reject"
                  onClick={(e) => { e.stopPropagation(); setRuling({ row: r.property, only: r.docKey }); }}
                  title="Send this document back to be filled in again, with a reason"
                >
                  <X size={12} /> Reject
                </button>
              </>
            ) : (
              /* A dash, not the status again: Current status is the column
                 beside this one, and printing "Approved" twice on one row
                 reads as two different facts. */
              <span className="tiny muted" title={DOC_STATE[st]?.hint || 'Nothing to decide on this one yet'}>—</span>
            )}
            {/* THE DOCUMENT ITSELF — its own report page, which is where its
                number, dates and attachments are. Only once something has
                been filed: there is nothing to read on a blank form. */}
            {r.doc?.id ? (
              <button
                type="button"
                className="pc2-act a-view"
                onClick={(e) => { e.stopPropagation(); openDocReport(r); }}
                title={`Read the ${r.docLabel} — its details, dates and attachments`}
              >
                <Eye size={12} /> View
              </button>
            ) : (
              <span className="tiny muted" title="Nothing has been filed on this document yet">—</span>
            )}
          </span>
        );
      },
    },
  ], [navigate, shortlist]);

  /* Properties first, then each expanded into its six documents. */
  /**
   * FILTERED BY THE DOCUMENT'S OWN STATUS, which is the only status this
   * sheet is about.
   *
   * The toolbar's Status box filters by the PROPERTY's status — shortlisted,
   * in commercial — which on a row that IS a single document answers a
   * question nobody asked here. Asking for 'Approved' matched the property,
   * not the lease. This is the other axis, and it is page-local because no
   * other step has rows that are documents.
   */
  const [docStatus, setDocStatus] = useState('');

  const allRows = useMemo(() => documentRows(propertiesOf(q.rows)), [q.rows]);

  const rows = useMemo(() => {
    if (!docStatus) return allRows;
    const kept = allRows.filter((r) => documentState(r.doc) === docStatus);
    /* A block whose first row was filtered out still has to name its
       property, or the rows underneath belong to nobody — and the merged
       cell would span rows that are no longer there. Re-marked here rather
       than in the builder, which does not know about filtering. */
    const seen = new Set();
    return kept.map((r) => {
      const first = !seen.has(r.property.id);
      seen.add(r.property.id);
      const span = kept.filter((x) => x.property.id === r.property.id).length;
      return { ...r, isFirst: first, span, isLast: false };
    });
  }, [allRows, docStatus]);


  return (
    <>
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing waiting on an approval'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <p className="psel-table-note">
                <AlertTriangle size={12} />
                Approving a document does not unlock anything and turning one back does not stop
                anything — games and dates can be planned while a NOC is still being argued about.
              </p>
              {/* What the last press did. Shortlist acts on the row rather
                  than in a dialog, so without this it acts silently and the
                  only evidence is a cell that changed somewhere to the left. */}
              <label className="pf-field" style={{ marginBottom: 10 }}>
                <span className="pf-label">Document status</span>
                <select className="pc2-select" value={docStatus} onChange={(e) => setDocStatus(e.target.value)}>
                  <option value="">All documents</option>
                  <option value="filed">Waiting on you</option>
                  <option value="done">Approved</option>
                  <option value="back">Sent back</option>
                  <option value="open">In progress</option>
                  <option value="start">Not started</option>
                </select>
              </label>
              {banner && (
                <p className={`psel-table-note${banner.tone === 'bad' ? ' is-bad' : ''}`}>
                  {banner.tone === 'bad' ? <AlertTriangle size={12} /> : <Check size={12} />}
                  {banner.text}
                </p>
              )}
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
      {ruling && (
        <DocSendBackModal
          row={ruling.row}
          onOpenDoc={openDoc}
          onClose={() => setRuling(null)}
          onDone={(text) => { setRuling(null); setBanner({ tone: 'ok', text }); }}
        />
      )}
      {confirming && (
        <ShortlistConfirm
          row={confirming.row}
          docs={confirming.docs}
          busy={approve.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            try {
              await approve.mutateAsync({ ids: confirming.docs.map((d) => d.id), decision: 'approve' });
              setBanner({ tone: 'ok', text: `${confirming.docs.length} documents approved on ${confirming.row.title}.` });
            } catch (err) {
              setBanner({ tone: 'bad', text: err?.response?.data?.message || 'Could not approve those documents.' });
            }
            setConfirming(null);
          }}
        />
      )}
    </>
  );
}

/**
 * SHORTLIST OVER SEVERAL DOCUMENTS — what is about to be approved, named.
 *
 * Only ever shown for more than one: a single document goes through on the
 * press, because a confirm on it is being asked to say yes twice. Five at once
 * is a different act, and "Shortlist" on its own does not say which five.
 */
function ShortlistConfirm({
  row, docs, busy, onConfirm, onClose,
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve ${docs.length} documents — ${row.title}`}
      subtitle={row.city}
      width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Approving…' : `Approve all ${docs.length}`}
          </button>
        </div>
      )}
    >
      <div className="col gap-2">
        <p className="sm" style={{ margin: 0 }}>
          These are every document on this property that has been submitted and not yet
          answered. Approving them accepts what was filed, as filed.
        </p>
        <ul className="pdr-list">
          {docs.map((d) => (
            <li key={d.id}>
              <b>{labelOf(d.type)}</b>
              <span className="prop-sub">
                {d.by ? `filed by ${d.by}` : 'filed'}{d.at ? ` · ${fmtDate(d.at)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/**
 * REJECT — which documents go back, and what the person who filed them is
 * meant to do about it.
 *
 * IT IS A SEND-BACK, NOT A REFUSAL. This dialog used to call the record
 * decision endpoint with `reject`, which marked the document REJECTED — and a
 * rejected record cannot be reopened as a form, so the doer was told their LOI
 * was wrong and then had no way to fix it. It goes back to DRAFT now, with
 * what they typed still in it, and their task reopens in My Tasks carrying
 * this reason. See propertyCapture.service#sendDocumentsBack.
 *
 * ONE REASON FOR THE WHOLE SEND-BACK, not one per document. The approver is
 * writing a note to a person, and six boxes invite six fragments where a
 * paragraph was wanted. Which documents it applies to is the checklist.
 *
 * THE REASON IS MANDATORY. It is the entire message the doer receives: a
 * send-back without one is somebody being told to do it again with no idea
 * what was wrong.
 */
function DocSendBackModal({
  row, onOpenDoc, onClose, onDone,
}) {
  const waiting = pending(row);
  const send = useSendDocumentsBack();
  const [picked, setPicked] = useState(() => waiting.map((d) => d.type));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const toggle = (type) => setPicked((s) => (s.includes(type) ? s.filter((t) => t !== type) : [...s, type]));

  const submit = async () => {
    if (!picked.length) { setError('Pick at least one document to send back.'); return; }
    if (!reason.trim()) { setError('Say what needs changing — it is all the doer will see.'); return; }
    setError(null);
    try {
      await send.mutateAsync({ recordId: row.recordId, documents: picked, reason: reason.trim() });
      onDone(`Sent back to ${row.title} — ${picked.length} document${picked.length === 1 ? '' : 's'}, with your reason.`);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not send that back.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Send back — ${row.title}`}
      subtitle={row.city}
      width={640}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: 'var(--danger)' }}
            disabled={send.isPending}
            onClick={submit}
          >
            <RotateCcw size={13} /> {send.isPending ? 'Sending…' : 'Send back'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {!waiting.length ? (
          <p className="sm" style={{ margin: 0 }}>
            Every document submitted on this property has been answered. There is nothing
            to send back.
          </p>
        ) : (
          <>
            <div className="col gap-1">
              <span className="pt-field-label">Which documents are going back?</span>
              {waiting.map((doc) => (
                <label className="pdr-pick" key={doc.id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(doc.type)}
                    onChange={() => toggle(doc.type)}
                  />
                  <span className="pdr-pick-body">
                    <b>{labelOf(doc.type)}</b>
                    <span className="prop-sub">
                      {doc.by ? `filed by ${doc.by}` : 'filed'}{doc.at ? ` · ${fmtDate(doc.at)}` : ''}
                    </span>
                  </span>
                  {/* Read it before you refuse it. */}
                  <button
                    type="button"
                    className="pc2-act a-view"
                    onClick={(e) => { e.stopPropagation(); onOpenDoc(row, doc.type, doc); }}
                    title="Open the form and read what was filed"
                  >
                    <Eye size={12} /> Open
                  </button>
                </label>
              ))}
            </div>

            <label className="pt-field">
              <span>What is wrong, and what do you want instead?</span>
              <textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="The lock-in reads 9 years — it was agreed at 3. Fix clause 4 and attach the signed copy, not the draft."
              />
            </label>

            <p className="tiny muted" style={{ margin: 0 }}>
              What you write here is the whole of what they are told. Their task reopens in
              My Tasks with this note on it, and the form opens again with everything they
              already filled in still in it — they are correcting it, not starting over.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

const labelOf = (type) => DOCUMENTS.find((d) => d.key === type)?.label || type;
