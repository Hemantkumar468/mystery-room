import { useState } from 'react';
import { AlertTriangle, RotateCcw, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useChangePropertyDecision, ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { RoadChoice, AssessmentPicker, toggleIn, allAssessmentKeys } from './AssessmentPicker.jsx';
import { fmtDate } from './propertyUi.jsx';

/**
 * "Actually, no." — changing a decision that was already taken.
 *
 * WHY IT IS A SEPARATE DIALOG. Deciding and re-deciding are different
 * questions. The first asks "which road?"; this one asks "what was decided,
 * and what should it be instead?" — so it opens by SAYING the current answer,
 * who gave it and when, then asks for the new one and the reason it changed.
 *
 * WHY THE REASON IS REQUIRED. A changed decision without a reason is the
 * worst row in the queue: it contradicts what the record already says and
 * nobody can tell which is right. The old decision is never overwritten —
 * both sit in the record's history, in order.
 *
 * THREE ANSWERS, because that is what actually happens:
 *   Shortlist  we are taking it forward after all (and optionally re-routing
 *              it: assessment, commercial closure, or straight to project)
 *   Reject     we are not, after all — with the reason the expansion map needs
 *   Withdraw   the decision was premature; the property goes back to Step 2
 *              and waits for a real answer
 *
 * Work already done is never undone: assessments and closure documents that
 * were filed stay filed, and this says so when there are any.
 */

const STATE_WORD = {
  shortlisted: 'Shortlisted',
  approved: 'Approved (straight to project)',
  rejected: 'Rejected',
  waiting: 'Not decided yet',
};

export function PropertyChangeDecisionModal({ row, onClose, onDone }) {
  const change = useChangePropertyDecision();
  const current = row.decision?.state || 'waiting';
  const already = new Set((row.assessments || []).map((a) => a.type));
  /* Assessments were opened on it but nobody has filed one. Shortlisting
     normally refuses in that state (see propertyCapture.service.js#decide);
     a change overrides it, so it is said here rather than discovered later. */
  const nothingFiled = (row.assessments || []).length > 0
    && !(row.assessments || []).some((a) => a.state === 'filed');

  /* 'shortlist' | 'reject' | 'waiting' — what it should say instead. */
  const [to, setTo] = useState(null);
  const [reason, setReason] = useState('');
  /* Only asked when the new answer is Shortlist: where does it go now? Null
     means "leave the road as it is" — the property keeps whatever was already
     opened on it. */
  const [mode, setMode] = useState(null);
  const [picked, setPicked] = useState(() => new Set(already.size ? already : ASSESSMENTS.map((a) => a.key)));
  const [error, setError] = useState(null);

  const roadOf = () => (mode === 'assess' ? 'assessment' : mode === 'skip' ? 'commercial' : mode === 'project' ? 'project' : undefined);

  const confirm = async () => {
    setError(null);
    if (!to) { setError('Choose what the decision should be instead.'); return; }
    if (reason.trim().length < 3) { setError('Say why it is changing — it is kept beside the old decision.'); return; }
    if (to === 'shortlist' && mode === 'assess' && picked.size === 0) {
      setError('Pick at least one assessment, or choose another road.');
      return;
    }
    try {
      const result = await change.mutateAsync({
        recordId: row.recordId,
        to,
        reason: reason.trim(),
        ...(to === 'shortlist' && roadOf() ? { road: roadOf() } : {}),
        ...(to === 'shortlist' && roadOf() === 'assessment' ? { assessments: [...picked] } : {}),
      });
      onDone?.(result?.data || result);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not change that decision.');
    }
  };

  const choice = (value, icon, label, hint) => (
    <button
      type="button"
      className={`prop-choice-btn${to === value ? ' active' : ''}`}
      onClick={() => { setTo(value); if (value !== 'shortlist') setMode(null); }}
      disabled={value === current || (value === 'shortlist' && current === 'approved')}
      title={value === current ? `It is already ${STATE_WORD[current].toLowerCase()}` : undefined}
    >
      <span className="row gap-2" style={{ alignItems: 'center', fontWeight: 700 }}>{icon} {label}</span>
      <span className="tiny muted">{hint}</span>
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Change this decision'}
      width={560}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={change.isPending || !to} onClick={confirm}>
            {change.isPending ? 'Changing…' : 'Change the decision'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {/* What it says today, before anything is chosen. */}
        <div className="pt-alert">
          <RotateCcw size={14} />
          <span>
            <strong>{STATE_WORD[current] || current}</strong>
            {row.decision?.by ? ` by ${row.decision.by}` : ''}
            {row.decision?.at ? ` on ${fmtDate(row.decision.at)}` : ''}
            {row.decision?.reason ? ` — “${row.decision.reason}”` : ''}
          </span>
        </div>

        <p className="sm" style={{ margin: 0 }}>What should it say instead?</p>

        <div className="prop-choice is-three">
          {choice('shortlist', <ThumbsUp size={14} />, 'Shortlist', 'Take it forward')}
          {choice('reject', <ThumbsDown size={14} />, 'Reject', 'Off the table, with a reason')}
          {choice('waiting', <Undo2 size={14} />, 'Back to waiting', 'Undecided again, in Step 2')}
        </div>

        {to === 'shortlist' && nothingFiled && (
          <div className="pt-alert pt-alert--bad">
            <AlertTriangle size={14} />
            <span>
              None of its assessments have been filed yet. Shortlisting now takes the property
              forward anyway — the override and your reason go on the record.
            </span>
          </div>
        )}

        {to === 'shortlist' && (
          <>
            <p className="sm" style={{ margin: 0 }}>
              Where does it go? Leave this alone to keep whatever is already open on it.
            </p>
            <RoadChoice mode={mode} onChange={setMode} allowProject />
            {mode === 'assess' && (
              <AssessmentPicker
                picked={picked}
                already={already}
                onToggle={(k) => setPicked(toggleIn(picked, k))}
                onToggleAll={() => setPicked(picked.size === ASSESSMENTS.length ? new Set() : allAssessmentKeys())}
              />
            )}
          </>
        )}

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="label">Why is it changing?</span>
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={to === 'reject'
              ? 'e.g. Landlord raised the rent to ₹4.2L after the visit.'
              : to === 'waiting'
                ? 'e.g. Decided before the photos came in — waiting for the frontage shots.'
                : 'e.g. Rent renegotiated to ₹3L; this is the best site on the street.'}
          />
        </label>

        {/* Said plainly, because it is the question anyone changing a decision
            asks next: does the work already done disappear? It does not. */}
        <p className="tiny muted" style={{ margin: 0 }}>
          Nothing filed is deleted — assessments and closure documents already answered stay on the
          property, and both decisions stay in its history.
        </p>
      </div>
    </Modal>
  );
}

export default PropertyChangeDecisionModal;
