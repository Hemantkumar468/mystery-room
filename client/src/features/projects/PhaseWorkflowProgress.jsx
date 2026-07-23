import { useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { STAGES_CONFIG, getStageAccess, getStagePath } from './stagesConfig.jsx';

/**
 * Horizontal end-to-end phase stepper — the project's real 10-phase
 * lifecycle (`STAGES_CONFIG`), not an illustrative subset, so it never
 * drifts from what the Sidebar/ProjectDetailPage stepper already show.
 * Reuses `getStageAccess` for per-step state (completed/current/accessible)
 * rather than re-deriving it. Every phase is always reachable.
 */
export function PhaseWorkflowProgress({ project }) {
  const { id } = useParams();
  const navigate = useNavigate();
  if (!project?.stages) return null;

  return (
    <div className="se-phase-stepper">
      {STAGES_CONFIG.map((stage, i) => {
        const access = getStageAccess(project.stages, stage.key);
        return (
          <div key={stage.key} className="se-phase-step-wrap">
            <button
              type="button"
              className={`se-phase-step se-phase-step--${access}`}
              onClick={() => navigate(getStagePath(id, stage.key))}
              title={stage.name}
            >
              <span className="se-phase-step-dot">
                {access === 'completed' ? <Check size={13} /> : i + 1}
              </span>
              <span className="se-phase-step-label">{stage.name}</span>
            </button>
            {i < STAGES_CONFIG.length - 1 && <span className={`se-phase-step-connector se-phase-step-connector--${access}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default PhaseWorkflowProgress;
