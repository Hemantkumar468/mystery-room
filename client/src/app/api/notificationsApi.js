import { baseApi } from './baseApi.js';
import { qs } from './qs.js';

/**
 * Notifications — in-app only, polled every 30s (this app has no websocket
 * or email infrastructure). Components pass `pollingInterval: 30000` when
 * calling the query hooks, matching the old `refetchInterval` behaviour.
 *
 * Read/read-all are optimistic. Marking a notification read is the most
 * latency-visible action in the product: the bell badge sits right next to
 * the click, so a round-trip before the count moves reads as lag. Unlike
 * approvals or phase gates — where the server's answer is not predictable
 * from the client, and optimism would be actively wrong — there is no
 * business reason this call can be refused.
 */
export const notificationsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getNotifications: build.query({
      query: (params) => ({ url: `/pms/notifications${qs(params)}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Notification', id: 'LIST' },
        ...(result || []).map((n) => ({ type: 'Notification', id: n._id })),
      ],
    }),

    getUnreadNotificationCount: build.query({
      query: () => ({ url: '/pms/notifications/unread-count', method: 'GET' }),
      // Server responds { count }; every consumer wants the bare number
      // (matches the React Query hook this replaces).
      transformResponse: (data) => data?.count ?? 0,
      providesTags: [{ type: 'Notification', id: 'UNREAD_COUNT' }],
    }),

    markNotificationRead: build.mutation({
      query: (id) => ({ url: `/pms/notifications/${id}/read`, method: 'POST' }),
      async onQueryStarted(id, { dispatch, queryFulfilled, getState }) {
        const patches = [];
        // Guards the count decrement below: two overlapping calls for the
        // same id (rapid double-click/tap before the first re-render lands)
        // must only decrement once. Only true if some cached copy of this
        // row was actually flipped from unread to read by this patch pass.
        let flippedUnread = false;

        // Patch every cached notification list that holds this row, whatever
        // params it was fetched with — the bell uses {limit:8} while Store
        // Launch uses {project,limit:5}; both should update at once.
        const cacheEntries = notificationsApi.util.selectCachedArgsForQuery(getState(), 'getNotifications');
        for (const args of cacheEntries) {
          patches.push(
            dispatch(
              notificationsApi.util.updateQueryData('getNotifications', args, (draft) => {
                const row = draft?.find?.((n) => n._id === id);
                if (row && !row.read) { row.read = true; flippedUnread = true; }
              }),
            ),
          );
        }

        if (flippedUnread) {
          patches.push(
            dispatch(
              notificationsApi.util.updateQueryData('getUnreadNotificationCount', undefined, (draft) => Math.max(0, (draft ?? 0) - 1)),
            ),
          );
        }

        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: [
        { type: 'Notification', id: 'LIST' },
        { type: 'Notification', id: 'UNREAD_COUNT' },
      ],
    }),

    markAllNotificationsRead: build.mutation({
      query: () => ({ url: '/pms/notifications/read-all', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled, getState }) {
        const patches = [];

        const cacheEntries = notificationsApi.util.selectCachedArgsForQuery(getState(), 'getNotifications');
        for (const args of cacheEntries) {
          patches.push(
            dispatch(
              notificationsApi.util.updateQueryData('getNotifications', args, (draft) => {
                draft?.forEach?.((n) => { n.read = true; });
              }),
            ),
          );
        }

        patches.push(
          dispatch(notificationsApi.util.updateQueryData('getUnreadNotificationCount', undefined, () => 0)),
        );

        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: [
        { type: 'Notification', id: 'LIST' },
        { type: 'Notification', id: 'UNREAD_COUNT' },
      ],
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationsApi;
