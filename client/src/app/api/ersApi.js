import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Employee Performance (ERS) — customer ratings rolled into scores and ranks.
 *
 * EVERY ENDPOINT IS A READ. The one mutation below clears our server's cached
 * copy of the upstream response; it writes nothing to the review service and
 * nothing to our database. This module displays somebody else's data and that
 * is the whole of its contract — see server/src/modules/ers/ers.routes.js.
 *
 * It all goes through OUR server rather than straight to
 * feedback.mysteryrooms.co.in, because that host sends no CORS headers (a
 * browser refuses the call outright) and the endpoints we will want next need
 * an API key that must not ship in the bundle.
 */
export const ersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** The dashboard: counts, podium, top ten, outlet roll-up, scoring formula. */
    getErsOverview: build.query({
      query: (params = {}) => ({ url: '/ers/overview', method: 'GET', params }),
      providesTags: ['ErsBoard'],
    }),
    /** One page of the full leaderboard — searched, filtered, sorted, paged. */
    getErsLeaderboard: build.query({
      query: (params = {}) => ({ url: '/ers/leaderboard', method: 'GET', params }),
      providesTags: ['ErsBoard'],
    }),
    /** One employee: metrics, five ranks, outlet peers. */
    getErsEmployee: build.query({
      query: ({ id, ...params }) => ({ url: `/ers/employees/${id}`, method: 'GET', params }),
      providesTags: ['ErsBoard'],
    }),
    getErsOutlets: build.query({
      query: (params = {}) => ({ url: '/ers/outlets', method: 'GET', params }),
      providesTags: ['ErsBoard'],
    }),

    /**
     * Drop our server's 60-second cache of the upstream response.
     *
     * Invalidates 'ErsBoard' so every open view refetches — the counts, the
     * podium and the table are all the same upstream call, so refreshing one
     * without the others would let them disagree on screen.
     */
    refreshErs: build.mutation({
      query: () => ({ url: '/ers/refresh', method: 'POST' }),
      invalidatesTags: ['ErsBoard'],
    }),
  }),
});

export const {
  useGetErsOverviewQuery,
  useGetErsLeaderboardQuery,
  useGetErsEmployeeQuery,
  useGetErsOutletsQuery,
  useRefreshErsMutation,
} = ersApi;

export const useErsOverview = (params) => useGetErsOverviewQuery(params);
export const useErsLeaderboard = (params) => useGetErsLeaderboardQuery(params);
export const useErsOutlets = (params) => useGetErsOutletsQuery(params);
export const useRefreshErs = () => useCompatMutation(useRefreshErsMutation);

/* ── the vocabulary, in one place ────────────────────────────────────── */

/**
 * The four bands, with the words and colours the whole module draws with.
 *
 * The SERVER decides which band an employee is in (it passes upstream's own
 * `status` through untouched) — this table only says how to render it. A page
 * that recomputed the band would eventually disagree with the review service's
 * own screens about who is "Perfect", and the person being ranked would be the
 * one to notice.
 */
export const ERS_STATUS = Object.freeze({
  Perfect: { key: 'perfect', label: 'Perfect', hint: '4.8★ and above' },
  Good: { key: 'good', label: 'Good', hint: '4.0 – 4.79★' },
  'Needs Improvement': { key: 'needs', label: 'Needs Improvement', hint: 'below 4.0★' },
  'No reviews': { key: 'none', label: 'No reviews', hint: 'not yet ranked' },
});

/** The periods upstream accepts, in the order the toggle offers them. */
export const ERS_PERIODS = Object.freeze([
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
]);
