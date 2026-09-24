import { useNavigate, useParams } from 'react-router-dom';
import { Check, Lock } from 'lucide-react';
import { getStageAccess, getStagePath, projectPhases } from './stagesConfig.jsx';

/**
 * Horizontal end-to-end phase stepper — the project's real lifecycle, read
 * from its own `stages[]`, so it never drifts from what the Sidebar shows and
 * follows a 10-phase or a 17-phase template equally.
 * Reuses `getStageAccess` for per-step state (completed/current/accessible/
 * locked) rather than re-deriving it. Every phase is reachable except Site
 * Evaluation (p2), which stays locked until Property Identification (p1) is
 * Marked Done — see stagesConfig.jsx#getStageAccess.
 */
export function PhaseWorkflowProgress({ project }) {
  const { id } = useParams();
  const navigate = useNavigate();
  if (!project?.stages) return null;

  // The project's own phases, same source as the sidebar — a hardcoded
  // STAGES_CONFIG here showed ten steps with the old names regardless of which
  // template the project actually runs.
  const phases = projectPhases(project);

  return (
    <div className="se-phase-stepper">
      {phases.map((stage, i) => {
        const access = getStageAccess(project.stages, stage.key);
        const locked = access === 'locked';
        return (
          <div key={stage.key} className="se-phase-step-wrap">
            <button
              type="button"
              className={`se-phase-step se-phase-step--${access}`}
              onClick={() => !locked && navigate(getStagePath(id, stage.key))}
              disabled={locked}
              title={locked ? `${stage.name} — locked until Property Identification is Marked Done` : stage.name}
            >
              <span className="se-phase-step-dot">
                {access === 'completed' ? <Check size={13} /> : locked ? <Lock size={12} /> : i + 1}
              </span>
              <span className="se-phase-step-label">{stage.name}</span>
            </button>
            {i < phases.length - 1 && <span className={`se-phase-step-connector se-phase-step-connector--${access}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default PhaseWorkflowProgress;
