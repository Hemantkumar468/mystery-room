import { useMemo, useState } from 'react';
import {
  AlertTriangle, MapPin, Phone, Building2, ThumbsDown, Check,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useGetSubmissionQuery, useRouteSubmission } from '../../app/api/propertyCaptureApi.js';
import { RoadChoice, AssessmentPicker, toggleIn, allAssessmentKeys } from './AssessmentPicker.jsx';

/**
 * What happens next to a property that arrived through the franchise or
 * referral link — asked as ONE question, in the queue it arrived in.
 *
 * WHY THIS IS NOT AN APPROVE/REJECT DIALOG ANY MORE. It was, and that was the
 * wrong question. Nobody approves a submission and then separately wonders
 * what to do with the property: approving it IS deciding to assess it or to
 * close on it. Asking "approve?" first made the reader answer a bookkeeping
 * question to earn the right to answer the real one, and left the actual
 * routing to a second dialog on a second screen.
 *
 * So this asks exactly what every other property in the queue is asked —
 * assessment, and if so which; or straight to commercial closure — and the
 * approval is what that answer does. `routeSubmission` on the server derives
 * the franchise road from it ('assess' or 'loi'), files the property, and
 * opens the forms the answer chose. One call, so the queue can never be left
 * holding an approved lead whose property was never routed.
 *
 * REJECT IS STILL HERE, third and quieter. You cannot only ever say yes, and
 * "not for us" needs its reason recorded — that reason is what the expansion
 * map is built from. But it is not the first thing the eye lands on, because
 * it is not the common answer.
 *
 * WHY THE PROPERTIES ARE TICKABLE. One person can submit six sites in a single
 * application, and this is not one decision about six of them. Each is ticked
 * or not; "straight to commercial" means one chosen site, so it asks for
 * exactly one.
 */
/** `initialMode` preselects the answer the caller already pressed on the row —
 *  Reject on the queue opens this with reject chosen, so the only thing left to
 *  do is say why. */
export function EnquiryDecisionModal({ enquiryId, initialMode = null, onClose, onDone }) {
  const { data, isLoading } = useGetSubmissionQuery(enquiryId, { skip: !enquiryId });
  const route = useRouteSubmission();

  const enquiry = data?.data || data || null;
  const properties = useMemo(() => enquiry?.properties || [], [enquiry]);

  const [mode, setMode] = useState(initialMode);   // 'assess' | 'skip' | 'reject'
  const [picked, setPicked] = useState(null);      // Set of property indices, null until touched
  const [types, setTypes] = useState(allAssessmentKeys);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  /* Everything they sent is ticked to begin with — the common case is "yes,
     all of these", and starting from nothing makes the reader do clerical work
     to reach the answer they already had. */
  const chosen = picked ?? new Set(properties.map((_, i) => i));
  const chosenIds = properties.filter((_, i) => chosen.has(i)).map((p) => String(p._id));

  const submit = async () => {
    setError(null);
    if (!mode) { setError('Choose what happens next to this property.'); return; }
    if (mode === 'reject' && !reason.trim()) {
      setError('A rejection needs a reason — it is what the expansion map is built from.');
      return;
    }
    if (mode !== 'reject' && chosen.size === 0) {
      setError('Tick at least one property to take forward.');
      return;
    }
    /* Caught here rather than by the server, because the fix is a tick the
       reader can see: going straight to commercial means one chosen site. */
    if ((mode === 'skip' || mode === 'project') && chosen.size > 1) {
      setError('Going straight to commercial or project means one chosen site — untick the others, or send them for assessment.');
      return;
    }
    if (mode === 'assess' && types.size === 0) {
      setError('Pick at least one assessment, or send it straight to commercial.');
      return;
    }

    try {
      const result = await route.mutateAsync({
        enquiryId,
        ...(mode === 'reject'
          ? { decision: 'reject', reason: reason.trim() }
          : {
            decision: 'approve',
            propertyIds: chosenIds,
            /* `road` is what the server reads now; `skip` rides along on the
               commercial road so an older server still understands it. */
            road: mode === 'skip' ? 'commercial' : mode === 'project' ? 'project' : 'assessment',
            ...(mode === 'assess' ? { assessments: [...types] } : { skip: true }),
          }),
      });
      onDone?.(result?.data || result);
    } catch (err) {
      setError(err?.response?.data?.message || err?.data?.message || err?.message || 'Could not record that decision.');
    }
  };

  const cta = mode === 'reject' ? 'Decline submission'
    : mode === 'project' ? 'Approve → games + closure'
      : mode === 'skip' ? 'Approve & open commercial closure'
        : mode === 'assess' ? `Approve & open ${types.size} assessment${types.size === 1 ? '' : 's'}`
          : 'Choose what happens next';

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
            className={`btn ${mode === 'reject' ? 'btn-danger' : 'btn-primary'}`}
            disabled={route.isPending || !mode}
            onClick={submit}
          >
            {route.isPending ? 'Working…' : cta}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {isLoading ? <p className="sm muted" style={{ margin: 0 }}>Loading…</p> : (
          <>
            {properties.length > 0 && (
              <div className="col gap-2">
                <span className="eq-head">
                  <Building2 size={13} /> {properties.length === 1
                    ? 'The property they sent'
                    : `${properties.length} properties — tick the ones to take forward`}
                </span>

                {properties.map((p, i) => (
                  <label key={p._id || i} className={`eq-prop${chosen.has(i) ? ' active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={chosen.has(i)}
                      onChange={() => setPicked(toggleIn(chosen, i))}
                    />
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
            )}

            {enquiry?.phone && (
              <a className="eq-call" href={`tel:${enquiry.phone}`}><Phone size={12} /> {enquiry.phone}</a>
            )}

            {/* THE question. Same two roads, same words, as a property already
                on a project is asked — see AssessmentPicker. */}
            <p className="sm" style={{ margin: 0 }}>
              What happens next to {chosen.size > 1 ? 'these properties' : 'this property'}?
            </p>
            {/* THE SAME THREE ROADS A CAPTURED PROPERTY GETS. A submission
                used to be offered only two, so a site somebody was sure of
                could not be sent straight to games and dates just because it
                arrived through the franchise link rather than our own team. */}
            <RoadChoice
              mode={mode === 'reject' ? null : mode}
              onChange={setMode}
              allowProject
              assessHint="Filed at Phase 1 and shortlisted, with the forms you pick below."
              skipHint="The site is decided — filed as the chosen site, project opens at commercial closure."
              projectHint="Plan the games and the opening date now. The six documents open as drafts at the same time — closure runs alongside, it is not skipped."
            />

            {mode === 'assess' && (
              <AssessmentPicker
                picked={types}
                onToggle={(k) => setTypes(toggleIn(types, k))}
                onToggleAll={() => setTypes(types.size === 4 ? new Set() : allAssessmentKeys())}
              />
            )}

            {mode === 'skip' && (
              <p className="eq-road">
                <Check size={12} />
                Nothing is assessed. The LOI, lease, legal check, deposit, NOCs and approvals open
                on it straight away — pick assessment instead if any of the four still needs answering.
              </p>
            )}

            {/* Third and quieter: real, but not the common answer. */}
            <button
              type="button"
              className={`eq-reject${mode === 'reject' ? ' active' : ''}`}
              onClick={() => setMode(mode === 'reject' ? null : 'reject')}
            >
              <ThumbsDown size={13} /> Not for us — decline this submission
            </button>

            {mode === 'reject' && (
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
