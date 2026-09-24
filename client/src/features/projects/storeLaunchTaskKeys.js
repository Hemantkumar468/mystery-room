/**
 * Phase 9 (Store Launch) anchor task keys — the small set of named checklist
 * items StoreLaunchPage.jsx's Go-Live gate and Pre-Launch Activities panel
 * look for by `templateTaskKey`. Previously these were only ever set by
 * `materializeFromTemplate()` auto-creating tasks; now that tasks only exist
 * once a real user allocates one (see AllocateTaskModal), the same key list
 * is offered there as an optional "Task Purpose" picker so a manually
 * created task can still identify itself to Store Launch.
 *
 * Lives in its own module (rather than inside StoreLaunchPage.jsx) because
 * DepartmentPlanningPage.jsx's AllocateTaskModal needs it too, and
 * StoreLaunchPage.jsx already imports AllocateTaskModal FROM
 * DepartmentPlanningPage.jsx — importing this list the other way round would
 * be a circular import.
 */

export const GOLIVE_ANCHOR_KEY = 'p9_golive_final';

/** The spec's 6 named Pre-Launch Activities, each mapped to the specific
 * template task key that best represents it. */
export const PRE_LAUNCH_ACTIVITIES = [
  { label: 'Final Staff Briefing', templateTaskKey: 'p9_staff_5' },
  { label: 'System Health Check', templateTaskKey: 'p9_it_1' },
  { label: 'POS Testing', templateTaskKey: 'p9_pos_4' },
  { label: 'Inventory Validation', templateTaskKey: 'p9_inventory_1' },
  { label: 'Marketing Activation', templateTaskKey: 'p9_marketing_1' },
  { label: 'Safety Inspection', templateTaskKey: 'p9_operations_3' },
];

/** Flat {key,label} options for the Allocate Task modal's Task Purpose picker. */
export const P9_TASK_PURPOSE_OPTIONS = [
  { key: GOLIVE_ANCHOR_KEY, label: 'Final Go-Live Approval' },
  ...PRE_LAUNCH_ACTIVITIES.map((a) => ({ key: a.templateTaskKey, label: a.label })),
];
