/**
 * Domain-wide enums and constants. Keep every "magic string" the system
 * branches on here so the client and server can share one vocabulary.
 */

export const ROLES = Object.freeze({
  ADMIN: 'admin', // full control, config, users
  MANAGER: 'manager', // owns projects, assigns work, approves
  EXECUTOR: 'executor', // "doer" — completes tasks
  VIEWER: 'viewer', // read-only dashboards/MIS
});

export const ROLE_VALUES = Object.values(ROLES);

export const DEPARTMENTS = Object.freeze({
  EXPANSION: 'expansion', // site sourcing, brokers, deals
  LEGAL: 'legal', // contracts, compliance
  PROJECTS: 'projects', // interior / fit-out
  HR: 'hr', // hiring & staffing
  MARKETING: 'marketing', // launch campaigns
  FINANCE: 'finance', // budgets, settlements
  OPERATIONS: 'operations', // go-live & handover
  CONSTRUCTION: 'construction',
  INTERIOR: 'interior',
  PROCUREMENT: 'procurement',
  AUTOMATION: 'automation',
  IT: 'it',
});

export const DEPARTMENT_VALUES = Object.values(DEPARTMENTS);

export const TEMPLATE_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
});

export const PROJECT_STATUS = Object.freeze({
  PLANNING: 'planning',
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const PROJECT_HEALTH = Object.freeze({
  ON_TRACK: 'on_track',
  AT_RISK: 'at_risk',
  DELAYED: 'delayed',
});

export const STAGE_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
});

export const TASK_STATUS = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  REVIEW: 'review',
  DONE: 'done',
});

export const TASK_STATUS_VALUES = Object.values(TASK_STATUS);

/** Human-readable status labels — mirror client/src/lib/ui.js for activity logs. */
export const TASK_STATUS_LABELS = Object.freeze({
  [TASK_STATUS.TODO]: 'To Do',
  [TASK_STATUS.IN_PROGRESS]: 'In Progress',
  [TASK_STATUS.BLOCKED]: 'Blocked',
  [TASK_STATUS.REVIEW]: 'In Review',
  [TASK_STATUS.DONE]: 'Done',
});

export const PRIORITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const PRIORITY_VALUES = Object.values(PRIORITY);

/** Field types a template designer can add to a stage's master-data schema. */
export const MASTER_DATA_FIELD_TYPES = Object.freeze({
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  CURRENCY: 'currency',
  DATE: 'date',
  BOOLEAN: 'boolean',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  FILE: 'file',
  USER: 'user',
  LOCATION: 'location', // { lat, lng, capturedAt } captured on-site
});

/**
 * How a stage captures its master data:
 *  - single:     one record per project (the original behaviour).
 *  - collection: many Record rows, each a dynamic form instance (Phase 1).
 */
export const STAGE_CAPTURE_MODE = Object.freeze({
  SINGLE: 'single',
  COLLECTION: 'collection',
});

export const STAGE_CAPTURE_MODE_VALUES = Object.values(STAGE_CAPTURE_MODE);

/**
 * Lifecycle of a collection-mode Record (e.g. a candidate property). `SUBMITTED`
 * displays as "Under Review" (see RECORD_STATUS_META in recordUi.js) — the DB
 * value is kept as-is to avoid a data migration and a rename across every
 * phase page's status comparisons; only the label changed.
 */
export const RECORD_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  SHORTLISTED: 'shortlisted',
  EVALUATION_IN_PROGRESS: 'evaluation_in_progress',
  REJECTED: 'rejected',
  APPROVED: 'approved', // reserved for p2/p3
  ARCHIVED: 'archived',
  LOCKED: 'locked', // reserved for p2/p3
});

export const RECORD_STATUS_VALUES = Object.values(RECORD_STATUS);

export const ACTIVITY_ACTIONS = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  STATUS_CHANGED: 'status_changed',
  ASSIGNED: 'assigned',
  COMPLETED: 'completed',
  COMMENTED: 'commented',
  DELETED: 'deleted',
  VIEWED: 'viewed', // e.g. a doer opening a record's workspace for the first time
});

/** Cities where Mystery Rooms currently operates or is expanding. */
export const MR_CITIES = Object.freeze([
  'Delhi', 'Mumbai', 'Noida', 'Gurgaon', 'Pune', 'Bangalore', 'Chennai',
  'Hyderabad', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Ludhiana', 'Chandigarh',
  'Lucknow', 'Visakhapatnam', 'Indore',
]);
