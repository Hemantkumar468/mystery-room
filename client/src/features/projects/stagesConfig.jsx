
/**
 * Single source of truth for the 10-phase project lifecycle nav — shared by
 * the Sidebar, ProjectDetailPage's stage stepper, and the route guards below.
 * Keeping one list avoids the sidebar and the project detail page drifting
 * out of sync on phase order/paths.
 */
export const STAGES_CONFIG = [
  { key: 'p1', path: 'property-identification', name: 'Property Identification' },
  { key: 'p2', path: 'site-evaluation', name: 'Site Evaluation' },
  { key: 'p3', path: 'commercial-finalization', name: 'Commercial Finalization' },
  { key: 'p4', path: 'project-creation', name: 'Project Creation' },
  { key: 'p5', path: 'department-planning', name: 'Department Planning' },
  { key: 'p6', path: 'execution', name: 'Execution' },
  { key: 'p7', path: 'approval-workflow', name: 'Approval Workflow' },
  { key: 'p8', path: 'store-readiness', name: 'Store Readiness Checklist' },
  { key: 'p9', path: 'store-launch', name: 'Store Launch' },
  { key: 'p10', path: 'project-closure', name: 'Project Closure' },
];

/**
 * Where a phase opens.
 *
 * The ten phases in STAGES_CONFIG have purpose-built pages. Anything else — the
 * client flow's new phases (p11–p19), or any phase someone adds to a template
 * later — falls back to `?stage=<key>` on the project page, which
 * ProjectDetailPage resolves through its own `openStage`.
 *
 * The fallback used to be a bare `/projects/:id`, which is what made clicking a
 * new phase look like a redirect to Phase 1: the key wasn't in this list, so
 * the link silently dropped it and landed on the project overview. Never return
 * a path that discards the stage the caller asked for.
 */
/**
 * Client-flow phases that earned a purpose-built page of their own. Listed
 * here (not in STAGES_CONFIG, which is the legacy 10-phase nav) so "Open the
 * phase" on a task, the project stepper and every Back fallback agree.
 */
export const DEDICATED_PHASE_PATHS = {
  p15: 'procurement', // Phase 6 — Purchase Orders & Delivery Tracking
};

export function getStagePath(projectId, stageKey) {
  if (DEDICATED_PHASE_PATHS[stageKey]) return `/projects/${projectId}/${DEDICATED_PHASE_PATHS[stageKey]}`;
  const stage = STAGES_CONFIG.find((s) => s.key === stageKey);
  if (stage) return `/projects/${projectId}/${stage.path}`;
  // A real, shareable address — not a modal over the project page. PhasePage
  // renders any template-defined phase at this route.
  return stageKey
    ? `/projects/${projectId}/phase/${encodeURIComponent(stageKey)}`
    : `/projects/${projectId}`;
}

/**
 * The phases to show for a project, in the project's OWN order, with its own
 * names — `project.stages` is the snapshot of the template it was created from,
 * so this follows a 10-phase project and a 17-phase one equally.
 *
 * Falls back to STAGES_CONFIG only when a project hasn't loaded yet, so the
 * sidebar has something to render rather than collapsing.
 */
export function projectPhases(project) {
  const stages = project?.stages;
  if (!stages?.length) return STAGES_CONFIG.map((s) => ({ ...s, label: s.name }));
  return [...stages]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => ({
      key: s.key,
      // The template's own name already carries the client's numbering
      // ("Phase 4B — Vendor Identification"), so it is shown verbatim rather
      // than re-numbered from array position — which is exactly how the old
      // sidebar ended up labelling things "PHASE 4" that were not Phase 4.
      name: s.name,
      color: s.color,
      status: s.status,
    }));
}

/**
 * The project's effective current stage, derived live from `stages[]`
 * rather than trusting `project.currentStageKey` — the backend only
 * advances that field from its task-driven `recompute()` pass, not from
 * the explicit "Mark Done" action (`completeStage`), so it can lag behind
 * a stage that was just manually completed. Same rule the backend itself
 * uses (`recompute()`): the first non-completed stage in order.
 */
export function effectiveCurrentKey(stages) {
  if (!stages?.length) return null;
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  return (sorted.find((s) => s.status !== 'completed') || sorted.at(-1))?.key ?? null;
}

/**
 * Resolves a stage's access state against the project's live stage list.
 * Every phase is reachable once a project exists — there is no general
 * sequential lock; a stage is only ever "completed" or, failing that,
 * "current" / "accessible". The one deliberate exception: Site Evaluation
 * (p2) stays "locked" until Property Identification (p1) is explicitly
 * Marked Done — a property must be shortlisted and the phase closed out
 * before evaluation work can start on it. Every other phase pair is
 * unaffected.
 */
export function getStageAccess(stages, stageKey) {
  const stage = stages?.find((s) => s.key === stageKey);
  if (!stage) return 'accessible';
  if (stage.status === 'completed') return 'completed';
  if (stageKey === 'p2') {
    const p1 = stages?.find((s) => s.key === 'p1');
    if (p1 && p1.status !== 'completed') return 'locked';
  }
  const currentKey = effectiveCurrentKey(stages);
  if (stage.key === currentKey) return 'current';
  return 'accessible';
}
