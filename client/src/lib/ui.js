/**
 * Presentation maps mirroring the server's domain enums — one place that turns
 * a raw status string into a label + color so badges read consistently.
 */

export const TASK_STATUS_META = {
  todo:             { label: 'Assigned',        color: '#6B7280', soft: '#F3F4F6' },
  in_progress:      { label: 'In Progress',     color: '#4F46E5', soft: '#EEF2FF' },
  blocked:          { label: 'Blocked',         color: '#DC2626', soft: '#FEE2E2' },
  review:           { label: 'In Review',       color: '#D97706', soft: '#FEF3C7' },
  done:             { label: 'Completed',       color: '#059669', soft: '#DCFCE7' },
  waiting_approval:            { label: 'Waiting Approval',    color: '#7C3AED', soft: '#EDE9FE' },
  waiting_management_approval: { label: 'Management Approval', color: '#2563EB', soft: '#DBEAFE' },
  approved:                    { label: 'Approved',            color: '#0D9488', soft: '#CCFBF1' },
  rejected:                    { label: 'Rejected',            color: '#E11D48', soft: '#FFE4E6' },
};

export const PROJECT_STATUS_META = {
  planning:  { label: 'Planning',  color: '#2563EB', soft: '#DBEAFE' },
  active:    { label: 'Active',    color: '#D97706', soft: '#FEF3C7' },
  on_hold:   { label: 'On Hold',   color: '#EA580C', soft: '#FFEDD5' },
  completed: { label: 'Completed', color: '#059669', soft: '#DCFCE7' },
  store_live: { label: 'Store Live', color: '#059669', soft: '#DCFCE7' },
  // Set only by Phase 10's Archive Project action — the lifecycle's terminal state.
  archived:  { label: 'Archived',   color: '#7C3AED', soft: '#EDE9FE' },
  cancelled: { label: 'Cancelled', color: '#6B7280', soft: '#F3F4F6' },
};

export const HEALTH_META = {
  on_track: { label: 'On Track', color: '#059669', soft: '#DCFCE7' },
  at_risk:  { label: 'At Risk',  color: '#D97706', soft: '#FEF3C7' },
  delayed:  { label: 'Delayed',  color: '#DC2626', soft: '#FEE2E2' },
};

export const STAGE_STATUS_META = {
  not_started: { label: 'Not Started', color: '#6B7280', soft: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#4F46E5', soft: '#EEF2FF' },
  blocked:     { label: 'Blocked',     color: '#DC2626', soft: '#FEE2E2' },
  completed:   { label: 'Completed',   color: '#059669', soft: '#DCFCE7' },
};

export const PRIORITY_META = {
  low:      { label: 'Low',      color: '#6B7280', soft: '#F3F4F6' },
  medium:   { label: 'Medium',   color: '#2563EB', soft: '#DBEAFE' },
  high:     { label: 'High',     color: '#D97706', soft: '#FEF3C7' },
  critical: { label: 'Critical', color: '#DC2626', soft: '#FEE2E2' },
};

export const ROLE_META = {
  admin:    { label: 'Admin',    color: '#DC2626', hint: 'Full control — config, templates, employees' },
  manager:  { label: 'Manager',  color: '#D97706', hint: 'Owns projects, assigns work, approves stages' },
  executor: { label: 'Executor', color: '#059669', hint: 'Doer — completes assigned tasks' },
  viewer:   { label: 'Viewer',   color: '#6B7280', hint: 'Read-only dashboards and MIS' },
};

export const DEPT_META = {
  expansion:    'Expansion',
  legal:        'Legal',
  projects:     'Projects',
  hr:           'HR',
  marketing:    'Marketing',
  finance:      'Finance',
  operations:   'Operations',
  construction: 'Construction',
  interior:     'Interior',
  procurement:  'Procurement',
  automation:   'Automation',
  it:           'IT',
};

/** Per-department accent colours — one stable hue per department so a
 *  department reads as the same coloured chip everywhere it appears. */
export const DEPT_COLORS = {
  construction: '#D97706', interior: '#EC4899', procurement: '#0EA5E9', automation: '#8B5CF6',
  it:           '#6366F1', marketing: '#F43F5E', hr: '#10B981', finance: '#059669',
  operations:   '#0D9488', legal: '#64748B', projects: '#2563EB', expansion: '#E0A13A',
};

/** Label + colour for a department chip. Falls back gracefully for unknown keys. */
export const deptMeta = (key) => ({
  label: DEPT_META[key] || key || '—',
  color: DEPT_COLORS[key] || '#6B7280',
});

/** Store Readiness (Phase 8) checklist categories — label + a stable accent
 * color per category, same shape as DEPT_META/DEPT_COLORS/deptMeta above but
 * for `Task.taskCategory` values instead of `department`. */
export const READINESS_CATEGORY_META = {
  construction: 'Construction',
  utilities:    'Utilities',
  it_systems:   'IT & Systems',
  hiring:       'Hiring',
  training:     'Training',
  marketing:    'Marketing',
  testing:      'Testing',
  inventory:    'Inventory',
  compliance:   'Compliance',
};

export const READINESS_CATEGORY_COLORS = {
  construction: '#D97706', utilities: '#0EA5E9', it_systems: '#6366F1', hiring: '#10B981',
  training: '#8B5CF6', marketing: '#F43F5E', testing: '#EC4899', inventory: '#059669', compliance: '#DC2626',
};

export const READINESS_CATEGORY_ORDER = [
  'construction', 'utilities', 'it_systems', 'hiring', 'training', 'marketing', 'testing', 'inventory', 'compliance',
];

/** Label + colour for a readiness category chip. Falls back gracefully for unknown keys. */
export const readinessCategoryMeta = (key) => ({
  label: READINESS_CATEGORY_META[key] || key || '—',
  color: READINESS_CATEGORY_COLORS[key] || '#6B7280',
});

/** Go-Live Checklist (Phase 9) categories — same shape as
 * READINESS_CATEGORY_META/_COLORS/_ORDER/readinessCategoryMeta above but for
 * Phase 9's `Task.taskCategory` values. */
export const LAUNCH_CATEGORY_META = {
  operations:         'Operations',
  it:                 'IT',
  pos:                'POS',
  internet:           'Internet',
  power_backup:       'Power Backup',
  staff:              'Staff',
  security:           'Security',
  emergency_contacts: 'Emergency Contacts',
  inventory:          'Inventory',
  marketing:          'Marketing',
  legal:              'Legal',
  finance:            'Finance Ready',
};

export const LAUNCH_CATEGORY_COLORS = {
  operations: '#0D9488', it: '#6366F1', pos: '#8B5CF6', internet: '#0EA5E9', power_backup: '#D97706',
  staff: '#10B981', security: '#DC2626', emergency_contacts: '#F43F5E', inventory: '#059669',
  marketing: '#EC4899', legal: '#64748B', finance: '#2563EB',
};

export const LAUNCH_CATEGORY_ORDER = [
  'operations', 'it', 'pos', 'internet', 'power_backup', 'staff',
  'security', 'emergency_contacts', 'inventory', 'marketing', 'legal', 'finance',
];

/** Label + colour for a launch-checklist category chip. Falls back gracefully for unknown keys. */
export const launchCategoryMeta = (key) => ({
  label: LAUNCH_CATEGORY_META[key] || key || '—',
  color: LAUNCH_CATEGORY_COLORS[key] || '#6B7280',
});

/** Categorical chart ramp — matches --chart-* tokens. */
export const CHART_COLORS = [
  '#e0a13a', '#16a79a', '#6366f1', '#f43f5e', '#38bdf8', '#10b981', '#8b5cf6', '#ec4899',
];

export const TASK_STATUS_ORDER = [
  'todo', 'in_progress', 'blocked', 'review', 'done',
  'waiting_approval', 'waiting_management_approval', 'approved', 'rejected',
];

/** What the manual Status <select> (Edit Task) offers — the approval statuses
 * only ever change via Submit For Approval / Approve / Reject (never a direct
 * pick), and `review` is legacy-only (kept valid for old data, not offered on
 * new choices). Enforced again server-side — this is UI convenience only. */
export const TASK_STATUS_SELECTABLE = ['todo', 'in_progress', 'blocked', 'done'];

/** Mirrors task.service.js's LEGAL_TASK_TRANSITIONS exactly — which direct
 * PATCH /tasks/:id/status moves are ever legal from a given current status.
 * The approval-tier statuses (waiting_approval, waiting_management_approval,
 * approved, rejected) are never a legal direct-PATCH target from anywhere —
 * they're reached only via the approval pipeline (auto-submit on Done /
 * decide()). UI convenience only; the server re-checks this on every write. */
export const LEGAL_TASK_TRANSITIONS = Object.freeze({
  todo: ['in_progress', 'blocked'],
  in_progress: ['todo', 'blocked', 'done'],
  blocked: ['todo', 'in_progress'],
  review: ['in_progress', 'done'],
  done: ['in_progress'],
  rejected: ['in_progress', 'todo'],
  approved: [],
  waiting_approval: [],
  waiting_management_approval: [],
});

/** Whether `from -> to` is ever a legal direct status PATCH — same check
 * task.service.js#update makes server-side. */
export const isLegalTaskTransition = (from, to) => (LEGAL_TASK_TRANSITIONS[from] || []).includes(to);

/** Statuses where the assignee's own work is finished — both Waiting Approval
 * tiers and Approved all count (Rejected doesn't — it explicitly needs more
 * work). Mirrors WORK_DONE_STATUSES in server/.../project.service.js. */
export const TASK_WORK_DONE_STATUSES = ['done', 'waiting_approval', 'waiting_management_approval', 'approved'];

/** `rejected` (legacy) and `rework_required` are the same "back with the
 * assignee, editable" concept — treat them as equivalent everywhere except
 * the literal status badge. */
export const REWORK_STATUSES = ['rejected', 'rework_required'];
export const isReworkStatus = (status) => REWORK_STATUSES.includes(status);

/**
 * "Delayed" is a computed indicator, not a stored status — a task's real
 * workflow state (In Progress, Waiting Approval, …) and its schedule health
 * are orthogonal, so this never lives in `task.status`. True only for tasks
 * still actively being worked (not yet Completed/Approved, and Rejected's
 * lateness is moot until it's resumed) with a due date in the past.
 */
export function isTaskDelayed(t) {
  if (!t?.plannedEnd) return false;
  if (TASK_WORK_DONE_STATUSES.includes(t.status) || t.status === 'rejected') return false;
  return new Date(t.plannedEnd) < new Date();
}

/** Department-scoped approval — mirrors task.service.js's canApprove() exactly:
 * an Admin can decide anything, a Manager only their own department's tasks. */
export function canApprove(user, task) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(user.role === 'manager' && task.department && user.department === task.department);
}

/** The second, cross-department "Management Approval" tier — mirrors
 * task.service.js's canManagementApprove() exactly: any Manager or Admin,
 * not scoped to a specific department. */
export function canManagementApprove(user) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'manager';
}

const idOf = (ref) => (ref ? String(ref._id || ref) : null);

/**
 * Separation of duties — mirrors task.service.js's decide() self-approval
 * guard exactly: nobody may sign off on their own work (the assignee or
 * whoever submitted it for approval), and at the management tier, whoever
 * already cleared the department tier can't also clear this one. Role and
 * department eligibility (canApprove/canManagementApprove) says WHO is
 * allowed to decide a task IN GENERAL; this says whether THIS specific actor
 * is blocked from deciding THIS specific task regardless of role — both
 * checks are needed for the UI to match what the server will actually allow.
 */
export function isOwnTaskWork(user, task, tier) {
  const userId = user && (user.id || user._id) ? String(user.id || user._id) : null;
  if (!userId || !task) return false;
  if (idOf(task.assignee) === userId || idOf(task.submittedForApprovalBy) === userId) return true;
  if (tier === 'management' && idOf(task.approvedBy) === userId) return true;
  return false;
}

/**
 * Who may move a task's work forward — its "doer" (the assigned User, or a
 * login whose employeeId is on the roster) or a manager/admin. Mirrors
 * task.service.js's canChangeStatus() exactly, so the UI disables what the
 * server would reject rather than letting the user click into a 403.
 * Governs status, checklist, dependencies, assignment and scheduling.
 */
export function canWorkOnTask(user, task) {
  if (!user || !task) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  const isAssignee = task.assignee && String(task.assignee._id || task.assignee) === String(user.id || user._id);
  const emp = user.employeeId;
  const isRosterDoer = Boolean(emp && (
    emp === task.primaryAssignee
    || emp === task.backupAssignee
    || (task.assignees || []).includes(emp)
  ));
  return Boolean(isAssignee || isRosterDoer);
}
