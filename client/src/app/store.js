import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { baseApi } from './api/baseApi.js';
import authReducer from './slices/authSlice.js';
import uiReducer from './slices/uiSlice.js';
import notificationReducer from './slices/notificationSlice.js';
import projectContextReducer from './slices/projectContextSlice.js';
import { createErrorMiddleware } from './middleware/errorMiddleware.js';
import { setAuthFailureHandler, setTokenRefreshedHandler } from '../lib/tokenStore.js';
import { authListener } from './middleware/authPersistence.js';
import { uiListener } from './middleware/uiPersistence.js';
import { tokenRefreshed } from './slices/authSlice.js';
import { logoutThunk } from './slices/logoutThunk.js';

/**
 * The application store.
 *
 * DEPENDENCY DIRECTION (important, and easy to break later):
 *   app/  ──▶  lib/
 * Nothing under `lib/` may import from `app/`. `lib/api.js` in particular
 * stays ignorant of Redux, because `app/api/axiosBaseQuery.js` imports it —
 * the reverse edge would close a cycle. The token they share lives in the
 * plain `lib/tokenStore.js` module, which knows about neither.
 */
export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    notification: notificationReducer,
    projectContext: projectContextReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // RTK Query's internal lifecycle actions carry non-serialisable
        // payloads by design. Narrowing the exception rather than disabling
        // the check keeps the guard that catches a Date or a File being put
        // into a slice. `pending` is included alongside fulfilled/rejected —
        // it fires immediately on trigger, before the request resolves, and
        // already carries the same non-serialisable `originalArgs`.
        ignoredActions: [
          'api/executeQuery/pending',
          'api/executeQuery/fulfilled',
          'api/executeQuery/rejected',
          'api/executeMutation/pending',
          'api/executeMutation/fulfilled',
          'api/executeMutation/rejected',
        ],
        // Four upload/progress-tracking endpoints post non-serialisable args:
        // task attachments (`file`), task updates (`photos`, an array of
        // File), record uploads (`file`), and every one of them accepts an
        // `onProgress` callback function as a trigger arg.
        ignoredActionPaths: [
          'meta.arg.originalArgs.file',
          'meta.arg.originalArgs.files',
          'meta.arg.originalArgs.photos',
          'meta.arg.originalArgs.onProgress',
          'payload.headers',
        ],
        ignoredPaths: ['api.mutations'],
      },
    })
      // Order is load-bearing.
      //  - auth listener FIRST: when a session ends it clears the token, and
      //    any request the API middleware is about to start must already see
      //    it gone. `.prepend()` puts its argument at the FRONT of the chain,
      //    and each subsequent `.prepend()` call moves ahead of the previous
      //    one — so authListener must be prepended LAST to end up first.
      //  - error middleware LAST: by the time it raises a toast the rejection
      //    has already reached the reducers, so component isError/error are
      //    correct.
      .prepend(uiListener.middleware)
      .prepend(authListener.middleware)
      .concat(baseApi.middleware)
      .concat(createErrorMiddleware()),

  // Redux DevTools in development only — the store carries the access token
  // and user object, which shouldn't be inspectable in a production build.
  // Guarded because `import.meta.env` is a Vite construct: without this the
  // store cannot be imported outside a Vite build (a plain-Node test runner,
  // for instance), which is exactly where we want to exercise it.
  devTools: Boolean(import.meta.env?.DEV),
});

/**
 * refetchOnFocus / refetchOnReconnect only take effect once listeners are
 * attached. Focus refetching is off by default in baseApi (matching the
 * React Query config), but reconnect is on, so this is required.
 */
setupListeners(store.dispatch);

/* ── Bind the axios layer's auth callbacks to the store ──
 * `lib/api.js` cannot import from `app/` (that edge would close a cycle), so
 * it raises these through `lib/tokenStore.js` instead and the store binds the
 * handlers here — the one place that knows about both halves.
 */

// The silent 401 refresh produced a new token: get it into Redux and
// localStorage, or the refreshed session would evaporate on the next reload.
setTokenRefreshedHandler((token) => {
  if (token && token !== store.getState().auth.accessToken) {
    store.dispatch(tokenRefreshed(token));
  }
});

// Unrecoverable: no token to send, or the refresh itself failed. Run the full
// cascade rather than only clearing local state.
setAuthFailureHandler((reason) => {
  if (store.getState().auth.accessToken || store.getState().auth.user) {
    store.dispatch(logoutThunk(reason));
  }
});

export default store;
