import { baseApi } from './baseApi.js';

/**
 * MIS & Analytics — Phase 10 (final business-module phase). Only the
 * portfolio-wide endpoint is migrated: `useMisProject(id)` (GET
 * /pms/mis/projects/:id) has zero call sites anywhere in the client — the
 * per-project MIS route exists server-side but nothing in the UI links to
 * it. Dropped rather than migrated, per the standing rule that legacy dead
 * code doesn't get carried forward into the new data layer.
 */
export const misApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMisPortfolio: build.query({
      query: () => ({ url: '/pms/mis/portfolio', method: 'GET' }),
      providesTags: ['Mis'],
    }),
  }),
});

export const { useGetMisPortfolioQuery } = misApi;

export const useMisPortfolio = () => useGetMisPortfolioQuery();

export default misApi;
