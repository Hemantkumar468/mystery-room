import { Navigate, useParams } from 'react-router-dom';
import { useProject } from '../../lib/queries.js';

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
 * A stage is only ever "locked" when it's genuinely ahead of the project's
 * current stage and hasn't been touched yet — the current stage itself is
 * always accessible even before its own status flips off `not_started`
 * (e.g. a fresh phase with no tasks/records logged yet).
 */
export function getStageAccess(stages, stageKey) {
  const stage = stages?.find((s) => s.key === stageKey);
  if (!stage) return 'accessible';
  if (stage.status === 'completed') return 'completed';
  const currentKey = effectiveCurrentKey(stages);
  if (stage.key === currentKey) return 'current';
  if (stage.status === 'not_started') {
    const current = stages.find((s) => s.key === currentKey);
    if (current && stage.order > current.order) return 'locked';
  }
  return 'accessible';
}

/**
 * Route guard for a project phase page — redirects back to the project
 * overview if the requested stage isn't reachable yet. Nested sub-routes
 * (e.g. a single site-evaluation property) rely on their guarded parent
 * page being the only way to reach them in normal use, so only the 10
 * top-level phase routes need wrapping.
 */
export function PhaseRouteGuard({ stageKey, children }) {
  const { id } = useParams();
  const { data: project, isLoading } = useProject(id);

  if (isLoading || !project) return children;

  const access = getStageAccess(project.stages, stageKey);
  if (access === 'locked') {
    return <Navigate to={`/projects/${id}`} replace />;
  }
  return children;
}
