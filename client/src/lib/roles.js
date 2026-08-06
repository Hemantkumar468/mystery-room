/**
 * The ERP's five roles and what each may do — the client mirror of
 * `server/src/core/constants/index.js`.
 *
 * These two files must agree. The server is authoritative and re-checks every
 * write; this copy exists so the UI can hide a control the user would be
 * refused anyway, rather than letting them click into a 403.
 *
 * Components must branch on the capability helpers (`can.manage`, `can.decide`
 * …), never on a role string. Twenty-six components used to inline
 * `role === 'admin'`, so adding a role meant finding all of them, and a missed
 * one is a silent permission bug in either direction.
 */

export const ROLES = Object.freeze({
  MD: 'md',             // Managing Director — full control, including destructive
  EA: 'ea',             // Executive Assistant — the MD's proxy, minus destructive
  MANAGER: 'manager',   // owns projects, assigns work, approves
  EMPLOYEE: 'employee', // the doer — captures records, completes tasks
  VIEWER: 'viewer',     // read-only; never writes
});

export const ROLE_VALUES = Object.values(ROLES);

/** Irreversible or account-level: delete a project, manage users. MD only. */
export const CAN_ADMINISTER = Object.freeze([ROLES.MD]);

/** The MD's desk — approves outside any single department, sees what the MD sees. */
export const LEADERSHIP = Object.freeze([ROLES.MD, ROLES.EA]);

/** Create and run work: projects, stage completion, approve/reject. */
export const CAN_MANAGE = Object.freeze([ROLES.MD, ROLES.EA, ROLES.MANAGER]);

/** Capture and edit the work itself: records, tasks, checklists. */
export const CAN_CAPTURE = Object.freeze([ROLES.MD, ROLES.EA, ROLES.MANAGER, ROLES.EMPLOYEE]);

/** Sign-off. Same tier as CAN_MANAGE today, named apart so it can narrow later. */
export const CAN_DECIDE = CAN_MANAGE;

export const can = {
  administer: (role) => CAN_ADMINISTER.includes(role),
  manage: (role) => CAN_MANAGE.includes(role),
  capture: (role) => CAN_CAPTURE.includes(role),
  decide: (role) => CAN_DECIDE.includes(role),
  actForLeadership: (role) => LEADERSHIP.includes(role),
};

export default can;
