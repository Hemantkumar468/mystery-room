import { createSlice, nanoid } from '@reduxjs/toolkit';

/**
 * Client-side, ephemeral user feedback — the toast queue.
 *
 * This is NOT the server's Notification module. Those are persisted records
 * fetched and polled through `lib/queries.js` (`useNotifications`,
 * `useUnreadNotificationCount`) and rendered by the Topbar bell; they stay in
 * React Query and are untouched by this phase. The two concepts currently
 * share a name and nothing else, which is part of what made the duplication
 * below easy to miss.
 *
 * Why this exists: there are three independent, hand-rolled toast
 * implementations in the app today —
 *   features/employees/EmployeesPage.jsx      (5000ms)
 *   features/projects/SiteEvaluationPage.jsx  (4000ms)
 *   features/templates/TemplatesPage.jsx      (4000ms)
 * each with its own `{ text, type }` state, its own auto-dismiss useEffect
 * and its own inline styles (there is no `.toast` class anywhere in
 * styles/). Seven further pages instead keep a bespoke error string in local
 * state. The net effect is that a mutation fired from any other page cannot
 * raise user feedback at all.
 *
 * Centralising the queue is also what lets `errorMiddleware` report a failed
 * request from anywhere, without every page wiring up its own handler.
 *
 * PHASE 1: the slice and middleware are live, but no `<ToastHost>` is
 * mounted and no existing page has been rewritten — so nothing visible
 * changes yet. Rendering the host and retiring the three local copies is a
 * separate change.
 */
const initialState = {
  /** [{ id, kind, message, detail, code, timeout }] — newest last. */
  toasts: [],
};

const notificationSlice = createSlice({
  name: 'notification',
  initialState,
  reducers: {
    toastPushed: {
      reducer: (state, action) => {
        state.toasts.push(action.payload);
      },
      /**
       * `prepare` generates the id, so callers dispatch a plain message and
       * reducers stay pure — `nanoid()` inside a reducer would make it
       * non-deterministic and break time-travel replay in DevTools.
       */
      prepare: ({ kind = 'info', message, detail, code, timeout = 4000 } = {}) => ({
        payload: { id: nanoid(), kind, message, detail, code, timeout },
      }),
    },
    toastDismissed: (state, action) => {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    toastsCleared: (state) => {
      state.toasts = [];
    },
  },
});

export const { toastPushed, toastDismissed, toastsCleared } = notificationSlice.actions;

export const selectToasts = (state) => state.notification.toasts;

export default notificationSlice.reducer;
