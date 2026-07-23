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

/** Statuses where the assignee's own work is finished — both Waiting Approval
 * tiers and Approved all count (Rejected doesn't — it explicitly needs more
 * work). Mirrors WORK_DONE_STATUSES in server/.../project.service.js. */
export const TASK_WORK_DONE_STATUSES = ['done', 'waiting_approval', 'waiting_management_approval', 'approved'];

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
