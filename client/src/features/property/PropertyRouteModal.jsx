import { useState } from 'react';
import { AlertTriangle, ClipboardCheck, FileSignature } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useRouteProperty, ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';

/**
 * "Do you want to go with assessment?" — the one decision in the client's flow.
 *
 * Two answers, and the second question only exists under the first: Yes opens
 * the Site Evaluation forms you choose (any of the four, All being the common
 * case), No sends the property straight to commercial closure and the LOI.
 *
 * WHY THE CHOICE IS NOT A DROPDOWN. Picking "which assessments" is a
 * multi-select, and the honest default is all four — most properties get the
 * full set and the exceptions are the point of asking. Two large targets with
 * their consequence written underneath beat a select whose options nobody
 * reads, and this is a decision that opens real forms for real people.
 *
 * Re-routing an already-routed property is allowed and is not destructive:
 * the server skips assessments that already exist, so adding Technical later
 * adds Technical and disturbs nothing else.
 */
export function PropertyRouteModal({ row, onClose, onDone }) {
  const route = useRouteProperty();
  const already = new Set((row.assessments || []).map((a) => a.type));

  const [mode, setMode] = useState(null); // 'assess' | 'skip'
  const [picked, setPicked] = useState(() => new Set(already.size ? already : ASSESSMENTS.map((a) => a.key)));
  const [error, setError] = useState(null);

  const toggle = (key) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const allPicked = picked.size === ASSESSMENTS.length;
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(ASSESSMENTS.map((a) => a.key)));

  const confirm = async () => {
    setError(null);
    if (!mode) { setError('Choose whether this property needs assessing.'); return; }
    if (mode === 'assess' && picked.size === 0) { setError('Pick at least one assessment.'); return; }
    try {
      const result = await route.mutateAsync(
        mode === 'skip'
          ? { recordId: row.recordId, skip: true }
          : { recordId: row.recordId, assessments: [...picked] },
      );
      onDone?.(result?.data || result);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not route that property.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row.title}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Property routing'}
      width={560}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={route.isPending || !mode} onClick={confirm}>
            {route.isPending ? 'Working…' : mode === 'skip' ? 'Skip to commercial' : 'Open assessments'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        <p className="sm" style={{ margin: 0 }}>Does this property need assessing?</p>

        <div className="prop-choice">
          <button
            type="button"
            className={`prop-choice-btn${mode === 'assess' ? ' active' : ''}`}
            onClick={() => setMode('assess')}
          >
            <ClipboardCheck size={18} />
            <b>Yes — assess it</b>
            <span className="tiny muted">Opens the Site Evaluation forms you pick below.</span>
          </button>
          <button
            type="button"
            className={`prop-choice-btn${mode === 'skip' ? ' active' : ''}`}
            onClick={() => setMode('skip')}
          >
            <FileSignature size={18} />
            <b>No — go to commercial</b>
            <span className="tiny muted">Straight to legal, commercials and the LOI.</span>
          </button>
        </div>

        {mode === 'assess' && (
          <div className="col gap-2">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase' }}>Which assessments?</span>
              <button type="button" className="prop-link" onClick={toggleAll}>
                {allPicked ? 'Clear all' : 'Select all four'}
              </button>
            </div>
            <div className="prop-assess-grid">
              {ASSESSMENTS.map((a) => {
                const on = picked.has(a.key);
                const exists = already.has(a.key);
                return (
                  <label key={a.key} className={`prop-assess-opt${on ? ' active' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(a.key)} />
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      <b className="sm">{a.label}</b>
                      <span className="tiny muted">{exists ? 'Already open — will be left as it is' : a.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {mode === 'skip' && (
          <p className="tiny muted" style={{ margin: 0 }}>
            The property is shortlisted and moves to commercial closure, where the LOI, lease,
            legal checks and deposits are filed. Nothing is assessed — pick Yes if any of the
            four still needs answering.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default PropertyRouteModal;
