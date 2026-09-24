import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from './primitives.jsx';
import { PhaseBrief } from './PhaseBrief.jsx';
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
  const stages = project?.stages || [];
  const index = stages.findIndex((s) => s.key === stageKey);
  const total = stages.length || STAGES_CONFIG.length;
  const stage = stages.find((s) => s.key === stageKey);

  const text = description || stage?.description || fallback;

  // The four management questions for this phase, if the project's template
  // carries them. Collapsed by default: the explainer's job is a one-line
  // signpost, and a four-column table opening above every phase page would
  // push the actual work below the fold. One click, and it is the client's
  // What/Who/When/How table verbatim.
  const [briefOpen, setBriefOpen] = useState(false);
  const hasBrief = Boolean(stage?.whatWhoWhenHow?.length);

  /* Used to bail here when the phase carried no description. The nav is
     useful on exactly those phases too, so only the TEXT is conditional. */
  const bare = !text && !todo && !hasBrief;

  return (
    <div className={`stage-explain${bare ? ' is-bare' : ''}`}>
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

        {hasBrief && (
          <>
            <button
              type="button"
              className="stage-explain-brieftoggle"
              onClick={() => setBriefOpen((v) => !v)}
              aria-expanded={briefOpen}
            >
              {briefOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
              What, who, when &amp; how for this phase
            </button>
            {briefOpen && (
              <div style={{ marginTop: 10 }}>
                <PhaseBrief stage={stage} />
              </div>
            )}
          </>
        )}
      </div>
      {complete && <Badge color="var(--success)" soft="var(--success-soft)" dot>Complete</Badge>}
    </div>
  );
}

export default StageExplainer;
