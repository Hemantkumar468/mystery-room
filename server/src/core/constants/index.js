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
