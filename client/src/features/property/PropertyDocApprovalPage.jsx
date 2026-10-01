import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Eye, AlertTriangle, Paperclip } from 'lucide-react';
import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { useRecordDecision } from '../../app/api/recordsApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropTable } from './PropTable.jsx';
import { documentState, documentOpensAsForm, daysLeft } from './DocumentCell.jsx';
import { PropertyToolbar, PropEmpty, fmtDate, AssignedCell, PlanDateCell } from './propertyUi.jsx';
import { PropertySheetFooter } from './PropertySheet.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';
import { PropertyDetailsModal } from './PropertyDetailsModal.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

/** Step 6 — one reviewable commercial document per row. */
const EMPTY_HINT = 'A property appears here as soon as one commercial document is submitted for review.';
const dim = <span className="prop-dim">—</span>;

const DATES = {
  loi: { from: 'loi_date', fromLabel: 'Dated', to: 'valid_until', toLabel: 'Valid until' },
  lease: { from: 'lease_start_date', fromLabel: 'Starts', to: 'lease_end_date', toLabel: 'Runs to' },
  legal: { from: 'verification_date', fromLabel: 'Verified' },
  deposit: { from: 'payment_date', fromLabel: 'Paid on' },
  nocs: { to: 'expiry_date', toLabel: 'Expires' },
  approvals: {},
};

const DETAIL = {
  loi: (v) => v.loi_number && `LOI ${v.loi_number}`,
  lease: (v) => v.renewal_option && `Renewal: ${v.renewal_option}`,
  legal: (v) => v.property_ownership || v.advocate_name || v.title_verification,
  deposit: (v) => (Number(v.security_deposit)
    ? `₹${Number(v.security_deposit).toLocaleString('en-IN')}`
    : v.payment_mode || null),
  nocs: (v) => v.noc_type,
  approvals: (v) => v.approval_level,
};

const STATE = {
  start: { label: 'Not submitted', cls: 'is-start' },
  open: { label: 'In progress', cls: 'is-open' },
  filed: { label: 'Waiting for review', cls: 'is-filed' },
  done: { label: 'Approved', cls: 'is-done' },
};

const attachmentsOf = (doc) => {
  const v = doc?.values || {};
  return [
    ...(v.documents || []), ...(v.lease_document || []), ...(v.noc_document || []),
    ...(v.approval_document || []), ...(v.payment_proof || []), ...(v.legal_opinion || []),
    ...(doc?.attachments || []),
  ].filter(Boolean);
};

function documentRows(properties) {
  return properties.flatMap((property) => DOCUMENTS.map((document, index) => ({
    id: `${property.id}:${document.key}`,
    property,
    doc: (property.documents || []).find((item) => item.type === document.key) || null,
    slot: (property.documentSlots || []).find((item) => item.type === document.key) || null,
    docKey: document.key,
    docLabel: document.label,
    isFirst: index === 0,
    isLast: index === DOCUMENTS.length - 1,
  })));
}

export default function PropertyDocApprovalPage() {
  const navigate = useNavigate();
  const q = usePropertyQuery('docreview');
  const [media, setMedia] = useState(null);
  const [details, setDetails] = useState(null);
  const [reviewing, setReviewing] = useState(null);

  const openDocument = (row) => {
    if (!row.property.projectId) return;
    navigate(documentOpensAsForm(row.doc)
      ? `/projects/${row.property.projectId}/commercial-finalization?form=${row.docKey}`
      : `/projects/${row.property.projectId}/commercial-finalization/record/${row.doc.id}`);
  };

  const columns = useMemo(() => [
    {
      key: 'city', label: 'Location', width: 122, sort: true,
      render: (row) => (row.isFirst ? <>
        <div className="prop-name" title={row.property.city}>{row.property.city || '—'}</div>
        {row.property.locality && <div className="prop-sub" title={row.property.locality}>{row.property.locality}</div>}
      </> : null),
    },
    {
      key: 'property', label: 'Property', width: 178, sort: true,
      render: (row) => (row.isFirst ? <>
        <button type="button" className="prop-link pcx-prop" onClick={(event) => { event.stopPropagation(); setDetails(row.property); }} title="View the complete property details">
          {row.property.title}
        </button>
        <div className="prop-sub">
          {row.property.areaSqft ? `${Number(row.property.areaSqft).toLocaleString('en-IN')} sq ft` : ''}
          {row.property.floor ? ` · ${row.property.floor}` : ''}
        </div>
      </> : null),
    },
    {
      key: 'document', label: 'Document', width: 154,
      render: (row) => {
        const detail = DETAIL[row.docKey]?.(row.doc?.values || {});
        return <><span className="pcx-doc-name">{row.docLabel}</span>{detail && <div className="prop-sub" title={detail}>{detail}</div>}</>;
      },
    },
    {
      key: 'status', label: 'Status', width: 144,
      render: (row) => {
        const state = documentState(row.doc);
        const meta = STATE[state];
        return <span className={`pc2-doc ${meta.cls}`}>{state === 'done' && <Check size={11} />}{meta.label}</span>;
      },
    },
    {
      key: 'assigned', label: 'Assigned to', width: 126,
      render: (row) => <AssignedCell plan={row.slot?.assignedTo ? { assignedNames: [row.slot.assignedTo] } : null} row={row.property} />,
    },
    {
      key: 'submittedBy', label: 'Submitted by', width: 138,
      render: (row) => {
        const by = row.slot?.filedBy || row.doc?.by;
        const at = row.slot?.filedAt || row.doc?.at;
        if (!by && !at) return <span className="prop-dim">Not yet</span>;
        return <>{by ? <span className="prop-person">{by}</span> : dim}{at && <div className="prop-sub">{fmtDate(at)}</div>}</>;
      },
    },
    {
      key: 'planDate', label: 'Plan date', width: 104,
      render: (row) => <PlanDateCell plan={row.slot?.planDate ? { planDate: row.slot.planDate } : null} row={row.property} />,
    },
    {
      key: 'dates', label: 'Document dates', width: 152,
      render: (row) => {
        const config = DATES[row.docKey] || {};
        const values = row.doc?.values || {};
        const from = config.from ? fmtDate(values[config.from]) : null;
        const to = config.to ? values[config.to] : null;
        if (!from && !to) return dim;
        const left = to ? daysLeft(to) : null;
        return <>{from && <div className="as-when">{config.fromLabel}: {from}</div>}{to && <div className="as-when">{config.toLabel}: {fmtDate(to)}{left && <span className={`pc2-expiry t-${left.tone}`}>{left.text}</span>}</div>}</>;
      },
    },
    {
      key: 'uploaded', label: 'Uploaded', width: 114,
      render: (row) => {
        const files = attachmentsOf(row.doc);
        return files.length ? <button type="button" className="pc2-act a-view" onClick={(event) => {
          event.stopPropagation();
          setMedia({ row: { ...row.property, title: `${row.property.title} — ${row.docLabel}`, media: { files: files.map((file) => (typeof file === 'string' ? { url: file, kind: 'document' } : file)) } }, at: 0 });
        }}><Paperclip size={12} /> View {files.length}</button> : <span className="prop-dim">None</span>;
      },
    },
    {
      key: 'action', pin: 'right', label: 'Action', width: 176,
      render: (row) => {
        const awaitingReview = documentState(row.doc) === 'filed';
        return <span className="pc2-acts">
          <button type="button" className={`pc2-act ${awaitingReview ? 'a-go' : 'a-view'}`} disabled={!row.doc} onClick={(event) => { event.stopPropagation(); awaitingReview ? setReviewing(row) : openDocument(row); }} title={awaitingReview ? `Review and decide the ${row.docLabel}` : `View the ${row.docLabel}`}>
            {awaitingReview ? <Check size={12} /> : <Eye size={12} />} {awaitingReview ? 'Review' : 'View'}
          </button>
          {awaitingReview && <button type="button" className="pc2-act a-view" onClick={(event) => { event.stopPropagation(); openDocument(row); }} title={`Open the complete ${row.docLabel}`}><Eye size={12} /> Details</button>}
        </span>;
      },
    },
  ], [navigate]);

  const rows = useMemo(() => documentRows(q.rows || []), [q.rows]);

  return <>
    <PropertyToolbar q={q} />
    {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
      : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn't respond." />
        : rows.length === 0 ? <PropEmpty title={q.active ? 'Nothing matches those filters' : 'Nothing waiting on approval'} hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT} />
          : <>
            <p className="psel-table-note"><AlertTriangle size={12} />Review each submitted document. Approving the LOI automatically starts Project Creation for this property.</p>
            <div className="pc2-tablewrap"><PropTable columns={columns} rows={rows} rowKey={(row) => row.id} rowClass={(row) => `pcx-row${row.isFirst ? ' is-first' : ''}${row.isLast ? ' is-last' : ''}`} sort={q.sort} onSort={q.toggleSort} busy={q.isFetching} /></div>
            <PropertySheetFooter q={q} />
          </>}

    {media && <PropertyMediaModal row={media.row} startAt={media.at} onClose={() => setMedia(null)} />}
    {details && <PropertyDetailsModal row={details} onClose={() => setDetails(null)} />}
    {reviewing && <DocumentReviewModal row={reviewing} onOpenDocument={openDocument} onClose={() => setReviewing(null)} />}
  </>;
}

function DocumentReviewModal({ row, onOpenDocument, onClose }) {
  const decide = useRecordDecision(row.property.projectId, 'p3');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const values = Object.entries(row.doc?.values || {}).filter(([, value]) => value !== '' && value != null && (!Array.isArray(value) || value.length));

  const rule = async (decision) => {
    if (decision === 'reject' && !reason.trim()) {
      setError(`Add a reason before sending the ${row.docLabel} back.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await decide.mutateAsync({ id: row.doc.id, decision, reason: reason.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save the document decision.');
    } finally {
      setBusy(false);
    }
  };

  return <Modal open onClose={onClose} title={`Review ${row.docLabel} — ${row.property.title}`} subtitle={[row.property.city, row.property.projectName].filter(Boolean).join(' · ')} width={760} footer={<div className="row gap-2" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>}>
    <div className="col gap-3">
      {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
      <div className="pdr-doc">
        <div className="pdr-doc-head"><div><b>{row.docLabel}</b><div className="prop-sub">{row.doc?.by ? `Submitted by ${row.doc.by}` : 'Submitted'}{row.doc?.at ? ` · ${fmtDate(row.doc.at)}` : ''}</div></div><button type="button" className="pc2-act a-view" onClick={() => onOpenDocument(row)}><Eye size={12} /> Open full document</button></div>
        {values.length ? <div className="pdr-facts">{values.map(([key, value]) => <div className="pdr-fact" key={key}><span>{humanize(key)}</span><b>{formatValue(value)}</b></div>)}</div> : <p className="sm muted">No form values were submitted. Open the full document to inspect its files.</p>}
      </div>
      <label className="pt-field"><span>Reason to send back (required only when rejecting)</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain exactly what must be corrected before this document is resubmitted." /></label>
      <div className="row gap-2"><button type="button" className="pc2-act a-go" disabled={busy} onClick={() => rule('approve')}><Check size={12} /> {busy ? 'Saving…' : 'Approve document'}</button><button type="button" className="pc2-act a-reject" disabled={busy} onClick={() => rule('reject')}><X size={12} /> Send back</button></div>
    </div>
  </Modal>;
}

const humanize = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatValue = (value) => Array.isArray(value) ? value.map((item) => (typeof item === 'object' ? item.name || item.url || 'File' : item)).join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
