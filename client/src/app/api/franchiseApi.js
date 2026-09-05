import { baseApi } from './baseApi.js';

/**
 * Franchise enquiries — the public form posts WITHOUT auth (plain fetch in
 * FranchiseApplyPage); these endpoints are the authenticated side: the
 * MD's queue and the decision that creates a project.
 */
export const franchiseApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getFranchiseEnquiries: build.query({
      query: (status) => ({ url: `/franchise/enquiries${status ? `?status=${status}` : ''}`, method: 'GET' }),
      providesTags: [{ type: 'Franchise', id: 'LIST' }],
    }),
    decideFranchiseEnquiry: build.mutation({
      query: ({ id, decision, reason }) => ({ url: `/franchise/enquiries/${id}/decision`, method: 'POST', data: { decision, reason } }),
      // An approval creates a project — every project-derived view moves.
      invalidatesTags: [{ type: 'Franchise', id: 'LIST' }, 'Project', 'Dashboard', 'Gantt', 'MyTasks'],
    }),
  }),
});

export const {
  useGetFranchiseEnquiriesQuery,
  useDecideFranchiseEnquiryMutation,
} = franchiseApi;

export default franchiseApi;
