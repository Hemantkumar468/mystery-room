/**
 * Presentation maps mirroring the server's domain enums — one place that turns
 * a raw status string into a label + color so badges read consistently.
 */
import { ROLES, can } from './roles.js';

/* Three states, set by a person. Neutral / amber / green — nothing here
   means "late": red is a date, see isPastDue in features/projects/
   phaseProgress.js. */
export const TASK_STATUS_META = {
  pending:    { label: 'Pending',    color: '#6B7280', soft: '#F3F4F6' },
  processing: { label: 'Processing', color: '#9A5B06', soft: '#FDF4E6' },
  complete:   { label: 'Complete',   color: '#12724D', soft: '#EAF7F0' },
};

/* Sign-off, on its own axis — shown beside the state, never instead of it. */
export const TASK_APPROVAL_META = {
  none:               { label: 'Not submitted',      color: '#6B7280', soft: '#F3F4F6' },
  waiting_department: { label: 'Waiting Approval',   color: '#7C3AED', soft: '#EDE9FE' },
  waiting_management: { label: 'Management Approval', color: '#2563EB', soft: '#DBEAFE' },
  approved:           { label: 'Approved',           color: '#0D9488', soft: '#CCFBF1' },
  rejected:           { label: 'Rejected',           color: '#E11D48', soft: '#FFE4E6' },
};

export const PROJECT_STATUS_META = {
  // A saved-but-not-yet-created project — no template/stages/tasks exist
  // for it yet (see server project.service.js#createDraft/publishDraft).
  draft:     { label: 'Draft',     color: '#6B7280', soft: '#F3F4F6' },
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

/** Shared active/inactive status badge for EMS master-data entities —
 * Branch today, Vendor and ExpenseCategory reuse this unchanged in Steps
 * 2.2/2.3 rather than each defining their own copy of the same two values
 * (see docs/EMS-ARCHITECTURE.md Section 3, all three share this lifecycle). */
export const MASTER_DATA_STATUS_META = {
  active:   { label: 'Active',   color: '#059669', soft: '#DCFCE7' },
  inactive: { label: 'Inactive', color: '#6B7280', soft: '#F3F4F6' },
};

/* A phase wears its tasks' colours, because its progress IS its tasks'
   progress. Kept under the old name so existing imports keep working. */
export const STAGE_STATUS_META = TASK_STATUS_META;

/* Where a phase sits in the project's life — not how far along it is. */
export const STAGE_LIFECYCLE_META = {
  active:   { label: 'Active',   color: '#6B7280', soft: '#F3F4F6' },
  live:     { label: 'Live',     color: '#12724D', soft: '#EAF7F0' },
  archived: { label: 'Archived', color: '#7C3AED', soft: '#EDE9FE' },
};

export const PRIORITY_META = {
  low:      { label: 'Low',      color: '#6B7280', soft: '#F3F4F6' },
  medium:   { label: 'Medium',   color: '#2563EB', soft: '#DBEAFE' },
  high:     { label: 'High',     color: '#D97706', soft: '#FEF3C7' },
  critical: { label: 'Critical', color: '#DC2626', soft: '#FEE2E2' },
};

export const ROLE_META = {
  md:       { label: 'Managing Director',   color: '#DC2626', hint: 'Full control, including deleting projects and managing users' },
  ea:       { label: 'Executive Assistant', color: '#7C3AED', hint: 'Acts for the MD — manages and approves anything, cannot delete or manage users' },
  manager:  { label: 'Manager',             color: '#D97706', hint: 'Owns projects, assigns work, approves within their department' },
  employee: { label: 'Employee',            color: '#059669', hint: 'Captures records and completes assigned tasks' },
  viewer:   { label: 'Viewer',              color: '#6B7280', hint: 'Read-only dashboards and MIS' },
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

export const TASK_STATUS_ORDER = ['pending', 'processing', 'complete'];

/** ALL THREE are selectable: a person sets the state, and any state may follow
 * any state. There is no longer a subset that is "reachable only through the
 * pipeline" — sign-off moved to its own axis, `Task.approvalState`. */
export const TASK_STATUS_SELECTABLE = TASK_STATUS_ORDER;

/**
 * EVERY MOVE IS LEGAL. Any state may follow any state, on any task, on day one
 * — so this is no longer a gate, only the list of the OTHER two states, which
 * is what a "move to" control wants to offer.
 *
 * It kept its name and shape because two screens read it. What it must never
 * become again is a table with empty arrays in it: the old one keyed every row
 * on a status that no longer exists, so `LEGAL_TASK_TRANSITIONS[task.status]`
 * was undefined everywhere, every drag on the board was silently refused, and
 * the detail page offered no move buttons at all.
 */
export const LEGAL_TASK_TRANSITIONS = Object.freeze(
  Object.fromEntries(TASK_STATUS_ORDER.map((s) => [s, TASK_STATUS_ORDER.filter((x) => x !== s)])),
);

/** True for any move to a DIFFERENT state. Nothing is blocked. */
export const isLegalTaskTransition = (from, to) => from !== to && TASK_STATUS_ORDER.includes(to);

/** Where the work itself is finished. Sign-off is a separate axis now
 * (`Task.approvalState`), so a task awaiting approval is COMPLETE work — it is
 * not a fourth status. */
export const TASK_WORK_DONE_STATUSES = ['complete'];

/**
 * Where a task is, asked once.
 *
 * Two axes since the migration: `status` is what is happening to the work
 * (pending → processing → complete) and `approvalState` is who has signed it.
 * Every screen used to compare these inline against values the fields no
 * longer hold, and each drifted differently. Ask here instead.
 */
export const isTaskDone = (t) => t?.status === 'complete';
export const isTaskOpen = (t) => !isTaskDone(t);
export const isTaskStarted = (t) => t?.status === 'processing';
export const isTaskUnstarted = (t) => t?.status === 'pending';

/** Sign-off, off its own field. `none` for a task nobody has submitted. */
export const approvalOf = (t) => t?.approvalState || 'none';
export const isWaitingDept = (t) => approvalOf(t) === 'waiting_department';
export const isWaitingMgmt = (t) => approvalOf(t) === 'waiting_management';
export const isApprovedTask = (t) => approvalOf(t) === 'approved';
/** With somebody else, either tier — the work has left the assignee's desk. */
export const isAwaitingSignoff = (t) => isWaitingDept(t) || isWaitingMgmt(t);
/** Sent back to be redone. Work, not sign-off, is what resumes. */
export const isReworkTask = (t) => approvalOf(t) === 'rejected';

/**
 * Finished AND cleared. "Executed" on the dashboards used to mean a list of
 * five statuses; it means complete work that nobody has sent back.
 */
export const isTaskExecuted = (t) => isTaskDone(t) && !isReworkTask(t);

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
  /* `dueAt` first, then `plannedEnd` — the same pair endOf() reads in
     taskClock.js. Reading only plannedEnd made every task with a dueAt look
     as though it had no date at all, so nothing was ever delayed. */
  const due = t?.dueAt || t?.plannedEnd;
  if (!due) return false;
  if (TASK_WORK_DONE_STATUSES.includes(t.status)) return false;
  return new Date(due) < new Date();
}

/** Department-scoped approval — mirrors task.service.js's canApprove() exactly:
 * an Admin can decide anything, a Manager only their own department's tasks. */
export function canApprove(user, task) {
  if (!user) return false;
  // MD and EA sign off anywhere; a Manager only inside their own department.
  if (can.actForLeadership(user.role)) return true;
  return Boolean(user.role === ROLES.MANAGER && task.department && user.department === task.department);
}

/** The second, cross-department "Management Approval" tier — mirrors
 * task.service.js's canManagementApprove() exactly: any Manager or Admin,
 * not scoped to a specific department. */
export function canManagementApprove(user) {
  if (!user) return false;
  return can.decide(user.role);
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
  // The MD is exempt, matching the same exemption in task.service.js#decide.
  // Without this the UI disabled the MD's own Approve button while the server
  // would have accepted the call — the two checks must agree or the button is
  // simply broken. The MD is the final authority and is frequently also the
  // person who raised or cleared the earlier tier; with no exemption a
  // single-person action deadlocks the phase with nobody able to clear it.
  if (can.administer(user?.role)) return false;
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
  if (can.manage(user.role)) return true;
  const isAssignee = task.assignee && String(task.assignee._id || task.assignee) === String(user.id || user._id);
  const emp = user.employeeId;
  const isRosterDoer = Boolean(emp && (
    emp === task.primaryAssignee
    || emp === task.backupAssignee
    || (task.assignees || []).includes(emp)
  ));
  return Boolean(isAssignee || isRosterDoer);
}
