import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import { setAccessToken, persistSession, clearPersistedSession } from '../../lib/tokenStore.js';
import {
  sessionStarted, tokenRefreshed, userRefreshed, sessionEnded,
} from '../slices/authSlice.js';

/**
 * Every side effect of an auth transition, in one place.
 *
 * Reducers stay pure; this listener keeps the two things outside Redux in
 * step with it:
 *   - `lib/tokenStore.js`, which the axios request interceptor reads
 *     synchronously on every call
 *   - localStorage, so the session survives a reload
 *
 * Writes go through the SILENT `setAccessToken`, never `applyRefreshedToken`.
 * The loud variant exists only for axios, which originates a token Redux has
 * not seen; using it here would notify the store of a change the store itself
 * just made, and the two would bounce off each other indefinitely.
 */
export const authListener = createListenerMiddleware();

authListener.startListening({
  matcher: isAnyOf(sessionStarted, tokenRefreshed, userRefreshed),
  effect: (_action, api) => {
    const { user, accessToken } = api.getState().auth;
    setAccessToken(accessToken);
    persistSession({ user, accessToken });
  },
});

authListener.startListening({
  actionCreator: sessionEnded,
  effect: () => {
    // Clears the in-memory token as well as the stored session, so an
    // in-flight request cannot pick up a token from the session just ended.
    clearPersistedSession();
  },
});

export default authListener;
