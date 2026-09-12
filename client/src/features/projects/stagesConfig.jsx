
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

/**
 * Display names for the client-flow phases that are NOT in STAGES_CONFIG
 * (that list is the legacy 10-phase nav and carries the routes). Without
 * this, cross-project screens — the Approvals queue above all — labelled a
 * submitted drawing "p11", which reads as noise and made real submissions
 * unrecognisable in the MD's queue. Mirrors the names in
 * server/src/seed/clientFlowTemplate.js.
 */
export const PHASE_DISPLAY_NAMES = {
  p11: 'Design & Drawings',
  p12: 'Vendor & Contractor Panel',
  p13: 'BOQ & Budget',
  p21: 'Contracts & Work Orders',
  p15: 'Purchase Orders & Delivery',
  p16: 'Quality Check',
  p18: 'Assembly & Installation',
  p19: 'Testing & Trial Run',
  p20: 'Project Planning & Games',
  p22: 'HR Hiring & Training',
};

/** One name for any stage key, wherever it appears outside its project. */
export const stageDisplayName = (key) => (
  STAGES_CONFIG.find((s) => s.key === key)?.name || PHASE_DISPLAY_NAMES[key] || key
);

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
 * The address of one TASK: its phase page, focused on the task.
 *
 * `?form=` names the module to open and `?task=` the task code to highlight —
 * the pair `useTaskFocus` reads (components/ui/TaskFocusBanner.jsx). Built here
 * rather than at each call site so the tree, the task brief and anything added
 * later cannot drift into three slightly different query strings; TaskBrief
 * passes the form key it infers, the tree passes the one on the task.
 *
 * A plain phase link is just this with neither part — hence the `?` only when
 * there is something to put after it.
 */
export function getTaskPath(projectId, stageKey, { formKey, code } = {}) {
  const q = new URLSearchParams({
    ...(formKey ? { form: formKey } : {}),
    ...(code ? { task: code } : {}),
  }).toString();
  return `${getStagePath(projectId, stageKey)}${q ? `?${q}` : ''}`;
}

/**
 * Where a submitted assessment record is READ — its report page, the one with
 * who filled it, when, for which property, and a Download PDF button.
 *
 * Only two phases have such a page today, so this returns null for the rest and
 * the caller keeps pointing at the form. Returning a made-up URL for the others
 * would give a card that looks finished and lands on a 404.
 */
const RECORD_REPORT_PATHS = {
  p3: (projectId, recordId) => `/projects/${projectId}/commercial-finalization/record/${recordId}`,
  p2: (projectId, recordId, parentId) => (parentId
    ? `/projects/${projectId}/site-evaluation/${parentId}/assessment/${recordId}`
    : null),
};

export function getRecordReportPath(projectId, stageKey, record) {
  const make = RECORD_REPORT_PATHS[stageKey];
  if (!make || !record?._id) return null;
  return make(projectId, record._id, record.parentRecordId);
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
 * Where a phase sits, for the progress rail. NOTHING IS EVER LOCKED.
 *
 * This used to return "locked" for Site Evaluation until Property
 * Identification had been explicitly Marked Done — the last sequential lock
 * in the app, and the one rule 4 removed along with the phase gates. Any
 * phase, any task, any state, on day one.
 *
 * "completed" now means every task in the phase is Complete, computed from
 * the tasks rather than read off a stored stage status that no longer
 * exists. Callers still switch on the same three words.
 */
export function getStageAccess(stages, stageKey, tasks = []) {
  const stage = stages?.find((s) => s.key === stageKey);
  if (!stage) return 'accessible';
  const own = tasks.filter((t) => t.stageKey === stageKey);
  if (own.length && own.every((t) => t.status === 'complete')) return 'completed';
  const currentKey = effectiveCurrentKey(stages);
  return stage.key === currentKey ? 'current' : 'accessible';
}
