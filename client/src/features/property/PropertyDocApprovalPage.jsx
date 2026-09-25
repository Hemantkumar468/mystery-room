import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Eye, AlertTriangle } from 'lucide-react';
import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { useRecordDecision } from '../../app/api/recordsApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentColumns, documentState, documentOpensAsForm } from './DocumentCell.jsx';
import {
  PropertyToolbar, PageHead, PropEmpty,
  filesColumn, whoWhenColumns, fmtDate, SourceBadge,
  groupByCity, stackPerSite,
} from './propertyUi.jsx';
import { locationColumn, propertyBoxesColumn, PropertySheetFooter } from './PropertySheet.jsx';
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

const dim = <span className="prop-dim">—</span>;

/** The documents on one property that are waiting on an answer. */
const pending = (row) => (row.documents || [])
  .filter((d) => documentState(d) === 'filed');

export default function PropertyDocApprovalPage() {
  const navigate = useNavigate();
  const q = usePropertyQuery('docreview');
  const [media, setMedia] = useState(null);
  const [details, setDetails] = useState(null);
  /* `{ row, doc, mode }` — which document is being ruled on, and which way. */
  const [ruling, setRuling] = useState(null);

  const openDoc = (row, type, doc) => {
    if (!row.projectId) return;
    navigate(documentOpensAsForm(doc)
      ? `/projects/${row.projectId}/commercial-finalization?form=${type}`
      : `/projects/${row.projectId}/commercial-finalization/record/${doc.id}`);
  };

  const columns = useMemo(() => [
    { key: 'source', label: 'Source', width: 130, sort: true, render: (r) => <SourceBadge source={r.source} /> },
    locationColumn({ width: 180 }),
    propertyBoxesColumn({ width: 240, onDetails: setDetails }),

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

    {
      key: 'project', label: 'Project', width: 156, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : dim),
    },

    /**
     * THE VERDICT, LAST AND PINNED.
     *
     * One control per property rather than per document, and it opens the list
     * of what is waiting. Six approve buttons across a row would be six
     * controls to hunt through on a sheet already forty columns wide, and four
     * of them would be dead on most rows because those documents are not
     * submitted yet.
     */
    {
      /* Sized to the widest thing it holds — "Nothing to review" plus View,
         which measures 154. It was 224, and the 70px left over sat pinned to
         the right of every row where it reads as a column that failed to
         load rather than one with nothing to put in it. */
      key: 'action', pin: 'right', label: 'Action', width: 172,
      render: (r) => {
        const n = pending(r).length;
        return (
          <span className="pc2-acts">
            <button
              type="button"
              className={`pc2-act ${n ? 'a-go' : ''}`}
              disabled={!n}
              onClick={(e) => { e.stopPropagation(); setRuling({ row: r }); }}
              title={n
                ? `${n} document(s) submitted and waiting on a decision`
                : 'Nothing submitted on this property is waiting on a decision'}
            >
              <Check size={12} /> {n ? `Review ${n}` : 'Nothing to review'}
            </button>
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
  ], [navigate]);

  const perSiteKeys = useMemo(() => [
    'source',
    'commercialAssigned', 'commercialDoneBy', 'commercialPlanDate', 'commercialDoneAt',
    'waiting', 'files', 'project', 'action',
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
        <DocReviewModal
          row={ruling.row}
          onOpenDoc={openDoc}
          onClose={() => setRuling(null)}
        />
      )}
    </>
  );
}

/**
 * The approver's dialog: every submitted document on one property, each with
 * its own answer.
 *
 * ONE DIALOG, NOT ONE PER DOCUMENT. Somebody opening this has a property in
 * front of them and usually rules on all of its submitted documents in one
 * sitting; closing and reopening between each is the work this step was meant
 * to remove. Each still gets its own approve and its own send-back, because
 * they are separate decisions with separate consequences.
 *
 * A SEND-BACK NEEDS A REASON and an approval does not. That asymmetry is
 * deliberate: "approved" is complete on its own, and "rejected" without a
 * reason is a doer being told to do it again with no idea what was wrong.
 */
function DocReviewModal({ row, onOpenDoc, onClose }) {
  const decide = useRecordDecision(row.projectId, 'p3');
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const waiting = pending(row);

  const rule = async (doc, decision) => {
    const reason = (reasons[doc.id] || '').trim();
    if (decision === 'reject' && !reason) {
      setError(`Say what is wrong with the ${labelOf(doc.type)} before sending it back.`);
      return;
    }
    setError(null);
    setBusy(doc.id);
    try {
      await decide.mutateAsync({ id: doc.id, decision, reason: reason || undefined });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not record that decision.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Documents waiting on you — ${row.title}`}
      subtitle={[row.city, row.projectName].filter(Boolean).join(' · ')}
      width={720}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {!waiting.length && (
          <p className="sm" style={{ margin: 0 }}>
            Every document submitted on this property has been answered. The row leaves this
            step on its own once the queue refreshes.
          </p>
        )}

        {waiting.map((doc) => (
          <div className="pdr-doc" key={doc.id}>
            <div className="pdr-doc-head">
              <b>{labelOf(doc.type)}</b>
              <span className="prop-sub">
                {doc.by ? `Submitted by ${doc.by}` : 'Submitted'}
                {doc.at ? ` · ${fmtDate(doc.at)}` : ''}
              </span>
              <button
                type="button"
                className="pc2-act a-view"
                onClick={() => onOpenDoc(row, doc.type, doc)}
                title="Open the form and read what was filed"
              >
                <Eye size={12} /> Open the form
              </button>
            </div>

            <label className="pt-field">
              <span>Why are you sending it back? (needed only to send back)</span>
              <textarea
                rows={2}
                value={reasons[doc.id] || ''}
                onChange={(e) => setReasons((s) => ({ ...s, [doc.id]: e.target.value }))}
                placeholder="The lock-in is 3 years, not 9 — check clause 4 against what we agreed…"
              />
            </label>

            <div className="row gap-2">
              <button
                type="button"
                className="pc2-act a-go"
                disabled={busy === doc.id}
                onClick={() => rule(doc, 'approve')}
              >
                <Check size={12} /> {busy === doc.id ? 'Saving…' : 'Approve'}
              </button>
              <button
                type="button"
                className="pc2-act a-reject"
                disabled={busy === doc.id}
                onClick={() => rule(doc, 'reject')}
              >
                <X size={12} /> Send it back
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const labelOf = (type) => DOCUMENTS.find((d) => d.key === type)?.label || type;
