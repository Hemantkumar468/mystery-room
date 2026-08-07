import { Badge } from './primitives.jsx';
import { STAGES_CONFIG } from '../../features/projects/stagesConfig.jsx';

/**
 * The one-line answer to "what is this screen for?", shown above every phase.
 *
 * Phase pages opened straight into counters and tables. Someone arriving from a
 * task assignment — which is most people, most of the time — had no way to work
 * out what "Commercial Finalization" or "Approval Workflow" wanted from them,
 * and the phase names describe mechanisms rather than outcomes.
 *
 * The text is the template's own `stage.description` wherever the project
 * carries one, so it cannot drift from the seed data that defines the phase.
 * `fallback` covers projects created before a description existed.
 *
 * `todo` is the second line: what THIS reader should do next, which the calling
 * page computes from live data and, where it matters, from the reader's role.
 * Keep it one sentence — this is a signpost, not documentation.
 */
export function StageExplainer({
  stageKey, project, description, fallback, todo, complete = false,
}) {
  const index = (project?.stages || []).findIndex((s) => s.key === stageKey);
  const total = (project?.stages || []).length || STAGES_CONFIG.length;

  const text =
    description
    || (project?.stages || []).find((s) => s.key === stageKey)?.description
    || fallback;

  if (!text && !todo) return null;

  return (
    <div className="stage-explain">
      <div className="stage-explain-main">
        <span className="stage-explain-step">
          Step {index >= 0 ? index + 1 : '—'} of {total}
        </span>
        {text && <p className="stage-explain-text">{text}</p>}
        {todo && (
          <p className="stage-explain-text" style={{ marginTop: 6, color: 'var(--text-subtle)' }}>
            {todo}
          </p>
        )}
      </div>
      {complete && <Badge color="var(--success)" soft="var(--success-soft)" dot>Complete</Badge>}
    </div>
  );
}

export default StageExplainer;
