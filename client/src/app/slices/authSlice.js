import { createSlice, createSelector } from '@reduxjs/toolkit';
import { canApprove, canManagementApprove, canWorkOnTask } from '../../lib/ui.js';
import { ROLES, can } from '../../lib/roles.js';
import { loadPersistedSession, setAccessToken } from '../../lib/tokenStore.js';

/**
 * Authentication — the single source of truth.
 *
 * Replaces `store/authStore.js` (Zustand), which has been deleted. The token
 * itself is mirrored into `lib/tokenStore.js` because `lib/api.js` reads it
 * synchronously inside an axios interceptor and must not import from `app/`
 * (that edge would close a dependency cycle).
 *
 * Three writers exist, and only three:
 *   - `sessionStarted`  — login succeeded
 *   - `tokenRefreshed`  — the silent 401 refresh produced a new token
 *   - `sessionEnded`    — logout, or an unrecoverable auth failure
 * Each keeps Redux, the token holder and localStorage in step, so there is no
 * path where one of the three drifts from the others.
 */

const persisted = loadPersistedSession();
// Seed the interceptor's token holder before the first request can fire.
setAccessToken(persisted.accessToken);

const initialState = {
  user: persisted.user,
  accessToken: persisted.accessToken,
  /** Why the session ended, when it ended involuntarily. */
  endedReason: null,
};

/**
 * Reducers are PURE — no token writes, no localStorage, no getState.
 * Every side effect of an auth transition lives in
 * `app/middleware/authPersistence.js`, which listens for these actions.
 * (Doing it inline here is what made an early version call `store.getState()`
 * from inside a reducer, which Redux rejects outright.)
 */
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionStarted: (state, action) => {
      state.user = action.payload.user ?? null;
      state.accessToken = action.payload.accessToken ?? null;
      state.endedReason = null;
    },

    tokenRefreshed: (state, action) => {
      state.accessToken = action.payload ?? null;
    },

    /** The authenticated user's own record was re-fetched (role may have changed). */
    userRefreshed: (state, action) => {
      state.user = action.payload ?? null;
    },

    sessionEnded: (state, action) => {
      state.user = null;
      state.accessToken = null;
      state.endedReason = action.payload ?? null;
    },
  },
});

export const { sessionStarted, tokenRefreshed, userRefreshed, sessionEnded } = authSlice.actions;

/* ─────────────────────────── selectors ───────────────────────────
 * Permission logic has ONE home. Before this, `role === 'admin' ||
 * role === 'manager'` was reimplemented in 15 components, and
 * StageDetailModal carried a near-duplicate of `canWorkOnTask` with a
 * different id-resolution order — two drifting mirrors of one server rule.
 *
 * The rule FUNCTIONS stay in `lib/ui.js` and are only called from here: the
 * regression suite asserts client/server parity by importing those exact
 * functions, so they are half of a tested contract and must not be rewritten.
 */
export const selectCurrentUser = (state) => state.auth.user;
export const selectAccessToken = (state) => state.auth.accessToken;
export const selectIsAuthenticated = (state) => Boolean(state.auth.accessToken);
export const selectSessionEndedReason = (state) => state.auth.endedReason;

export const selectRole = createSelector(selectCurrentUser, (user) => user?.role ?? null);

/** True only for the MD — the one role that may delete and manage accounts. */
export const selectIsAdmin = createSelector(selectRole, (role) => can.administer(role));
export const selectIsManager = createSelector(selectRole, (role) => role === ROLES.MANAGER);

/** Acts for the top of the company: MD or EA. */
export const selectIsLeadership = createSelector(selectRole, (role) => can.actForLeadership(role));

/** May create/run work and sign off: MD, EA or Manager. */
export const selectCanDecide = createSelector(selectRole, (role) => can.decide(role));

/** May capture and edit records and tasks: everyone except Viewer. */
export const selectCanCapture = createSelector(selectRole, (role) => can.capture(role));

/** Department-scoped task approval — delegates to the parity-tested rule. */
export const selectCanApproveTask = (task) =>
  createSelector(selectCurrentUser, (user) => canApprove(user, task));

/** Cross-department management tier. */
export const selectCanManagementApprove = createSelector(
  selectCurrentUser,
  (user) => canManagementApprove(user),
);

/** Doer-or-manager: may move status, tick checklists, upload evidence. */
export const selectCanWorkOnTask = (task) =>
  createSelector(selectCurrentUser, (user) => canWorkOnTask(user, task));

export default authSlice.reducer;
