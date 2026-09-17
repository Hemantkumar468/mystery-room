import { baseApi } from './baseApi.js';

/**
 * Design & Drawings FMS — the multi-project management dashboard.
 *
 * A read model over the same p11 Records and 37-drawing checklist master
 * `flowApi.js` already reads, so it shares that tag family: any generic
 * Record write (filing/editing a drawing on the phase form) invalidates this
 * dashboard exactly the way it already invalidates the single-project
 * checklist, with no extra wiring.
 */
export const designDrawingsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getFmsOverview: build.query({
      query: () => ({ url: '/pms/design-drawings/overview', method: 'GET' }),
      providesTags: [{ type: 'Record', id: 'LIST' }, 'DesignDrawingsOverview'],
    }),

    /* One KPI card's rows. Same `Record` tags as the overview it drills into,
       so filing or approving a drawing refreshes the card AND the page behind
       it — the two can never disagree about what 1,030 Pending means. */
    getFmsBreakdown: build.query({
      query: ({ metric, ...params }) => ({
        url: `/pms/design-drawings/breakdown/${metric}`, method: 'GET', params,
      }),
      providesTags: (_r, _e, { metric }) => [
        { type: 'Record', id: 'LIST' },
        'DesignDrawingsOverview',
        { type: 'DesignDrawingsBreakdown', id: metric },
      ],
    }),

    getFmsProject: build.query({
      query: (projectId) => ({ url: `/pms/design-drawings/${projectId}`, method: 'GET' }),
      providesTags: (_r, _e, projectId) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
        { type: 'DesignDrawingsProject', id: projectId },
      ],
    }),

    getDrawingRevisions: build.query({
      query: ({ projectId, drawingNo }) => ({
        url: `/pms/design-drawings/${projectId}/${drawingNo}/revisions`, method: 'GET',
      }),
      providesTags: (_r, _e, { projectId, drawingNo }) => [
        { type: 'DesignDrawingsProject', id: `${projectId}:${drawingNo}` },
      ],
    }),

    assignDrawing: build.mutation({
      query: ({ projectId, drawingNo, ...body }) => ({
        url: `/pms/design-drawings/${projectId}/${drawingNo}/assign`, method: 'POST', data: body,
      }),
      invalidatesTags: (_r, _e, { projectId }) => [
        { type: 'DesignDrawingsProject', id: projectId }, 'DesignDrawingsOverview',
      ],
    }),

    approveDrawing: build.mutation({
      query: ({ projectId, drawingNo }) => ({
        url: `/pms/design-drawings/${projectId}/${drawingNo}/approve`, method: 'POST',
      }),
      invalidatesTags: (_r, _e, { projectId }) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
        { type: 'DesignDrawingsProject', id: projectId },
        'DesignDrawingsOverview',
      ],
    }),

    resendDrawing: build.mutation({
      query: ({ projectId, drawingNo, reason }) => ({
        url: `/pms/design-drawings/${projectId}/${drawingNo}/resend`, method: 'POST', data: { reason },
      }),
      invalidatesTags: (_r, _e, { projectId }) => [
        { type: 'Record', id: `FLOW_${projectId}` },
        { type: 'Record', id: 'LIST' },
        { type: 'DesignDrawingsProject', id: projectId },
        'DesignDrawingsOverview',
      ],
    }),
  }),
});

export const {
  useGetFmsOverviewQuery,
  useGetFmsBreakdownQuery,
  useGetFmsProjectQuery,
  useGetDrawingRevisionsQuery,
  useAssignDrawingMutation,
  useApproveDrawingMutation,
  useResendDrawingMutation,
} = designDrawingsApi;

export default designDrawingsApi;
