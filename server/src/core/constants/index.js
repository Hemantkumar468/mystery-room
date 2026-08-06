/**
 * Domain-wide enums and constants. Keep every "magic string" the system
 * branches on here so the client and server can share one vocabulary.
 */

/**
 * The five roles the whole ERP recognises — PMS, EMS, AI and anything added
 * later. This is the single vocabulary; no module defines its own.
 *
 * Named after the actual org, not after software conventions: the person at
 * the top is the MD, and the person who runs their desk is the EA. Calling
 * them "admin" and "superuser" forced everyone to translate.
 */
export const ROLES = Object.freeze({
  MD: 'md',             // Managing Director — full control, including destructive
  EA: 'ea',             // Executive Assistant — the MD's proxy, minus destructive
  MANAGER: 'manager',   // owns projects, assigns work, approves
  EMPLOYEE: 'employee', // the doer — captures records, completes tasks
  VIEWER: 'viewer',     // read-only dashboards/MIS; never writes
});

export const ROLE_VALUES = Object.values(ROLES);

/** Display labels. The client mirrors these in `lib/ui.js`. */
export const ROLE_LABELS = Object.freeze({
  [ROLES.MD]: 'Managing Director',
  [ROLES.EA]: 'Executive Assistant',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.EMPLOYEE]: 'Employee',
  [ROLES.VIEWER]: 'Viewer',
});

/**
 * Capability sets — the only thing routes and services should branch on.
 *
 * Guards used to spell out role lists inline (`authorize(ADMIN, MANAGER)`),
 * which meant adding a role required finding and editing every call site, and
 * a missed one is a silent privilege hole. Adding a role is now a change to
 * these three arrays and nothing else.
 *
 * The tiers are cumulative in practice but declared explicitly, because
 * "everyone above X" is an assumption that stops being true the moment a
 * narrow role is added.
 */

/** Irreversible or account-level: deleting a project, managing users. MD only. */
export const CAN_ADMINISTER = Object.freeze([ROLES.MD]);

/**
 * The MD's desk. Not a permission tier of its own — it answers "who sees and
 * acts on behalf of the top of the company", which is a different question
 * from "who may approve".
 *
 * Two things read it: cross-department approval (a Manager is scoped to their
 * own department, these two are not), and the notification fan-out that used
 * to go to every admin.
 */
export const LEADERSHIP = Object.freeze([ROLES.MD, ROLES.EA]);

/**
 * Create and run work: projects, stage completion, approve/reject decisions.
 * EA sits here — the MD's proxy for everything that is not destructive.
 */
export const CAN_MANAGE = Object.freeze([ROLES.MD, ROLES.EA, ROLES.MANAGER]);

/** Capture and edit the work itself: records, tasks, checklists. */
export const CAN_CAPTURE = Object.freeze([ROLES.MD, ROLES.EA, ROLES.MANAGER, ROLES.EMPLOYEE]);

/** Approve or reject a submitted record/task. Same tier as CAN_MANAGE today,
 *  named separately so sign-off can be narrowed later without touching
 *  project-creation permissions. */
export const CAN_DECIDE = CAN_MANAGE;

export const can = {
  administer: (role) => CAN_ADMINISTER.includes(role),
  manage: (role) => CAN_MANAGE.includes(role),
  capture: (role) => CAN_CAPTURE.includes(role),
  decide: (role) => CAN_DECIDE.includes(role),
  /** Acts for the top of the company — approves outside any one department. */
  actForLeadership: (role) => LEADERSHIP.includes(role),
};

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
  // A project the creator hasn't finished/committed yet — saved via "Save
  // Draft" in the Create Project modal. Never materializes a template
  // (no stages/tasks/notifications) until promoted via POST /:id/publish,
  // which moves it to PLANNING like a normal creation. See
  // project.service.js#create/update/publishDraft.
  DRAFT: 'draft',
  PLANNING: 'planning',
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  // Terminal state set only by Phase 9's Launch Store flow
  // (project.service.js#completeStage's `p9` branch) — a one-way door, never
  // reverted by reopening the p9 stage. See recompute()'s TERMINAL_STATUSES
  // guard, which must never silently overwrite this back to COMPLETED.
  STORE_LIVE: 'store_live',
  // The final terminal state, set only by Phase 10's Archive Project flow
  // (project.service.js#archiveProject). Reached from STORE_LIVE once every
  // closure gate has cleared; the whole project becomes read-only afterwards.
  // Like STORE_LIVE this is a one-way door — recompute() must never overwrite it.
  ARCHIVED: 'archived',
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
  // Approval pipeline (Phase 6 Execution) — only reachable via the dedicated
  // submit-approval/decision endpoints, never the generic PATCH. See
  // task.service.js's `update()` guard and `TASK_STATUS_SELECTABLE` below.
  WAITING_APPROVAL: 'waiting_approval',
  // Second, cross-department tier — a task lands here once its own
  // department manager has cleared it (Phase 7's review queue), before it
  // can become fully APPROVED. See task.service.js's decide().
  WAITING_MANAGEMENT_APPROVAL: 'waiting_management_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const TASK_STATUS_VALUES = Object.values(TASK_STATUS);

/**
 * The subset of statuses settable through the generic PATCH /:id (Edit Task's
 * Status dropdown). `waiting_approval`/`approved`/`rejected` only change via
 * submit-approval/decision; `review` is legacy (old data keeps it valid, but
 * it's no longer offered as a new choice).
 */
export const TASK_STATUS_SELECTABLE = Object.freeze([
  TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.BLOCKED, TASK_STATUS.DONE,
]);

/** Human-readable status labels — mirror client/src/lib/ui.js for activity logs.
 * TODO/DONE are relabeled (Assigned/Completed) to read correctly under the
 * approval workflow — DB values are unchanged, same trick as RECORD_STATUS's
 * SUBMITTED → "Under Review". */
export const TASK_STATUS_LABELS = Object.freeze({
  [TASK_STATUS.TODO]: 'Assigned',
  [TASK_STATUS.IN_PROGRESS]: 'In Progress',
  [TASK_STATUS.BLOCKED]: 'Blocked',
  [TASK_STATUS.REVIEW]: 'In Review',
  [TASK_STATUS.DONE]: 'Completed',
  [TASK_STATUS.WAITING_APPROVAL]: 'Waiting Approval',
  [TASK_STATUS.WAITING_MANAGEMENT_APPROVAL]: 'Management Approval',
  [TASK_STATUS.APPROVED]: 'Approved',
  [TASK_STATUS.REJECTED]: 'Rejected',
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
  DATETIME: 'datetime', // date + time, e.g. Phase 9's launch date/time (countdown target)
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
  SUBMITTED_FOR_APPROVAL: 'submitted_for_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  // Phase 10 closure audit — a project being archived, and the report/export
  // actions the Closure Command Center's audit log has to account for. Exports
  // happen entirely in the browser (see comparison/exportUtils.js), so the
  // client posts them to /closure-audit rather than them being inferrable
  // server-side.
  ARCHIVED: 'archived',
  EXPORTED: 'exported',
});

/**
 * The closure-audit events the client may record via
 * `POST /pms/projects/:id/closure-audit`. Deliberately a closed whitelist —
 * this is the one endpoint that lets a browser write an arbitrary-looking
 * audit line, so the message it produces is built server-side from this map
 * and never from client-supplied text.
 */
export const CLOSURE_AUDIT_EVENTS = Object.freeze({
  export_pdf: 'exported the closure report as PDF',
  export_excel: 'exported the closure report as Excel',
  export_budget: 'exported the Budget Report',
  export_vendor: 'exported the Vendor Performance Report',
  export_department: 'exported the Department Performance Report',
  export_delay: 'exported the Delay Analysis Report',
  export_lessons: 'exported the Lessons Learned Report',
  report_generated: 'generated the Project Closure Report',
  certificate_generated: 'generated the Project Closure Certificate',
});

export const CLOSURE_AUDIT_EVENT_KEYS = Object.keys(CLOSURE_AUDIT_EVENTS);

/**
 * The 9 Store Readiness (Phase 8) checklist categories — a business-facing
 * grouping distinct from `DEPARTMENTS` (which stays the RBAC/approval-scoping
 * axis). Purely a labeling convenience for seed data and the client's
 * category dropdown/cards — `Task.taskCategory` stays free-text on the
 * schema, so this isn't a hard DB constraint.
 */
export const READINESS_CATEGORIES = Object.freeze({
  CONSTRUCTION: 'construction',
  UTILITIES: 'utilities',
  IT_SYSTEMS: 'it_systems',
  HIRING: 'hiring',
  TRAINING: 'training',
  MARKETING: 'marketing',
  TESTING: 'testing',
  INVENTORY: 'inventory',
  COMPLIANCE: 'compliance',
});

export const READINESS_CATEGORY_VALUES = Object.values(READINESS_CATEGORIES);

/**
 * Stages considered "pre-launch" — their Records/Tasks are meant to become
 * a frozen historical record the moment the store goes live (project.status
 * === STORE_LIVE), the same way ARCHIVED freezes the whole project. p9 is
 * excluded (its own tasks are what set STORE_LIVE in the first place, and a
 * reopened p9 is blocked separately — see reopenStage); p10 is excluded
 * because Project Closure's entire job happens strictly AFTER go-live.
 */
export const PRE_LAUNCH_STAGE_KEYS = Object.freeze(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);

/**
 * The 12 Go-Live Checklist (Phase 9) categories — same business-facing,
 * non-DB-constrained grouping convention as `READINESS_CATEGORIES` above.
 * `Task.taskCategory` stays free-text; this just gives seed data and the
 * client's category cards a shared vocabulary.
 */
export const LAUNCH_CATEGORIES = Object.freeze({
  OPERATIONS: 'operations',
  IT: 'it',
  POS: 'pos',
  INTERNET: 'internet',
  POWER_BACKUP: 'power_backup',
  STAFF: 'staff',
  SECURITY: 'security',
  EMERGENCY_CONTACTS: 'emergency_contacts',
  INVENTORY: 'inventory',
  MARKETING: 'marketing',
  LEGAL: 'legal',
  FINANCE: 'finance',
});

export const LAUNCH_CATEGORY_VALUES = Object.values(LAUNCH_CATEGORIES);

/**
 * The 8 Project Closure (Phase 10) modules — the `assessmentType` keys of the
 * p10 stage in storeLaunchTemplate.js. Mirrored here so archiveProject()'s
 * gate can name the specific modules it needs (financial closure, document
 * archive, sign-off) without parsing a template it may not be able to load.
 * The template stays the source of truth for labels and form schemas.
 */
export const CLOSURE_MODULES = Object.freeze({
  BUDGET_ANALYSIS: 'budget_analysis',
  DELAY_ANALYSIS: 'delay_analysis',
  VENDOR_PERFORMANCE: 'vendor_performance',
  FINANCIAL_CLOSURE: 'financial_closure',
  ASSET_HANDOVER: 'asset_handover',
  DOCUMENT_ARCHIVE: 'document_archive',
  LESSONS_LEARNED: 'lessons_learned',
  PROJECT_SIGN_OFF: 'project_sign_off',
});

export const CLOSURE_MODULE_VALUES = Object.values(CLOSURE_MODULES);

/** Cities where Mystery Rooms currently operates or is expanding. */
export const MR_CITIES = Object.freeze([
  'Delhi', 'Mumbai', 'Noida', 'Gurgaon', 'Pune', 'Bangalore', 'Chennai',
  'Hyderabad', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Ludhiana', 'Chandigarh',
  'Lucknow', 'Visakhapatnam', 'Indore',
]);
