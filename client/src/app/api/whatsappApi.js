import { baseApi } from './baseApi.js';
import { qs } from './qs.js';

/**
 * WhatsApp notification settings — the admin surface over
 * `/pms/whatsapp`.
 *
 * Four tags rather than one because the four things move independently: a
 * sync rewrites templates, saving a mapping touches only the event map, a
 * test send adds a log row, and the global switch lives in settings. Sharing
 * one tag would make every action refetch all four tables.
 *
 * Nothing here ever sees the access token — the server returns it masked.
 *
 * READS PASS `silentError` and render their own failure inline; MUTATIONS do
 * not, because a toast is the right place to report an action somebody just
 * took. Without this the Settings tab fires three reads at once and a server
 * that is down stacks three identical toasts on the screen. `silentError` is
 * stripped from the args before the URL is built — errorMiddleware reads it
 * off `originalArgs`, so it must never reach the query string.
 */
export const whatsappApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /* ── Settings ─────────────────────────────────────────── */

    getWhatsappSettings: build.query({
      query: () => ({ url: '/pms/whatsapp/settings', method: 'GET' }),
      providesTags: ['WhatsappSettings'],
    }),

    updateWhatsappSettings: build.mutation({
      query: (body) => ({ url: '/pms/whatsapp/settings', method: 'PATCH', data: body }),
      invalidatesTags: ['WhatsappSettings'],
    }),

    /** Credential check. Sends no message, so it is safe to call on mount. */
    verifyWhatsapp: build.query({
      query: () => ({ url: '/pms/whatsapp/verify', method: 'GET' }),
      providesTags: ['WhatsappSettings'],
    }),

    /* ── Templates ────────────────────────────────────────── */

    getWhatsappTemplates: build.query({
      query: ({ silentError, ...params } = {}) => ({
        url: `/pms/whatsapp/templates${qs(params)}`, method: 'GET',
      }),
      providesTags: (result) => [
        { type: 'WhatsappTemplate', id: 'LIST' },
        ...(result || []).map((t) => ({ type: 'WhatsappTemplate', id: t._id })),
      ],
    }),

    /** Compose a template here. Falls back to a local DRAFT when the provider
     *  cannot create one — the response says which happened. */
    createWhatsappTemplate: build.mutation({
      query: (body) => ({ url: '/pms/whatsapp/templates', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'WhatsappTemplate', id: 'LIST' }],
    }),

    /** Pull SmartWhap's list into the local mirror. Also stamps
     *  settings.lastSyncedAt, hence the second tag. */
    syncWhatsappTemplates: build.mutation({
      query: () => ({ url: '/pms/whatsapp/templates/sync', method: 'POST' }),
      invalidatesTags: [{ type: 'WhatsappTemplate', id: 'LIST' }, 'WhatsappSettings'],
    }),

    updateWhatsappTemplate: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/whatsapp/templates/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (r, e, { id }) => [{ type: 'WhatsappTemplate', id }, { type: 'WhatsappTemplate', id: 'LIST' }],
    }),

    /** MD only — the server returns 403 for anyone else. */
    deleteWhatsappTemplate: build.mutation({
      query: (id) => ({ url: `/pms/whatsapp/templates/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'WhatsappTemplate', id: 'LIST' }],
    }),

    /* ── Event mapping ────────────────────────────────────── */

    getWhatsappEventMaps: build.query({
      query: () => ({ url: '/pms/whatsapp/event-map', method: 'GET' }),
      providesTags: ['WhatsappEventMap'],
    }),

    saveWhatsappEventMap: build.mutation({
      query: (body) => ({ url: '/pms/whatsapp/event-map', method: 'POST', data: body }),
      invalidatesTags: ['WhatsappEventMap'],
    }),

    /** MD only. */
    deleteWhatsappEventMap: build.mutation({
      query: (id) => ({ url: `/pms/whatsapp/event-map/${id}`, method: 'DELETE' }),
      invalidatesTags: ['WhatsappEventMap'],
    }),

    /* ── Logs ─────────────────────────────────────────────── */

    getWhatsappLogs: build.query({
      query: ({ silentError, ...params } = {}) => ({
        url: `/pms/whatsapp/logs${qs(params)}`, method: 'GET',
      }),
      providesTags: ['WhatsappLog'],
    }),

    getWhatsappLogSummary: build.query({
      query: () => ({ url: '/pms/whatsapp/logs/summary', method: 'GET' }),
      providesTags: ['WhatsappLog'],
    }),

    /** Asks the provider what actually happened to one message. The only
     *  honest answer to "did it arrive?" — a send only ever reports "sent". */
    refreshWhatsappLogStatus: build.mutation({
      query: (id) => ({ url: `/pms/whatsapp/logs/${id}/refresh-status`, method: 'POST' }),
      invalidatesTags: ['WhatsappLog'],
    }),

    /* ── Test send ────────────────────────────────────────── */

    testSendWhatsapp: build.mutation({
      query: (body) => ({ url: '/pms/whatsapp/test-send', method: 'POST', data: body }),
      invalidatesTags: ['WhatsappLog'],
    }),
  }),
});

export const {
  useGetWhatsappSettingsQuery,
  useUpdateWhatsappSettingsMutation,
  useVerifyWhatsappQuery,
  useGetWhatsappTemplatesQuery,
  useCreateWhatsappTemplateMutation,
  useSyncWhatsappTemplatesMutation,
  useUpdateWhatsappTemplateMutation,
  useDeleteWhatsappTemplateMutation,
  useGetWhatsappEventMapsQuery,
  useSaveWhatsappEventMapMutation,
  useDeleteWhatsappEventMapMutation,
  useGetWhatsappLogsQuery,
  useGetWhatsappLogSummaryQuery,
  useRefreshWhatsappLogStatusMutation,
  useTestSendWhatsappMutation,
} = whatsappApi;

export default whatsappApi;
