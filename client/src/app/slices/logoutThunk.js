import { createAsyncThunk } from '@reduxjs/toolkit';
import { baseApi } from '../api/baseApi.js';
import { authApi } from '../api/authApi.js';
import { sessionEnded } from './authSlice.js';

/**
 * The complete logout cascade.
 *
 * Previously logout was `logout(); navigate('/login')` — it cleared local
 * state and nothing else. Two real consequences, both fixed here:
 *
 *   1. The server's `POST /auth/logout` was never called, so the httpOnly
 *      refresh cookie survived. A "logged-out" browser could still mint a
 *      fresh access token.
 *   2. The cache was never cleared, so on a shared machine the next person
 *      to sign in read the previous user's cached projects, tasks and
 *      records for up to 30s (RTK Query's keepUnusedDataFor).
 *
 * Order matters. The server call goes first, while the cookie is still valid;
 * it is best-effort, because a network failure must never trap someone in a
 * session they asked to leave.
 */
export const logoutThunk = createAsyncThunk(
  'auth/logout',
  async (reason, { dispatch }) => {
    try {
      await dispatch(authApi.endpoints.logout.initiate()).unwrap();
    } catch {
      // Offline, expired cookie, server down — proceed regardless.
    }

    // Local state second, so a slow network can't leave the UI signed in.
    dispatch(sessionEnded(reason ?? 'user'));
    dispatch(baseApi.util.resetApiState());
  },
);

export default logoutThunk;
