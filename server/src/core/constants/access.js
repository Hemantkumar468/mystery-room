/**
 * The access vocabulary — four levels, and the two shapes a permission key
 * can take. Everything in the ERP that asks "may this person see or do this"
 * speaks these words, on both sides of the wire.
 *
 * WHY FOUR LEVELS AND NOT A BOOLEAN. The question the business actually asks
 * is never only "can they open it". A site engineer must open Step 3 and file
 * assessments; a regional head must open the same step and read it without
 * touching anything; the MD must also be able to sign it off. One boolean
 * forces those three into two groups and then leaks the difference into
 * hard-coded role checks scattered through the pages — which is exactly the
 * thing lib/roles.js exists to stop.
 *
 *   none   — not there at all. No sidebar row, no route, no API.
 *   view   — may open it and read it. Every write is refused.
 *   edit   — may do the work: capture, update, submit, move a record on.
 *   manage — may also decide: approve, reject, reopen, configure.
 *
 * The levels are ORDERED, so a check is always "at least this much" rather
 * than an equality test. A page asking for `edit` is satisfied by `manage`
 * without naming it, which is what keeps a new level from breaking every
 * call site the day it is added.
 */

export const ACCESS = Object.freeze({
  NONE: 'none',
  VIEW: 'view',
  EDIT: 'edit',
  MANAGE: 'manage',
});

export const ACCESS_VALUES = Object.values(ACCESS);

/** Rank, for "at least" comparisons. Never persisted — the words are. */
export const ACCESS_RANK = Object.freeze({ none: 0, view: 1, edit: 2, manage: 3 });

/**
 * Stored on an override to mean "I am not deciding this one".
 *
 * A per-person override that could only say yes or no would force whoever
 * edits it to restate the person's entire role, and then those restated
 * copies would stop tracking the role the moment the role changed. `inherit`
 * is the third answer, and it is the default for every key nobody has touched.
 */
export const INHERIT = 'inherit';

export const ACCESS_LABELS = Object.freeze({
  [ACCESS.NONE]: 'Hidden',
  [ACCESS.VIEW]: 'View only',
  [ACCESS.EDIT]: 'Can work',
  [ACCESS.MANAGE]: 'Full control',
  [INHERIT]: 'Same as role',
});

/** Is `have` at least as strong as `need`? */
export const atLeast = (have, need) => (ACCESS_RANK[have] ?? 0) >= (ACCESS_RANK[need ?? ACCESS.VIEW] ?? 0);

/** The weaker of two levels — how a child is clamped to its parent. */
export const weakest = (...levels) => levels
  .filter((l) => ACCESS_RANK[l] !== undefined)
  .reduce((lo, l) => ((ACCESS_RANK[l] < ACCESS_RANK[lo]) ? l : lo), ACCESS.MANAGE);

export const isVisible = (level) => atLeast(level, ACCESS.VIEW);

/**
 * Surface keys are NAMESPACED, and that is not decoration.
 *
 * The sidebar's key for the Property module and the route key for its first
 * step are both the string `property-capture` — they were named independently
 * and both are correct in their own file. Stored flat in one grants map they
 * would be the same permission, so hiding Step 1 would hide the whole module
 * and nobody would be able to tell which of the two a stored row meant.
 */
export const surfaceKey = {
  module: (key) => `module:${key}`,
  step: (key) => `step:${key}`,
  stage: (key) => `stage:${key}`,
};

/** `module:property-capture` → `{ kind: 'module', id: 'property-capture' }` */
export const parseSurfaceKey = (key) => {
  const i = String(key ?? '').indexOf(':');
  if (i < 0) return { kind: 'module', id: String(key ?? '') };
  return { kind: String(key).slice(0, i), id: String(key).slice(i + 1) };
};

export default ACCESS;
