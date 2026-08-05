
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

export function getStagePath(projectId, stageKey) {
  const stage = STAGES_CONFIG.find((s) => s.key === stageKey);
  return stage ? `/projects/${projectId}/${stage.path}` : `/projects/${projectId}`;
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
