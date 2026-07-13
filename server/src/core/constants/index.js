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

/**
 * How a stage captures data.
 *  - `single`: one master-data record per project (stored on `Project.masterData`).
 *  - `collection`: many `Record` rows (e.g. the candidate properties in Phase 1),
 *    each with its own values, attachments and shortlist/reject decision.
 */
export const STAGE_CAPTURE_MODE = Object.freeze({
  SINGLE: 'single',
  COLLECTION: 'collection',
});

export const STAGE_CAPTURE_MODE_VALUES = Object.values(STAGE_CAPTURE_MODE);

/**
 * Lifecycle of a collection-stage `Record` (a candidate property in Phase 1).
 * `approved`/`locked` belong to later phases (Site Evaluation, Commercial
 * Finalization) — defined now so the gate is forward-compatible.
 */
export const RECORD_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  SHORTLISTED: 'shortlisted',
  REJECTED: 'rejected',
  APPROVED: 'approved',
  LOCKED: 'locked',
});

export const RECORD_STATUS_VALUES = Object.values(RECORD_STATUS);

/** Decisions a manager can take on a record, mapped to the status they set. */
export const RECORD_DECISION = Object.freeze({
  shortlist: RECORD_STATUS.SHORTLISTED,
  reject: RECORD_STATUS.REJECTED,
  approve: RECORD_STATUS.APPROVED,
  lock: RECORD_STATUS.LOCKED,
});

export const RECORD_DECISION_VALUES = Object.keys(RECORD_DECISION);

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
});

export const ACTIVITY_ACTIONS = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  STATUS_CHANGED: 'status_changed',
  ASSIGNED: 'assigned',
  COMPLETED: 'completed',
  COMMENTED: 'commented',
  DELETED: 'deleted',
});

/** Cities where Mystery Rooms currently operates or is expanding. */
export const MR_CITIES = Object.freeze([
  'Delhi', 'Mumbai', 'Noida', 'Gurgaon', 'Pune', 'Bangalore', 'Chennai',
  'Hyderabad', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Ludhiana', 'Chandigarh',
  'Lucknow', 'Visakhapatnam',
]);
