import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Eye, AlertTriangle, RotateCcw } from 'lucide-react';
import { DOCUMENTS, useSendDocumentsBack } from '../../app/api/propertyCaptureApi.js';
import { useBulkRecordDecision } from '../../app/api/recordsApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentColumns, documentState, documentOpensAsForm } from './DocumentCell.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty,
  filesColumn, whoWhenColumns, fmtDate, SourceBadge,
  groupByCity, stackPerSite,
} from './propertyUi.jsx';
import {
  serialNumberColumn, sourceColumn, cityColumn, locationColumn,
  propertyBoxesColumn, statusColumn, PropertySheetFooter,
} from './PropertySheet.jsx';
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

  const openDoc = (row, type, doc) => {
    if (!row.projectId) return;
    navigate(documentOpensAsForm(doc)
      ? `/projects/${row.projectId}/commercial-finalization?form=${type}`
      : `/projects/${row.projectId}/commercial-finalization/record/${doc.id}`);
  };

  const columns = useMemo(() => [
    serialNumberColumn({ page: q.page, limit: q.limit }),
    /* The shared width, not a narrower local one: 130px cut "Company Owned"
       on these four steps while the same badge fitted on the other three. */
    sourceColumn(),
    cityColumn({ width: 140 }),
    locationColumn({ width: 150 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),
    statusColumn(),

    /* Who owns closure and by when — the four pillars for this step */
    ...whoWhenColumns('commercial', {
      getPlan: (r) => r.commercialPlan,
      getDoneBy: (r) => r.docReview?.approved ? 'Approver' : null,
      getDoneAt: (r) => null,
    }),

    {
      /**
       * WHAT IS ACTUALLY WAITING ON YOU — first thing after the property,
       * because it is the only reason this row is on this screen.
       *
       * Counted against the six, not against what happens to have been
       * submitted: "2 of 6 waiting" and "2 waiting" are different facts, and
       * the second one hides that four have not been started.
       */
      key: 'waiting', label: 'Waiting on you', width: 132, sort: false,
      render: (r) => {
        const n = r.docReview?.submitted || 0;
        const done = r.docReview?.approved || 0;
        const back = r.docReview?.rejected || 0;
        return (
          <>
            <span className={`pc2-status ${n ? 's-go' : 's-done'}`}>
              {n ? `${n} to decide` : 'All decided'}
            </span>
            <span className="prop-sub">
              {done} approved{back ? `, ${back} sent back` : ''} of {DOCUMENTS.length}
            </span>
          </>
        );
      },
    },

    filesColumn((row, at) => setMedia({ row, at })),

    /* The six documents in full, banded — the same cells Step 5 renders. */
    ...DOCUMENTS.flatMap((d) => documentColumns(d, openDoc)),

    /* NO PROJECT COLUMN. Nothing on this step has a project yet — creating one
       is All Project Creation, two steps further on — so the name printed here
       was the PLACEHOLDER project a capture is filed against ("Gurugram —
       Hemant"), read by everybody as a project that had been created. A column
       that answers a question nobody asked, wrongly. */

    /**
     * THE VERDICT, LAST AND PINNED — the same two words every other step in
     * this module uses.
     *
     * It was one button reading "Review 3" that opened a dialog to do the
     * deciding in, next to a View that also opened something. Two buttons, one
     * verb between them, and the answer a click away from the row that needed
     * it. The verdict is on the row now: Shortlist takes the paperwork, Reject
     * sends it back to the person who filed it.
     *
     * `is-slots` so the three keep fixed positions whether or not a row has
     * anything waiting — see property-capture.css.
     */
    {
      key: 'action', pin: 'right', label: 'Action', width: 262,
      render: (r) => {
        const waiting = pending(r);
        const n = waiting.length;
        return (
          <span className="pc2-acts is-slots">
            {n ? (
              <>
                <button
                  type="button"
                  className="pc2-act a-go"
                  onClick={(e) => { e.stopPropagation(); shortlist(r, waiting); }}
                  title={n === 1
                    ? `Approve the ${labelOf(waiting[0].type)} as filed`
                    : `${n} documents are waiting — this approves all of them`}
                >
                  <Check size={12} /> Shortlist
                </button>
                <button
                  type="button"
                  className="pc2-act a-reject"
                  onClick={(e) => { e.stopPropagation(); setRuling({ row: r }); }}
                  title="Send it back to be filled in again, with a reason"
                >
                  <X size={12} /> Reject
                </button>
              </>
            ) : (
              <span className="tiny muted" title="Nothing submitted on this property is waiting on a decision">
                Nothing waiting
              </span>
            )}
            <button
              type="button"
              className="pc2-act a-view"
              onClick={(e) => { e.stopPropagation(); setDetails(r); }}
              title="Read the whole report for this property"
            >
              <Eye size={12} /> View
            </button>
          </span>
        );
      },
    },
  ], [navigate, shortlist]);

  const perSiteKeys = useMemo(() => [
    'source', 'locality',
    'commercialAssigned', 'commercialDoneBy', 'commercialPlanDate', 'commercialDoneAt',
    'waiting', 'files', 'action',
    ...DOCUMENTS.flatMap((d) => [
      `${d.key}_state`, `${d.key}_from`, `${d.key}_expiry`,
      `${d.key}_by`, `${d.key}_done_by`, `${d.key}_plan_date`, `${d.key}_at`,
    ]),
  ], []);

  const perSite = useMemo(() => stackPerSite(columns, perSiteKeys), [columns, perSiteKeys]);
  const rows = useMemo(() => groupByCity(q.rows), [q.rows]);

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
              {banner && (
                <p className={`psel-table-note${banner.tone === 'bad' ? ' is-bad' : ''}`}>
                  {banner.tone === 'bad' ? <AlertTriangle size={12} /> : <Check size={12} />}
                  {banner.text}
                </p>
              )}
              <div className="pc2-tablewrap">
                <PropTable
                  columns={perSite}
                  rows={rows}
                  rowKey={(r) => r.id}
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
