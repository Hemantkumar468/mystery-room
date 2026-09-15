import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { FMS_PHASES } from '../propertyFmsUi.js';

/**
 * The six-node progress ladder every Property FMS page repeats, so a reader
 * always knows where the current page sits in the funnel and can jump to any
 * other phase in one click — completed phases are clickable (already real
 * data to look at), the current one is not (you're on it), and phases still
 * ahead are shown but not linked, since there is nothing there yet.
 */
export function PhaseStepper({ activeKey }) {
  const navigate = useNavigate();
  const activeOrder = FMS_PHASES.find((p) => p.key === activeKey)?.order ?? 1;

  return (
    <div className="fms-stepper">
      {FMS_PHASES.map((phase, i) => {
        const state = phase.order < activeOrder ? 'done' : phase.order === activeOrder ? 'active' : 'upcoming';
        const clickable = state === 'done';
        return (
          <div className="fms-step" key={phase.key}>
            <button
              type="button"
              className={`fms-step-node fms-step-node--${state}`}
              onClick={clickable ? () => navigate(phase.path) : undefined}
              disabled={!clickable}
              title={phase.label}
            >
              {state === 'done' ? <Check size={16} strokeWidth={3} /> : phase.order}
            </button>
            <div className="fms-step-label">
              <span className={`fms-step-name fms-step-name--${state}`}>{phase.label}</span>
              <span className="fms-step-sub">{phase.sub}</span>
            </div>
            {i < FMS_PHASES.length - 1 && <span className={`fms-step-line fms-step-line--${state}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default PhaseStepper;
