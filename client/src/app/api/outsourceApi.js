import { baseApi } from './baseApi.js';

/**
 * Inviting an outside designer to do a phase's work.
 *
 * Only the INSIDE half is here. The page the designer opens has no session and
 * deliberately uses plain fetch (see DesignBriefPage) — routing it through this
 * client would send an Authorization header the designer does not have and
 * hand them a 401 instead of their brief.
 */
export const outsourceApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getOutsourceLinks: build.query({
      query: ({ projectId, stageKey }) => ({
        url: `/pms/outsource?projectId=${projectId}${stageKey ? `&stageKey=${stageKey}` : ''}`,
        method: 'GET',
      }),
      providesTags: ['OutsourceLink'],
    }),
    /** Returns the raw link ONCE — it is never readable again. */
    createOutsourceLink: build.mutation({
      query: (body) => ({ url: '/pms/outsource', method: 'POST', data: body }),
      invalidatesTags: ['OutsourceLink'],
    }),
    /** Notes that somebody actually sent it, and by which channel. */
    recordOutsourceSend: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/outsource/${id}/sends`, method: 'POST', data: body }),
      invalidatesTags: ['OutsourceLink'],
    }),
    revokeOutsourceLink: build.mutation({
      query: (id) => ({ url: `/pms/outsource/${id}/revoke`, method: 'POST' }),
      invalidatesTags: ['OutsourceLink'],
    }),
    regenerateOutsourceLink: build.mutation({
      query: (id) => ({ url: `/pms/outsource/${id}/regenerate`, method: 'POST' }),
      invalidatesTags: ['OutsourceLink'],
    }),
  }),
});

export const {
  useGetOutsourceLinksQuery,
  useCreateOutsourceLinkMutation,
  useRecordOutsourceSendMutation,
  useRevokeOutsourceLinkMutation,
  useRegenerateOutsourceLinkMutation,
} = outsourceApi;
