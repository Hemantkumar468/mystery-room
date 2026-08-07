import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { isValidId } from '../../lib/id.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * AI domain (Module 2: property & location intelligence).
 *
 * Injected into `baseApi` like every other domain rather than living in its
 * own `createApi` — a run invalidates the project's score list, which the
 * Property Identification table reads, and cross-domain invalidation is only
 * expressible inside one cache (see baseApi.js).
 *
 * These endpoints were written against React Query in the AI feature branch
 * (`lib/queries.js`) and are ported here unchanged in behaviour: same URLs,
 * same polling cadence, same cache seeding on run start. Old hook names
 * (`useAiStatus`, `usePropertyAnalysis`, …) are re-exported at the bottom so
 * the three AI components consume them exactly as written.
 */
export const aiApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * Provider/rubric status. Deliberately untagged and never invalidated —
     * it only changes when the server is reconfigured, and RTK Query does not
     * refetch on mount by default, which reproduces the old `staleTime: 5min,
     * retry: false`.
     */
    getAiStatus: build.query({
      query: () => ({ url: '/ai/status', method: 'GET' }),
    }),

    /**
     * The latest analysis for a property. `includeBrief` additionally pulls
     * the full research brief (several thousand words), so it is part of the
     * cache key — the polling query every visit runs stays small.
     */
    getPropertyAnalysis: build.query({
      query: ({ recordId, includeBrief }) => ({
        url: `/ai/property-intelligence/${recordId}${qs({ includeBrief: includeBrief || undefined })}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, { recordId }) => [{ type: 'AiAnalysis', id: recordId }],
    }),

    getPropertyAnalysisHistory: build.query({
      query: (recordId) => ({ url: `/ai/property-intelligence/${recordId}/history`, method: 'GET' }),
      providesTags: (_result, _error, recordId) => [{ type: 'AiAnalysis', id: `HISTORY-${recordId}` }],
    }),

    /**
     * Start an analysis. The server answers 202 with a `queued` document,
     * which is seeded straight into the analysis cache so the panel switches
     * to its running state immediately instead of waiting a poll interval to
     * notice. `upsertQueryData` (not `updateQueryData`) because the common
     * case is a property with no cache entry at all yet.
     */
    runPropertyAnalysis: build.mutation({
      query: ({ recordId, force = false }) => ({
        url: `/ai/property-intelligence/${recordId}`,
        method: 'POST',
        data: { force },
      }),
      async onQueryStarted({ recordId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if (data?.analysis) {
            dispatch(
              aiApi.util.upsertQueryData('getPropertyAnalysis', { recordId, includeBrief: false }, data.analysis),
            );
          }
        } catch {
          // The failure surfaces through the mutation's own error state; the
          // seeding is an optimisation, not the source of truth.
        }
      },
      invalidatesTags: (_result, _error, { recordId }) => [
        { type: 'AiAnalysis', id: recordId },
        { type: 'AiAnalysis', id: `HISTORY-${recordId}` },
        // The old layer invalidated ['ai-scores'] wholesale (every project's
        // score list). Every getProjectAiScores result carries the shared
        // 'LIST' tag, so this keeps that blanket behaviour.
        { type: 'AiScores', id: 'LIST' },
      ],
    }),

    /** Compact per-property scores for a whole project — the table's AI Score column. */
    getProjectAiScores: build.query({
      query: (projectId) => ({ url: `/ai/projects/${projectId}/scores`, method: 'GET' }),
      providesTags: (_result, _error, projectId) => [
        { type: 'AiScores', id: projectId },
        { type: 'AiScores', id: 'LIST' },
      ],
    }),

    /**
     * Analyse every un-analysed property in one project. The server runs the
     * sweep itself with bounded concurrency, so unlike the old per-property
     * loop this survives the user navigating away or closing the tab.
     */
    runProjectSweep: build.mutation({
      query: ({ projectId, force = false }) => ({
        url: `/ai/projects/${projectId}/analyse-all`,
        method: 'POST',
        data: { force },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'AiScores', id: projectId },
        { type: 'AiScores', id: 'LIST' },
        { type: 'AiSweep', id: projectId },
      ],
    }),

    /** Live sweep counters; resolves to null once the sweep has finished. */
    getProjectSweep: build.query({
      query: (projectId) => ({ url: `/ai/projects/${projectId}/analyse-all`, method: 'GET' }),
      providesTags: (_result, _error, projectId) => [{ type: 'AiSweep', id: projectId }],
    }),

    getAiComparison: build.query({
      query: (projectId) => ({ url: `/ai/projects/${projectId}/comparison`, method: 'GET' }),
      providesTags: (_result, _error, projectId) => [{ type: 'AiComparison', id: projectId }],
    }),

    /** Comparison runs in one call over existing reports, so this resolves directly. */
    runAiComparison: build.mutation({
      query: (projectId) => ({ url: `/ai/projects/${projectId}/comparison`, method: 'POST' }),
      async onQueryStarted(projectId, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if (data) dispatch(aiApi.util.upsertQueryData('getAiComparison', projectId, data));
        } catch {
          // Same as above — the panel renders `run.isError` itself.
        }
      },
      invalidatesTags: (_result, _error, projectId) => [{ type: 'AiComparison', id: projectId }],
    }),
  }),
});

export const {
  useGetAiStatusQuery,
  useGetPropertyAnalysisQuery,
  useGetPropertyAnalysisHistoryQuery,
  useRunPropertyAnalysisMutation,
  useGetProjectAiScoresQuery,
  useRunProjectSweepMutation,
  useGetProjectSweepQuery,
  useGetAiComparisonQuery,
  useRunAiComparisonMutation,
} = aiApi;

/* ---------- Old-name read wrappers ---------- */

export const useAiStatus = () => useGetAiStatusQuery();

/**
 * Analyses run in the background on the server (a grounded research call plus
 * a synthesis call — 30–90s), so this polls itself while a run is in flight
 * and stops the moment it settles.
 *
 * The interval has to be derived from the cache entry's own status, which is
 * not available until after the query hook returns. `useQueryState` reads that
 * entry from the store without adding a subscription or triggering a fetch, so
 * the interval is correct on the same render the status changes — no effect,
 * no second request.
 */
export const usePropertyAnalysis = (recordId, { includeBrief = false } = {}) => {
  const arg = { recordId, includeBrief };
  const skip = !isValidId(recordId);
  const { data: cached } = aiApi.endpoints.getPropertyAnalysis.useQueryState(arg, { skip });
  const running = cached?.status === 'queued' || cached?.status === 'running';

  return useGetPropertyAnalysisQuery(arg, {
    skip,
    pollingInterval: running ? 3000 : 0,
    // A running analysis must keep polling even on a background tab — the user
    // switching away mid-run and back is the normal case, not the exception.
    skipPollingIfUnfocused: false,
  });
};

export const usePropertyAnalysisHistory = (recordId, enabled = true) =>
  useGetPropertyAnalysisHistoryQuery(recordId, { skip: !(enabled && isValidId(recordId)) });

// `refetchOnMountOrArgChange: 30` reproduces the old `staleTime: 30s`: the
// table remounts on every navigation back into the stage, and scores move
// whenever an analysis finishes elsewhere.
//
// `live` polls on top of that, for the window where a sweep is filling these
// scores in on the server. Without it the table would sit on a stale snapshot
// for the whole sweep and only catch up on the next navigation — the rows
// would never show their own progress.
export const useProjectAiScores = (projectId, enabled = true, live = false) =>
  useGetProjectAiScoresQuery(projectId, {
    skip: !(enabled && isValidId(projectId)),
    refetchOnMountOrArgChange: 30,
    pollingInterval: live ? 5000 : 0,
    skipPollingIfUnfocused: false,
  });

export const useAiComparison = (projectId) =>
  useGetAiComparisonQuery(projectId, { skip: !isValidId(projectId) });

/**
 * Live state of a whole-project sweep.
 *
 * Polls only while a sweep is actually running: the server returns `null` once
 * it finishes, and that null is what stops the polling — so an idle project
 * costs one request on mount and nothing after. `enabled` lets the page start
 * polling the moment it kicks a sweep off, before the first response has come
 * back to prove one is running.
 */
export const useProjectSweep = (projectId, enabled = false) => {
  const skip = !isValidId(projectId);
  const { data: cached } = aiApi.endpoints.getProjectSweep.useQueryState(projectId, { skip });
  const running = Boolean(cached) || enabled;

  return useGetProjectSweepQuery(projectId, {
    skip,
    pollingInterval: running ? 3000 : 0,
    // A sweep is minutes long; the user switching tabs mid-sweep is the normal
    // case, and the counters must be right when they come back.
    skipPollingIfUnfocused: false,
  });
};

/** `useRunProjectSweep(projectId)` — mutate/mutateAsync take `{ force }`. */
export const useRunProjectSweep = (projectId) => {
  const compat = useCompatMutation(useRunProjectSweepMutation);
  return {
    ...compat,
    mutate: ({ force = false } = {}, opts) => compat.mutate({ projectId, force: Boolean(force) }, opts),
    mutateAsync: ({ force = false } = {}) => compat.mutateAsync({ projectId, force: Boolean(force) }),
  };
};

/* ---------- Old-name mutation wrappers ---------- */

/** `useRunPropertyAnalysis(recordId)` — mutate/mutateAsync take `{ force }`. */
export const useRunPropertyAnalysis = (recordId) => {
  const compat = useCompatMutation(useRunPropertyAnalysisMutation);
  return {
    ...compat,
    mutate: ({ force = false } = {}, opts) => compat.mutate({ recordId, force: Boolean(force) }, opts),
    mutateAsync: ({ force = false } = {}) => compat.mutateAsync({ recordId, force: Boolean(force) }),
  };
};

/** `useRunAiComparison(projectId)` — mutate/mutateAsync take no arguments. */
export const useRunAiComparison = (projectId) => {
  const compat = useCompatMutation(useRunAiComparisonMutation);
  return {
    ...compat,
    mutate: (_vars, opts) => compat.mutate(projectId, opts),
    mutateAsync: () => compat.mutateAsync(projectId),
  };
};

export default aiApi;
