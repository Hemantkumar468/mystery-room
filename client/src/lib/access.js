/**
 * The access vocabulary on the browser side, and the live map the app draws
 * itself from.
 *
 * MIRRORS server/src/core/constants/access.js, on the same terms lib/roles.js
 * mirrors the server's role constants: the server is authoritative and
 * re-checks every request, and this copy exists so the UI can leave out a
 * module or a step the person would be refused anyway, instead of drawing a
 * door that opens onto a 403.
 *
 * WHY THERE IS A MODULE-LEVEL MAP HERE and not only a Redux slice. Two kinds
 * of caller need the answer. Components re-render when it changes, so they
 * read it through `useAccess()` and Redux. But plain functions do too -
 * `canSeeNav` in navPolicy.js, `buildNavItems` in moduleRoutes.jsx - and they
 * are called from places that have no hooks and must not import from `app/`
 * (that edge would close a dependency cycle; see app/store.js). This is the
 * same arrangement `lib/tokenStore.js` already uses for the access token, and
 * it is kept in step by exactly one writer: accessApi's `onQueryStarted`.
 *
 * THE UNLOADED STATE IS NOT "DENY EVERYTHING". Until `/access/me` answers,
 * `levelOf` returns undefined and every caller falls back to the static
 * policy in navPolicy.js. Denying instead would blank the entire sidebar for
 * the first few hundred milliseconds of every page load, which reads as a
 * broken app rather than a loading one.
 */

export const ACCESS = Object.freeze({
  NONE: 'none',
  VIEW: 'view',
  EDIT: 'edit',
  MANAGE: 'manage',
});

export const ACCESS_VALUES = Object.values(ACCESS);

export const ACCESS_RANK = Object.freeze({
  none: 0, view: 1, edit: 2, manage: 3,
});

export const INHERIT = 'inherit';

/** The words the Settings screen and every tooltip use. One set, everywhere. */
export const ACCESS_LABELS = Object.freeze({
  [ACCESS.NONE]: 'Hidden',
  [ACCESS.VIEW]: 'View only',
  [ACCESS.EDIT]: 'Can work',
  [ACCESS.MANAGE]: 'Full control',
  [INHERIT]: 'Same as role',
});

/** What each level actually means, said once so no screen re-words it. */
export const ACCESS_HINTS = Object.freeze({
  [ACCESS.NONE]: 'Not in the sidebar, and the page and API both refuse it.',
  [ACCESS.VIEW]: 'Can open it and read it. Every save is refused.',
  [ACCESS.EDIT]: 'Can do the work here — capture, update, move a record on.',
  [ACCESS.MANAGE]: 'Can also decide — approve, reject, reopen, configure.',
  [INHERIT]: 'No decision for this person; their role answers.',
});

export const ACCESS_COLORS = Object.freeze({
  [ACCESS.NONE]: '#9AA0A6',
  [ACCESS.VIEW]: '#0EA5E9',
  [ACCESS.EDIT]: '#16A34A',
  [ACCESS.MANAGE]: '#6741D9',
  [INHERIT]: '#B0B4BA',
});

export const atLeast = (have, need = ACCESS.VIEW) => (ACCESS_RANK[have] ?? 0) >= (ACCESS_RANK[need] ?? 0);
export const isVisible = (level) => atLeast(level, ACCESS.VIEW);
export const weakest = (...levels) => levels
  .filter((l) => ACCESS_RANK[l] !== undefined)
  .reduce((lo, l) => ((ACCESS_RANK[l] < ACCESS_RANK[lo]) ? l : lo), ACCESS.MANAGE);

/**
 * Surface keys are namespaced — see the server constant for the collision
 * this prevents (the Property MODULE and its first STEP are both spelled
 * `property-capture` in their own files, and both spellings are correct).
 */
export const surfaceKey = {
  module: (key) => `module:${key}`,
  step: (key) => `step:${key}`,
  stage: (key) => `stage:${key}`,
};

/* ── the live map ──────────────────────────────────────────────────────── */

/** null until /access/me has answered. Never an empty object — see above. */
let levels = null;

export function setAccessLevels(next) {
  levels = next && typeof next === 'object' ? next : null;
}

export function clearAccessLevels() {
  levels = null;
}

export function getAccessLevels() {
  return levels;
}

export const accessLoaded = () => levels !== null;

/**
 * This person's level on one surface, or `undefined` when the policy has not
 * loaded or does not mention it.
 *
 * Undefined is a real third answer and callers must treat it as "I don't
 * know", not as "no". A surface absent from the catalogue — a new screen
 * nobody has registered yet — deliberately lands here, so shipping a page
 * before adding it to the catalogue makes it visible rather than invisible.
 */
export function levelOf(key) {
  if (!levels) return undefined;
  return levels[key];
}

/** Does this person hold at least `level` here? Unknown surfaces pass. */
export function allows(key, level = ACCESS.VIEW) {
  const have = levelOf(key);
  if (have === undefined) return true;
  return atLeast(have, level);
}

/** Visible at all? Unknown surfaces are visible — see levelOf. */
export function visible(key) {
  const have = levelOf(key);
  if (have === undefined) return true;
  return isVisible(have);
}

export default ACCESS;
