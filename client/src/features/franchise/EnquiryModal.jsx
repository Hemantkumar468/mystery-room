/**
 * One franchise enquiry, opened — and the decision.
 *
 * Approve creates the project (the server does the whole thing: project at
 * Phase 3, property filed and approved), so the button says exactly that and
 * lands the MD on the new project. Reject asks for a reason, because the
 * reason is the record of why a city said no — the server refuses without one.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Building2, IndianRupee, CheckCircle2, XCircle, FolderKanban, AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useDecideFranchiseEnquiryMutation } from '../../app/api/franchiseApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { fmtDateTime } from '../../lib/format.js';
import { ENQUIRY_STATUS_META, OWNERSHIP_LABEL, mapsLinkFor } from './franchiseUi.js';

export function EnquiryModal({ enquiry: e, onClose }) {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);
  const [decide, { isLoading }] = useDecideFranchiseEnquiryMutation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const meta = ENQUIRY_STATUS_META[e.status] || {};
  const maps = mapsLinkFor(e.location);
  const phone = String(e.phone || '').replace(/[^\d]/g, '');
  const wa = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}` : null;

  const approve = async () => {
    setError(null);
    try {
      const out = await decide({ id: e._id, decision: 'approve' }).unwrap();
      flashSuccess('Approved — project created at Phase 3 (LOI)');
      onClose();
      const pid = out?.project?._id || out?.project;
      if (pid) navigate(`/projects/${pid}`);
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not approve right now.');
    }
  };

  const reject = async () => {
    setError(null);
    if (!reason.trim()) { setError('Say why — the reason is the record of this decision.'); return; }
    try {
      await decide({ id: e._id, decision: 'reject', reason: reason.trim() }).unwrap();
      flashSuccess('Enquiry rejected');
      onClose();
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not reject right now.');
    }
  };

  const pending = e.status === 'submitted';

  return (
    <Modal
      open
      onClose={onClose}
      title={`${e.name} — ${e.city}`}
      subtitle={`Enquired ${fmtDateTime(e.createdAt)}`}
      width={720}
      footer={pending && canDecide ? (
        rejecting ? (
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={isLoading}>Back</button>
            <button type="button" className="btn btn-danger" onClick={reject} disabled={isLoading} data-guide="fr-reject-confirm">
              <XCircle size={14} /> {isLoading ? 'Saving…' : 'Reject with this reason'}
            </button>
          </div>
        ) : (
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-subtle" onClick={() => setRejecting(true)} disabled={isLoading} data-guide="fr-reject">
              <XCircle size={14} /> Reject
            </button>
            <button type="button" className="btn btn-primary" onClick={approve} disabled={isLoading} data-guide="fr-approve">
              <CheckCircle2 size={14} /> {isLoading ? 'Creating the project…' : 'Approve — create the project'}
            </button>
          </div>
        )
      ) : (
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="col gap-3">
        <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge color={meta.color} soft={meta.soft} dot>{meta.label || e.status}</Badge>
          {wa && <a className="btn btn-ghost btn-sm" href={wa} target="_blank" rel="noreferrer"><Phone size={12} /> WhatsApp {e.phone}</a>}
          {e.email && <a className="btn btn-ghost btn-sm" href={`mailto:${e.email}`}><Mail size={12} /> {e.email}</a>}
          {maps && <a className="btn btn-ghost btn-sm" href={maps} target="_blank" rel="noreferrer"><MapPin size={12} /> Open the pin on a map</a>}
        </div>

        {e.status === 'approved' && (
          <p className="fr-decided is-approved">
            <CheckCircle2 size={13} /> Approved by {e.decidedBy?.name || 'someone'} on {fmtDateTime(e.decidedAt)}.
            {e.project && <> Project: <Link to={`/projects/${e.project._id || e.project}`}><FolderKanban size={12} /> {e.project.name || 'open'}</Link></>}
          </p>
        )}
        {e.status === 'rejected' && (
          <p className="fr-decided is-rejected">
            <XCircle size={13} /> Rejected by {e.decidedBy?.name || 'someone'} on {fmtDateTime(e.decidedAt)}{e.rejectReason ? ` — ${e.rejectReason}` : ''}.
          </p>
        )}

        <div className="fr-facts">
          <div><span className="fr-k">City</span><span className="fr-v">{e.city}{e.locality ? ` · ${e.locality}` : ''}</span></div>
          <div><span className="fr-k">Carpet area</span><span className="fr-v">{e.carpetAreaSqft ? `${Number(e.carpetAreaSqft).toLocaleString('en-IN')} sq ft` : '—'}</span></div>
          <div><span className="fr-k">Floor</span><span className="fr-v">{e.floor || '—'}</span></div>
          <div><span className="fr-k">Ownership</span><span className="fr-v">{OWNERSHIP_LABEL[e.ownership] || e.ownership || '—'}</span></div>
          <div><span className="fr-k"><IndianRupee size={10} /> Investment</span><span className="fr-v">{e.investmentReady || '—'}</span></div>
        </div>

        <div>
          <span className="fr-k"><Building2 size={10} /> Address</span>
          <p className="sm" style={{ margin: '2px 0 0' }}>{e.address}</p>
        </div>

        {e.background && (
          <div className="col gap-1">
            <span className="fr-k">Their background</span>
            <p className="fr-quote">{e.background}</p>
          </div>
        )}
        {e.message && (
          <div className="col gap-1">
            <span className="fr-k">In their words</span>
            <p className="fr-quote">{e.message}</p>
          </div>
        )}

        {(e.photos || []).length > 0 && (
          <div className="col gap-1">
            <span className="fr-k">Photos of the property</span>
            <div className="fr-photos">
              {e.photos.map((p, i) => (
                <a key={p.url || i} href={p.url} target="_blank" rel="noreferrer" title={p.name || `photo ${i + 1}`}>
                  <img src={p.url} alt={p.name || `Property photo ${i + 1}`} loading="lazy" />
                </a>
              ))}
            </div>
          </div>
        )}

        {pending && canDecide && !rejecting && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Approving creates a project for {e.city} straight away — Phases 1–2 marked done by the system, this property filed as its approved site, and the project standing at Phase 3 (LOI).
          </p>
        )}
        {pending && canDecide && rejecting && (
          <div className="col gap-1">
            <label className="label" htmlFor="fr-reason">Why not? (kept on the enquiry)</label>
            <textarea id="fr-reason" className="textarea" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Too close to our Agra centre; area under 2,000 sq ft; not investment-ready" autoFocus />
          </div>
        )}
        {pending && !canDecide && (
          <p className="tiny muted" style={{ margin: 0 }}>Only leadership and managers can decide an enquiry.</p>
        )}
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
      </div>
    </Modal>
  );
}

export default EnquiryModal;
