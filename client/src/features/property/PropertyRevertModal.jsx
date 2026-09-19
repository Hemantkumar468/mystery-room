import { useState } from 'react';
import {
  AlertTriangle, ClipboardCheck, FileSignature, Gavel, RotateCcw, Rocket,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useChangePropertyDecision, ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { AssessmentPicker, toggleIn, allAssessmentKeys } from './AssessmentPicker.jsx';
import { fmtDate } from './propertyUi.jsx';

/**
 * Putting a rejected property back into the pipeline.
 *
 * THE QUESTION IS "WHERE DOES IT START AGAIN", NOT "IS IT REJECTED".
 *
 * A rejected site that turns out to be the best one on the street does not go
 * back to the top of the queue — that would re-ask questions somebody has
 * already answered. It picks up somewhere, and which somewhere is the MD's
 * call: a shop turned down before anyone visited it starts at the decision, a
 * shop turned down after four assessments starts at the paperwork. So this
 * dialog asks for a step, in the words the stepper uses, and nothing else.
 *
 * WHERE IT WAS IS THE DEFAULT, NOT THE ANSWER. The step it was standing on
 * when it was rejected is pre-selected, because that is right most of the
 * time and wrong loudly rather than quietly when it is not — the MD sees what
 * is chosen and changes it. Left unstated, every revert would land wherever
 * the code happened to prefer.
 *
 * NOTHING FILED IS THROWN AWAY. Assessments and closure documents already
 * answered stay answered whichever step is chosen; restarting at assessment
 * adds the forms that are missing rather than blanking the ones that are not.
 * See propertyCapture.service.js#changeDecision.
 */

/**
 * The steps a rejected property can be put back on, in flow order.
 *
 * `to`/`road` are what the server is actually told — the same change-decision
 * call Step 2's "Change decision" makes, because reverting IS changing a
 * decision, and a second endpoint that wrote the same two fields is a second
 * place for the transition rules to drift.
 */
const RESTART_STEPS = [
  {
    key: 'md-review',
    n: 2,
    icon: Gavel,
    label: 'MD Review & Decision',
    hint: 'Undecided again — the road gets chosen there',
    body: { to: 'waiting' },
    /* Where a property sits when nothing has been opened on it yet. */
    from: 'capture',
  },
  {
    key: 'assessment',
    n: 3,
    icon: ClipboardCheck,
    label: 'Property Assessment',
    hint: 'The site evaluations open on it again',
    body: { to: 'shortlist', road: 'assessment' },
    from: 'assessment',
  },
  {
    key: 'commercial',
    n: 5,
    icon: FileSignature,
    label: 'Property Commercial',
    hint: 'Straight to the closure documents',
    body: { to: 'shortlist', road: 'commercial' },
    from: 'commercial',
  },
  {
    key: 'planning',
    n: 6,
    icon: Rocket,
    label: 'Project Creation',
    hint: 'Straight to games and the opening date',
    body: { to: 'shortlist', road: 'project' },
    from: null,
  },
];

/** What the queue calls the step a property was standing on when it was rejected. */
const REJECTED_FROM_WORD = {
  capture: 'MD Review & Decision',
  assessment: 'Property Assessment',
  commercial: 'Property Commercial',
};

/** The step to offer first: the one it was rejected from, else the decision. */
const defaultStepFor = (rejectedFrom) => (
  RESTART_STEPS.find((s) => s.from && s.from === rejectedFrom)?.key || 'md-review'
);

export function PropertyRevertModal({ row, onClose, onDone }) {
  const change = useChangePropertyDecision();
  const already = new Set((row.assessments || []).map((a) => a.type));

  const [step, setStep] = useState(() => defaultStepFor(row.rejectedFrom));
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState(() => (
    new Set(already.size ? already : ASSESSMENTS.map((a) => a.key))
  ));
  const [error, setError] = useState(null);

  const chosen = RESTART_STEPS.find((s) => s.key === step);

  const confirm = async () => {
    setError(null);
    if (!chosen) { setError('Choose the step it should start from.'); return; }
    if (reason.trim().length < 3) {
      setError('Say why it is coming back — it is kept beside the rejection.');
      return;
    }
    if (step === 'assessment' && picked.size === 0) {
      setError('Pick at least one assessment, or start it from another step.');
      return;
    }
    try {
      const result = await change.mutateAsync({
        recordId: row.recordId,
        ...chosen.body,
        reason: reason.trim(),
        ...(step === 'assessment' ? { assessments: [...picked] } : {}),
      });
      onDone?.(result?.data || result, chosen);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not put that property back.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title || row.city || 'Rejected property'}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Put this property back in the pipeline'}
      width={580}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={change.isPending || !step}
            onClick={confirm}
          >
            {change.isPending ? 'Putting it back…' : 'Put it back'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {/* WHAT WAS DECIDED, BEFORE ANYTHING IS ASKED. Who said no, when, why,
            and how far the property had got — the four facts anybody needs to
            answer the question below, and all four were a click away on the
            record until now. */}
        <div className="pt-alert">
          <RotateCcw size={14} />
          <span>
            <strong>Rejected</strong>
            {row.decision?.by ? ` by ${row.decision.by}` : ''}
            {row.decision?.at ? ` on ${fmtDate(row.decision.at)}` : ''}
            {row.rejectedFrom && REJECTED_FROM_WORD[row.rejectedFrom]
              ? `, at ${REJECTED_FROM_WORD[row.rejectedFrom]}`
              : ''}
            {row.decision?.reason ? ` — “${row.decision.reason}”` : ''}
          </span>
        </div>

        <p className="sm" style={{ margin: 0 }}>
          Where should it start again?
        </p>

        <div className="prop-restart">
          {RESTART_STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`prop-restart-btn${step === s.key ? ' active' : ''}`}
              onClick={() => setStep(s.key)}
            >
              <span className="prop-restart-num">{s.n}</span>
              <span className="prop-restart-text">
                <span className="prop-restart-title"><s.icon size={13} /> {s.label}</span>
                <span className="tiny muted">{s.hint}</span>
              </span>
              {/* Marked rather than merely pre-selected: "this is where it
                  was" is a fact about the property, and it should still read
                  as one after the MD has clicked somewhere else. */}
              {s.from && s.from === row.rejectedFrom && (
                <span className="prop-restart-tag">Where it stopped</span>
              )}
            </button>
          ))}
        </div>

        {step === 'assessment' && (
          <AssessmentPicker
            picked={picked}
            already={already}
            onToggle={(k) => setPicked(toggleIn(picked, k))}
            onToggleAll={() => setPicked(picked.size === ASSESSMENTS.length ? new Set() : allAssessmentKeys())}
          />
        )}

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="label">Why is it coming back?</span>
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Landlord came back at ₹3L — it is the best frontage on that road."
          />
        </label>

        <p className="tiny muted" style={{ margin: 0 }}>
          Nothing filed is deleted — assessments and closure documents already answered stay on the
          property, and both the rejection and this reversal stay in its history.
        </p>
      </div>
    </Modal>
  );
}

export default PropertyRevertModal;
