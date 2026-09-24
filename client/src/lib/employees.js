/**
 * The employee directory — the REAL, registered user accounts.
 *
 * This file used to export a hardcoded array of 36 invented people (Arjun
 * Mehta, Sneha Kapoor, Rohan Verma…) with ids like `emp-exp-001`. Every
 * assignment dropdown in the app read from it, so a template task could only
 * ever be assigned to somebody who did not exist:
 *
 *   - the name picked was not the name of any account, so nobody could be
 *     notified, and
 *   - `Task.assignee` (an ObjectId ref, and the ONLY field My Tasks queries)
 *     was never set, so the work appeared on no dashboard at all.
 *
 * The list now comes from the Employees section — `GET /auth/users`, the same
 * data that screen renders — and an id here IS a User `_id`. Assigning work
 * therefore puts it in that person's My Tasks.
 *
 * ── How it is populated ──────────────────────────────────────────────────
 * `useEmployees()` (hooks/useEmployees.js) is the reactive way in, and it is
 * what any component listing or picking people should use. It also primes the
 * module-level directory below, which exists for the handful of PURE helpers
 * that format a stored id for display (recordUi.js#formatFieldValue,
 * StageDetailModal#personFromEmployeeId) and cannot call a hook. AppShell
 * primes it once on mount, so those helpers resolve on any screen.
 */

/** Role → the label shown when an account has no job title of its own. */
const ROLE_LABELS = {
  md: 'Managing Director',
  ea: 'Executive Assistant',
  manager: 'Manager',
  employee: 'Employee',
  viewer: 'Viewer',
};

/** Initials from a name, for accounts where the server virtual didn't travel. */
const initialsOf = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

/**
 * Adapt a User account into the shape every assignment control already
 * consumes, so switching the source needed no change at the call sites.
 *
 * `availability` is derived from `isActive` and nothing else. The old roster
 * carried invented statuses ("Busy on Pune Site", "Hiring drive active"); there
 * is no real availability system behind them, and inventing one here would put
 * fiction in front of someone deciding who to assign work to.
 */
export function toEmployee(user) {
  const active = user.isActive !== false;
  return {
    id: String(user._id),
    // The retired roster id this account corresponds to, where one was
    // recorded. Templates saved before this change still store roster ids, and
    // this is what lets them resolve to the real person instead of blanking.
    employeeId: user.employeeId || null,
    name: user.name,
    // The DISPLAY role — a job title where one exists, otherwise the label for
    // their system role. Read by every "who is this" surface.
    role: user.title || ROLE_LABELS[user.role] || user.role || '',
    // The SYSTEM role, unlabelled. Kept alongside because permission decisions
    // ("may this person own a lead?") cannot be made from a display string an
    // admin may have overwritten with "Expansion Lead".
    systemRole: user.role || null,
    department: user.department || '',
    email: user.email,
    initials: user.initials || initialsOf(user.name),
    avatarColor: user.avatarColor || '#6E45FF',
    isAvailable: active,
    availability: active
      ? { status: 'available' }
      : { status: 'inactive', reason: 'Account deactivated' },
  };
}

/** Module-level cache, keyed by user id. Primed by useEmployees(). */
let directory = new Map();

/**
 * Replace the cached directory. Idempotent — safe to call on every render.
 *
 * Indexed under BOTH the User id and the account's retired roster id, so a
 * template still holding "emp-exp-001" resolves to the real person it always
 * meant rather than rendering blank. Without this, adopting real accounts would
 * have silently emptied every DOER and BUDDY set before the change.
 */
export function setEmployeeDirectory(employees = []) {
  directory = new Map();
  for (const e of employees) {
    directory.set(String(e.id), e);
    if (e.employeeId) directory.set(String(e.employeeId), e);
  }
}

/**
 * Look up one person by id.
 *
 * Returns null for an unknown id rather than a placeholder, which is what lets
 * callers fall back to showing the raw stored value. That matters for old
 * records still holding a retired `emp-exp-001` roster id: they render the
 * stored string instead of silently claiming to be somebody real.
 */
export const getEmployeeById = (id) => (id ? directory.get(String(id)) || null : null);

/**
 * Normalise a stored assignee to a real User id, or '' if it names nobody.
 *
 * Applied when a template is saved, so a legacy roster id is rewritten to the
 * account it resolves to and the migration happens by using the app rather than
 * by a separate script. An id that resolves to no one is dropped instead of
 * being carried forward as a reference to a person who does not exist.
 */
export const normalizeAssignee = (id) => getEmployeeById(id)?.id || '';

/** Everyone currently in the directory, name-sorted (the server sorts too). */
export const getEmployees = () => [...new Set(directory.values())];
