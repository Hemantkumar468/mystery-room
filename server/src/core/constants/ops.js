/**
 * Vocabulary for the operations modules — Delegation, Checklist and the shared
 * organisation layer (branches, teams, groups). Kept apart from the PMS
 * constants so neither module's enums can drift into the other's.
 */

/** A branch is the "which office" partition every delegation/checklist list is filtered by. */
export const BRANCH_TYPES = Object.freeze({
  HEADQUARTERS: 'headquarters',
  REGIONAL_OFFICE: 'regional_office',
  OUTLET: 'outlet',
  WAREHOUSE: 'warehouse',
});
export const BRANCH_TYPE_VALUES = Object.values(BRANCH_TYPES);

/** Role a person holds inside one team (independent of their ERP role). */
export const TEAM_ROLES = Object.freeze({
  MEMBER: 'member',
  MANAGER: 'manager',
  ADMIN: 'admin',
});
export const TEAM_ROLE_VALUES = Object.values(TEAM_ROLES);

/* ------------------------------------------------------------------ */
/* Delegation                                                          */
/* ------------------------------------------------------------------ */

export const DELEGATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  DEPENDENT: 'dependent', // pre-start: waiting on another team / approval
  BLOCKED: 'blocked', // mid-execution: blocked by a person, vendor, consultant…
  AWAITING_VERIFICATION: 'awaiting_verification',
  COMPLETED: 'completed',
  SHIFTED: 'shifted', // closed because the deadline moved to another week
});
export const DELEGATION_STATUS_VALUES = Object.values(DELEGATION_STATUS);

/** Statuses that still need work — anything not closed. */
export const DELEGATION_OPEN_STATUSES = Object.freeze([
  DELEGATION_STATUS.PENDING,
  DELEGATION_STATUS.ACCEPTED,
  DELEGATION_STATUS.IN_PROGRESS,
  DELEGATION_STATUS.DEPENDENT,
  DELEGATION_STATUS.BLOCKED,
]);

/** Repeat rules for recurring delegations. */
export const DELEGATION_FREQUENCIES = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  PERIODICALLY: 'periodically', // every N days
  CUSTOM: 'custom', // every N weeks on given weekdays, or every N months on given dates
});
export const DELEGATION_FREQUENCY_VALUES = Object.values(DELEGATION_FREQUENCIES);

export const REMINDER_UNITS = ['minutes', 'hours', 'days'];
export const REMINDER_TRIGGERS = ['before', 'after'];
export const REMINDER_CHANNELS = ['in_app', 'email'];

/** Two same-week due-date revisions per task; a third must move to another week. */
export const MAX_SAME_WEEK_REVISIONS = 2;

/** Overdue escalation matrix, in whole days past due. */
export const ESCALATION_TIERS = Object.freeze({
  REPORTING_MANAGER: { tier: 1, days: 3 },
  DIRECTOR: { tier: 2, days: 7 },
  REVIEW_MEETING: { tier: 3, days: 15 },
});

export const FOLLOWUP_CALL_STATUS = ['connected', 'not_connected'];

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

export const CHECKLIST_FREQUENCIES = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
  FORTNIGHTLY: 'fortnightly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly',
});
export const CHECKLIST_FREQUENCY_VALUES = Object.values(CHECKLIST_FREQUENCIES);

export const CHECKLIST_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  NON_FUNCTIONAL: 'non_functional', // occurrence could not apply (outlet shut, room down)
});
export const CHECKLIST_STATUS_VALUES = Object.values(CHECKLIST_STATUS);

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/** Two append-only remark channels carried by delegation and checklist rows. */
export const REMARK_CHANNELS = Object.freeze({
  MANAGEMENT: 'management', // a chase from management — bumps the follow-up counter
  COORDINATOR: 'coordinator', // informational note from the operations coordinator
});

export const NOTIFICATION_MODULES = ['delegation', 'checklist', 'org', 'system'];

/** Access levels the ops modules reason about, derived from the ERP role. */
export const ACCESS = Object.freeze({
  ADMIN: 'admin', // everything, every branch
  LEAD: 'lead', // own work + direct reports + teams they manage + own department
  MEMBER: 'member', // own work only
  VIEWER: 'viewer', // read-only
});
