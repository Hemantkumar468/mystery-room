import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useRouteProperty, ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { RoadChoice, AssessmentPicker, toggleIn, allAssessmentKeys } from './AssessmentPicker.jsx';

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
export function PropertyRouteModal({ row, onClose, onDone, allowProject = false }) {
  const route = useRouteProperty();
  const already = new Set((row.assessments || []).map((a) => a.type));

  const [mode, setMode] = useState(null); // 'assess' | 'skip' | 'project'
  const [picked, setPicked] = useState(() => new Set(already.size ? already : ASSESSMENTS.map((a) => a.key)));
  const [error, setError] = useState(null);

  const confirm = async () => {
    setError(null);
    if (!mode) { setError('Choose whether this property needs assessing.'); return; }
    if (mode === 'assess' && picked.size === 0) { setError('Pick at least one assessment.'); return; }
    try {
      const result = await route.mutateAsync(
        mode === 'assess'
          ? { recordId: row.recordId, road: 'assessment', assessments: [...picked] }
          : { recordId: row.recordId, road: mode === 'project' ? 'project' : 'commercial' },
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
            {route.isPending ? 'Working…'
              : mode === 'project' ? 'Send to project'
                : mode === 'skip' ? 'Send to commercial'
                  : 'Open assessments'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        <p className="sm" style={{ margin: 0 }}>
          {allowProject
            ? 'Where does this property start?'
            : 'Does this property need assessing?'}
        </p>

        <RoadChoice mode={mode} onChange={setMode} allowProject={allowProject} />

        {/* Said out loud, because it is the one road whose consequence is not
            obvious from its name. */}
        {mode === 'project' && (
          <p className="tiny muted" style={{ margin: 0 }}>
            The property is approved and appears in Project &amp; Games straight away.
            Commercial still lists it with none of its six documents filed — skipping
            the step does not file the paperwork, it only stops planning waiting on it.
          </p>
        )}

        {mode === 'assess' && (
          <AssessmentPicker
            picked={picked}
            already={already}
            onToggle={(k) => setPicked(toggleIn(picked, k))}
            onToggleAll={() => setPicked(picked.size === ASSESSMENTS.length ? new Set() : allAssessmentKeys())}
          />
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
