import { baseApi } from './baseApi.js';
import { qs } from './qs.js';

/**
 * MIS & Analytics. Only the portfolio-wide endpoint is used: `useMisProject(id)`
 * (GET /pms/mis/projects/:id) has zero call sites anywhere in the client — the
 * per-project MIS route exists server-side but nothing in the UI links to it.
 *
 * `range` (7/30/90/180/365/all) and `dept` (a department key or `all`) are part
 * of the cache key, so switching a filter refetches rather than reusing the
 * previous slice's numbers. Both are enum-validated server-side.
 */
export const misApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMisPortfolio: build.query({
      query: (params = {}) => ({ url: `/pms/mis/portfolio${qs(params)}`, method: 'GET' }),
      providesTags: ['Mis'],
    }),
  }),
});

export const { useGetMisPortfolioQuery } = misApi;

export const useMisPortfolio = (params) => useGetMisPortfolioQuery(params ?? {});

export default misApi;
