import { useMemo, useState } from 'react';
import {
  AlertTriangle, ThumbsUp, ThumbsDown, MapPin, Phone, Building2, Check,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  useGetFranchiseEnquiryQuery, useDecideFranchiseEnquiryMutation,
} from '../../app/api/franchiseApi.js';

/**
 * Approve or reject a submission, without leaving the queue.
 *
 * WHY THIS IS A DIALOG. The row's button used to navigate to the Franchise
 * module — which threw away the queue, the filters and the scroll position to
 * ask one yes/no question, and dropped the reader somewhere they then had to
 * find their way back from. Everything needed to answer it is on the row
 * already; the only thing missing was somewhere to click yes.
 *
 * WHY THE PROPERTIES ARE LISTED AND TICKABLE. One person can submit six
 * properties in a single application, and "approve this enquiry" is not one
 * decision about six sites — it is a decision about which of the six are worth
 * pursuing. Every property is shown with its own details and its own tick, and
 * the road below adapts to how many are ticked:
 *
 *   one site   → straight to commercial closure, which is what one obvious
 *                property means in practice;
 *   several    → Phase 1 captures them all and Phase 2 compares them;
 *   none yet   → an interest with no site, which starts the property search
 *                in their city instead of pretending there is a property.
 *
 * That last road is the reason this is not a plain confirm dialog.
 */
export function EnquiryDecisionModal({ enquiryId, onClose, onDone }) {
  const { data, isLoading } = useGetFranchiseEnquiryQuery(enquiryId, { skip: !enquiryId });
  const [decide, decideState] = useDecideFranchiseEnquiryMutation();

  const enquiry = data?.data || data || null;
  const properties = useMemo(() => enquiry?.properties || [], [enquiry]);

  const [choice, setChoice] = useState(null);      // 'approve' | 'reject'
  const [picked, setPicked] = useState(null);      // Set of indices, null until touched
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  /* Everything they sent is ticked to begin with — the common case is "yes, all
     of these", and starting from nothing makes the reader do clerical work to
     reach the answer they already had. */
  const chosen = picked ?? new Set(properties.map((_, i) => i));

  const toggle = (i) => setPicked(() => {
    const next = new Set(chosen);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  /* The road is DERIVED, not asked for. Somebody who has just ticked one
     property has already said everything the system needs; a second question
     called "which mode?" would be asking them to restate it in our words. */
  const road = chosen.size === 0 ? 'scout' : chosen.size === 1 ? 'loi' : 'assess';
  const ROAD_COPY = {
    loi: 'One property — it is filed as the chosen site and the project opens at commercial closure.',
    assess: `${chosen.size} properties — all are captured at Phase 1 and the ticked ones go forward to assessment.`,
    scout: enquiry?.interestCity
      ? `No property ticked — the project starts as a property search in ${enquiry.interestCity}.`
      : 'No property ticked — the project starts as a property search.',
  };

  const submit = async () => {
    setError(null);
    if (!choice) { setError('Approve or reject this submission.'); return; }
    if (choice === 'reject' && !reason.trim()) { setError('A rejection needs a reason — it is what the expansion map is built from.'); return; }
    try {
      const res = await decide({
        id: enquiryId,
        decision: choice,
        ...(choice === 'reject'
          ? { reason: reason.trim() }
          : { mode: road, propertyIds: properties.filter((_, i) => chosen.has(i)).map((p) => String(p._id)) }),
      }).unwrap();
      onDone?.(res?.data || res);
    } catch (err) {
      setError(err?.message || err?.data?.message || 'Could not record that decision.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={enquiry ? enquiry.name : 'Submission'}
      subtitle={enquiry
        ? [enquiry.phone, enquiry.email].filter(Boolean).join(' · ')
        : 'Loading the submission…'}
      width={640}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`btn ${choice === 'reject' ? 'btn-danger' : 'btn-primary'}`}
            disabled={decideState.isLoading || !choice}
            onClick={submit}
          >
            {decideState.isLoading ? 'Saving…'
              : choice === 'reject' ? 'Reject submission'
                : road === 'scout' ? 'Approve & start the search'
                  : `Approve & capture ${chosen.size} ${chosen.size === 1 ? 'property' : 'properties'}`}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {isLoading ? <p className="sm muted" style={{ margin: 0 }}>Loading…</p> : (
          <>
            {enquiry?.background && <p className="eq-note">{enquiry.background}</p>}

            {properties.length > 0 ? (
              <div className="col gap-2">
                <span className="eq-head">
                  <Building2 size={13} /> {properties.length === 1
                    ? 'The property they sent'
                    : `${properties.length} properties in this submission — tick the ones worth pursuing`}
                </span>

                {properties.map((p, i) => (
                  <label key={p._id || i} className={`eq-prop${chosen.has(i) ? ' active' : ''}`}>
                    <input type="checkbox" checked={chosen.has(i)} onChange={() => toggle(i)} />
                    <span className="eq-prop-body">
                      <b>{p.label || p.locality || p.city || `Property ${i + 1}`}</b>
                      <span className="eq-prop-sub">
                        <MapPin size={10} /> {[p.locality, p.city].filter(Boolean).join(', ') || '—'}
                        {p.address ? ` · ${p.address}` : ''}
                      </span>
                      <span className="eq-prop-meta">
                        {[
                          p.carpetAreaSqft ? `${Number(p.carpetAreaSqft).toLocaleString('en-IN')} sq ft` : null,
                          p.floor, p.ownership,
                          (p.photos?.length || p.videos?.length || p.documents?.length || p.driveLinks?.length)
                            ? `${(p.photos?.length || 0) + (p.videos?.length || 0) + (p.documents?.length || 0) + (p.driveLinks?.length || 0)} file(s)`
                            : null,
                        ].filter(Boolean).join(' · ') || 'No further details given'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="eq-interest">
                <MapPin size={16} />
                <b>Interested, no property yet</b>
                <span>
                  {enquiry?.interestCity
                    ? `They want a centre in ${enquiry.interestCity}${enquiry.interestArea ? ` — ${enquiry.interestArea}` : ''}.`
                    : 'No city given.'}
                </span>
                {enquiry?.plan && <span className="eq-plan">“{enquiry.plan}”</span>}
              </div>
            )}

            {enquiry?.phone && (
              <a className="eq-call" href={`tel:${enquiry.phone}`}><Phone size={12} /> {enquiry.phone}</a>
            )}

            <p className="sm" style={{ margin: 0 }}>What is the decision?</p>
            <div className="prop-choice">
              <button
                type="button"
                className={`prop-choice-btn${choice === 'approve' ? ' active' : ''}`}
                onClick={() => setChoice('approve')}
              >
                <ThumbsUp size={18} />
                <b>Approve</b>
                <span className="tiny muted">Creates the project and files what they sent.</span>
              </button>
              <button
                type="button"
                className={`prop-choice-btn is-danger${choice === 'reject' ? ' active' : ''}`}
                onClick={() => setChoice('reject')}
              >
                <ThumbsDown size={18} />
                <b>Reject</b>
                <span className="tiny muted">Off the table. The reason stays on the record.</span>
              </button>
            </div>

            {/* Spelled out, so nobody presses Approve to find out what it did. */}
            {choice === 'approve' && (
              <p className="eq-road"><Check size={12} /> {ROAD_COPY[road]}</p>
            )}

            {choice === 'reject' && (
              <label className="pt-field">
                <span>Why are we saying no?</span>
                <textarea
                  rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="City already covered, area too small, terms unworkable…"
                />
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default EnquiryDecisionModal;
