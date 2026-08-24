import { baseApi } from './baseApi.js';
import { qs } from './qs.js';

/**
 * HRMS — hiring for new centres. Requisitions (the role + its JD) and
 * candidates (applications moving through a pipeline).
 *
 * Tag shape mirrors the other modules: entity tags per record plus a LIST id,
 * and 'HrmsStats' for the overview aggregates that any mutation can move.
 */
export const hrmsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHrmsOverview: build.query({
      query: () => ({ url: '/hrms/overview', method: 'GET' }),
      providesTags: ['HrmsStats'],
    }),
    getHrmsMeta: build.query({
      query: () => ({ url: '/hrms/meta', method: 'GET' }),
    }),

    getRequisitions: build.query({
      query: (params = {}) => ({ url: `/hrms/requisitions${qs(params)}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Requisition', id: 'LIST' },
        ...(result || []).map((r) => ({ type: 'Requisition', id: r._id })),
      ],
    }),
    getRequisition: build.query({
      query: (id) => ({ url: `/hrms/requisitions/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'Requisition', id }],
    }),
    createRequisition: build.mutation({
      query: (body) => ({ url: '/hrms/requisitions', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Requisition', id: 'LIST' }, 'HrmsStats'],
    }),
    updateRequisition: build.mutation({
      query: ({ id, ...body }) => ({ url: `/hrms/requisitions/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Requisition', id }, { type: 'Requisition', id: 'LIST' }, 'HrmsStats'],
    }),
    deleteRequisition: build.mutation({
      query: ({ id, reason }) => ({ url: `/hrms/requisitions/${id}`, method: 'DELETE', data: { reason } }),
      invalidatesTags: [{ type: 'Requisition', id: 'LIST' }, 'HrmsStats'],
    }),
    /** AI draft — nothing is saved; the result lands in the editable form. */
    draftJd: build.mutation({
      query: (body) => ({ url: '/hrms/requisitions/draft-jd', method: 'POST', data: body }),
    }),

    getCandidates: build.query({
      query: (params = {}) => ({ url: `/hrms/candidates${qs(params)}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Candidate', id: 'LIST' },
        ...(result || []).map((c) => ({ type: 'Candidate', id: c._id })),
      ],
    }),
    createCandidate: build.mutation({
      query: (body) => ({ url: '/hrms/candidates', method: 'POST', data: body }),
      invalidatesTags: (_r, _e, body) => [
        { type: 'Candidate', id: 'LIST' }, { type: 'Requisition', id: body.requisition },
        { type: 'Requisition', id: 'LIST' }, 'HrmsStats',
      ],
    }),
    updateCandidate: build.mutation({
      query: ({ id, ...body }) => ({ url: `/hrms/candidates/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id, requisition }) => [
        { type: 'Candidate', id }, { type: 'Candidate', id: 'LIST' },
        ...(requisition ? [{ type: 'Requisition', id: requisition }] : []), 'HrmsStats',
      ],
    }),
    moveCandidate: build.mutation({
      query: ({ id, ...body }) => ({ url: `/hrms/candidates/${id}/move`, method: 'POST', data: body }),
      invalidatesTags: (_r, _e, { id, requisition }) => [
        { type: 'Candidate', id }, { type: 'Candidate', id: 'LIST' },
        ...(requisition ? [{ type: 'Requisition', id: requisition }] : []),
        { type: 'Requisition', id: 'LIST' }, 'HrmsStats',
      ],
    }),
    createCandidateAccount: build.mutation({
      query: ({ id, ...body }) => ({ url: `/hrms/candidates/${id}/create-account`, method: 'POST', data: body }),
      invalidatesTags: (_r, _e, { id, requisition }) => [
        { type: 'Candidate', id }, { type: 'Candidate', id: 'LIST' },
        ...(requisition ? [{ type: 'Requisition', id: requisition }] : []),
        // The new account must appear on the Employees page without a reload.
        'User',
      ],
    }),
    deleteCandidate: build.mutation({
      query: ({ id, reason }) => ({ url: `/hrms/candidates/${id}`, method: 'DELETE', data: { reason } }),
      invalidatesTags: (_r, _e, { requisition }) => [
        { type: 'Candidate', id: 'LIST' },
        ...(requisition ? [{ type: 'Requisition', id: requisition }] : []), 'HrmsStats',
      ],
    }),
  }),
});

export const {
  useGetHrmsOverviewQuery,
  useGetHrmsMetaQuery,
  useGetRequisitionsQuery,
  useGetRequisitionQuery,
  useCreateRequisitionMutation,
  useUpdateRequisitionMutation,
  useDeleteRequisitionMutation,
  useDraftJdMutation,
  useGetCandidatesQuery,
  useCreateCandidateMutation,
  useUpdateCandidateMutation,
  useMoveCandidateMutation,
  useCreateCandidateAccountMutation,
  useDeleteCandidateMutation,
} = hrmsApi;

export default hrmsApi;
