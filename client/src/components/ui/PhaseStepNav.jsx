import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getStagePath } from '../../features/projects/stagesConfig.jsx';

/**
 * Back and forward through the project's phases, from any phase page.
 *
 * Every phase page was a dead end: the only way from Phase 1 to Phase 2 was
 * back to the project and in again, and the flow is read in order far more
 * often than it is jumped around. Two buttons, sitting in the phase header
 * where the eye already is.
 *
 * ── The order is the PROJECT'S, not this file's ──────────────────────
 * Phases come from the project's own stage snapshot, sorted by `order`, so a
 * project on a 17-phase template steps through seventeen and one on the old
 * ten-phase template steps through ten. Nothing here knows a phase name.
 *
 * `getStagePath` decides where each one lives — the same function the flow
 * board and the task links use — so a phase with a dedicated screen opens
 * that screen and everything else opens the generic phase route. There is no
 * second opinion about a phase's address.
 *
 * Both ends are honest: the first phase has no "previous" and the last has no
 * "next", and rather than a button that does nothing the space simply stays
 * empty, so the pair never lies about where you can go.
 */
export function PhaseStepNav({ project, stageKey, bar = false }) {
  const navigate = useNavigate();

  const stages = [...(project?.stages || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const at = stages.findIndex((s) => s.key === stageKey);
  if (at < 0 || stages.length < 2) return null;

  const prev = at > 0 ? stages[at - 1] : null;
  const next = at < stages.length - 1 ? stages[at + 1] : null;
  if (!prev && !next) return null;

  const go = (s) => navigate(getStagePath(project._id || project.id, s.key));

  /* `bar` is for the phase pages with no shared header of their own — it
     puts the pair on its own line in the same place the header would have
     been, so the control sits where the eye expects it on every phase. */
  return (
    <nav className={`phase-nav${bar ? ' phase-nav--bar' : ''}`} aria-label="Move between phases">
      <Step side="prev" stage={prev} at={at} total={stages.length} onGo={go} />
      <Step side="next" stage={next} at={at + 2} total={stages.length} onGo={go} />
    </nav>
  );
}

/**
 * One arrow.
 *
 * The label drops a leading "Phase 7 — " from the stage name: the number is
 * already in the button's own "7 of 17" line, and repeating it costs the
 * width the actual name needs.
 */
function Step({ side, stage, at, total, onGo }) {
  if (!stage) return <span className="phase-nav-gap" aria-hidden="true" />;
  const name = String(stage.name || stage.key).replace(/^Phase\s+[\w.]+\s*[—–-]\s*/i, '');
  const back = side === 'prev';

  return (
    <button
      type="button"
      className={`phase-nav-btn ${side}`}
      onClick={() => onGo(stage)}
      title={`${back ? 'Back to' : 'On to'} ${stage.name}`}
    >
      {back && <ChevronLeft size={16} aria-hidden="true" />}
      <span className="phase-nav-lab">
        <small>{back ? 'Previous' : 'Next'} · {at} of {total}</small>
        <b>{name}</b>
      </span>
      {!back && <ChevronRight size={16} aria-hidden="true" />}
    </button>
  );
}

export default PhaseStepNav;
