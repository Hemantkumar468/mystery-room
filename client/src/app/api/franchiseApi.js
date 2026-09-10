import { baseApi } from './baseApi.js';

/**
 * Franchise enquiries — the public form posts WITHOUT auth (plain fetch in
 * FranchiseApplyPage); these endpoints are the authenticated side: the
 * MD's queue, one application in full, and the decision that creates a
 * project (with its road: assess / loi / scout).
 */
export const franchiseApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getFranchiseEnquiries: build.query({
      query: (status) => ({ url: `/franchise/enquiries${status ? `?status=${status}` : ''}`, method: 'GET' }),
      providesTags: [{ type: 'Franchise', id: 'LIST' }],
    }),
    getFranchiseEnquiry: build.query({
      query: (id) => ({ url: `/franchise/enquiries/${id}`, method: 'GET' }),
      providesTags: (r, e, id) => [{ type: 'Franchise', id }],
    }),
    decideFranchiseEnquiry: build.mutation({
      query: ({ id, decision, reason, mode, propertyIds }) => ({
        url: `/franchise/enquiries/${id}/decision`,
        method: 'POST',
        data: { decision, reason, mode, propertyIds },
      }),
      // An approval creates a project — every project-derived view moves.
      invalidatesTags: (r, e, { id }) => [
        { type: 'Franchise', id: 'LIST' }, { type: 'Franchise', id },
        'Project', 'Dashboard', 'Gantt', 'MyTasks',
      ],
    }),
  }),
});

export const {
  useGetFranchiseEnquiriesQuery,
  useGetFranchiseEnquiryQuery,
  useDecideFranchiseEnquiryMutation,
} = franchiseApi;

export default franchiseApi;
