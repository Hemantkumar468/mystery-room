import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * EMS — Branch master data (docs/EMS-ARCHITECTURE.md Section 3/16).
 * First finance domain file; every later one (vendors, expenseCategories,
 * expenses, budgets, …) follows this exact injectEndpoints shape.
 */
export const branchesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getBranches: build.query({
      query: (params) => ({ url: `/finance/branches${qs(params)}`, method: 'GET' }),
      // Old hook shape preserved: { data: items[], meta } as the query's `data`
      // — matches tasksApi.js's getTasks so pagination reads the same way
      // everywhere in the app.
      transformResponse: (payload, meta) => ({ data: payload, meta }),
      providesTags: (result) => [
        { type: 'Branch', id: 'LIST' },
        ...((result?.data) || []).map((b) => ({ type: 'Branch', id: b._id })),
      ],
    }),

    getBranchSummary: build.query({
      query: () => ({ url: '/finance/branches/summary', method: 'GET' }),
      providesTags: [{ type: 'Branch', id: 'SUMMARY' }],
    }),

    getBranch: build.query({
      query: (id) => ({ url: `/finance/branches/${id}`, method: 'GET' }),
      providesTags: (_result, _error, id) => [{ type: 'Branch', id }],
    }),

    createBranch: build.mutation({
      query: (body) => ({ url: '/finance/branches', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Branch', id: 'LIST' }, { type: 'Branch', id: 'SUMMARY' }],
    }),

    updateBranch: build.mutation({
      query: ({ id, ...body }) => ({ url: `/finance/branches/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Branch', id: 'LIST' },
        { type: 'Branch', id },
        { type: 'Branch', id: 'SUMMARY' },
      ],
    }),
  }),
});

export const {
  useGetBranchesQuery,
  useGetBranchSummaryQuery,
  useGetBranchQuery,
  useCreateBranchMutation,
  useUpdateBranchMutation,
} = branchesApi;

export const useBranches = (params) => useGetBranchesQuery(params);
export const useBranchSummary = () => useGetBranchSummaryQuery();
export const useBranch = (id) => useGetBranchQuery(id, { skip: !id });
export const useCreateBranch = () => useCompatMutation(useCreateBranchMutation);
export const useUpdateBranch = () => useCompatMutation(useUpdateBranchMutation);

export default branchesApi;
