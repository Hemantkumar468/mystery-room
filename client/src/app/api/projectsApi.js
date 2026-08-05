import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { isValidId } from '../../lib/id.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Projects domain — Phase 4 of the RTK Query migration. Folds in Dashboard
 * too: `useDashboard` has no other natural home in the migration order and
 * its one tag (`Dashboard`) is a server-derived view over Projects, exactly
 * like Calendar/MIS/MyTasks.
 *
 * Read endpoints (getDashboard/getProjects/getProject/getProjectActivity/
 * getClosureReadiness) are exposed under their OLD hook names
 * (useDashboard, useProjects, useProject, useProjectActivity,
 * useClosureReadiness) as thin wrappers with matching signatures — RTK
 * Query's query-hook shape (`{data, isLoading, isFetching, isError, error,
 * refetch}`) is already identical to React Query's for a plain read, so every
 * one of the ~30 consuming components needs only an import-path change, not
 * a usage-code change.
 *
 * Mutations go through `useCompatMutation` (see mutationCompat.js) for the
 * same reason: consumers call `.mutate(vars, {onSuccess, onError})`,
 * `.mutateAsync(vars)`, `.isPending` — the React Query mutation ergonomics —
 * across dozens of business-critical stage-gating call sites. The wrapper is
 * a pass-through to real RTK Query mutation hooks; only the ergonomics and
 * error shape are adapted, not the caching/fetching itself.
 */
export const projectsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getDashboard: build.query({
      query: () => ({ url: '/pms/dashboard/summary', method: 'GET' }),
      providesTags: ['Dashboard'],
    }),

    getProjects: build.query({
      query: (params) => ({ url: `/pms/projects${qs(params)}`, method: 'GET' }),
      // Old hook returned the full envelope ({data, meta}) as `data`, so
      // pagination meta was read as `result.meta` — preserved here via
      // transformResponse's baseQuery-meta argument instead of unwrapping.
      transformResponse: (payload, meta) => ({ data: payload, meta }),
      providesTags: (result) => [
        { type: 'Project', id: 'LIST' },
        ...((result?.data) || []).map((p) => ({ type: 'Project', id: p._id })),
      ],
    }),

    getProject: build.query({
      query: (id) => ({ url: `/pms/projects/${id}`, method: 'GET' }),
      providesTags: (_result, _error, id) => [{ type: 'Project', id }],
    }),

    getProjectActivity: build.query({
      query: ({ id, limit }) => ({ url: `/pms/projects/${id}/activity${qs({ limit })}`, method: 'GET' }),
      providesTags: (_result, _error, { id }) => [{ type: 'Activity', id }],
    }),

    getClosureReadiness: build.query({
      query: (id) => ({ url: `/pms/projects/${id}/closure-readiness`, method: 'GET' }),
      providesTags: (_result, _error, id) => [{ type: 'ClosureReadiness', id }],
    }),

    createProject: build.mutation({
      query: (body) => ({ url: '/pms/projects', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'Project', id: 'LIST' }, 'Dashboard', 'Mis', 'Calendar'],
    }),

    updateProject: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/projects/${id}`, method: 'PATCH', data: body }),
      // Calendar's milestone events read `targetEndDate`/`health` straight off
      // the Project doc, and Dashboard/MIS both aggregate `Project.status`,
      // `progress` and `health` directly — any update here can change all three.
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project', id },
        { type: 'Project', id: 'LIST' },
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),

    completeStage: build.mutation({
      query: ({ id, stageKey }) => ({ url: `/pms/projects/${id}/stages/${stageKey}/complete`, method: 'POST' }),
      // Every stage completion is a candidate notification source (P9's
      // launch_completed today, more as notification coverage expands) — the
      // bell/unread-count must never go stale just because this particular
      // completion didn't happen to be the one that fired one.
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project', id },
        { type: 'Activity', id },
        { type: 'Project', id: 'LIST' },
        'Dashboard',
        'Mis',
        { type: 'ClosureReadiness', id },
        'Calendar',
        { type: 'Notification', id: 'LIST' },
        { type: 'Notification', id: 'UNREAD_COUNT' },
      ],
    }),

    reopenStage: build.mutation({
      query: ({ id, stageKey }) => ({ url: `/pms/projects/${id}/stages/${stageKey}/reopen`, method: 'POST' }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project', id },
        { type: 'Activity', id },
        { type: 'Project', id: 'LIST' },
        'Dashboard',
        'Mis',
        { type: 'ClosureReadiness', id },
        'Calendar',
      ],
    }),

    archiveProject: build.mutation({
      query: ({ id, remarks }) => ({ url: `/pms/projects/${id}/archive`, method: 'POST', data: { remarks } }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project', id },
        { type: 'Activity', id },
        { type: 'Project', id: 'LIST' },
        { type: 'ClosureReadiness', id },
        { type: 'Notification', id: 'LIST' },
        { type: 'Notification', id: 'UNREAD_COUNT' },
        'Dashboard',
        'Mis',
        'Calendar',
      ],
    }),

    // Draft -> real project ("Create Project" from a Continue-Editing session).
    // Server resolves the default template and materializes stages — the
    // same side effects createProject already invalidates for, so this
    // mutation invalidates the identical tag set.
    publishDraft: build.mutation({
      query: (id) => ({ url: `/pms/projects/${id}/publish`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Project', id },
        { type: 'Project', id: 'LIST' },
        'Dashboard',
        'Mis',
        'Calendar',
      ],
    }),

    logClosureAudit: build.mutation({
      query: ({ id, event }) => ({ url: `/pms/projects/${id}/closure-audit`, method: 'POST', data: { event } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Activity', id }],
    }),

    saveMasterData: build.mutation({
      query: ({ id, stageKey, values }) => ({ url: `/pms/projects/${id}/master-data`, method: 'PATCH', data: { stageKey, values } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Project', id }],
    }),
  }),
});

export const {
  useGetDashboardQuery,
  useGetProjectsQuery,
  useGetProjectQuery,
  useGetProjectActivityQuery,
  useGetClosureReadinessQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  usePublishDraftMutation,
  useCompleteStageMutation,
  useReopenStageMutation,
  useArchiveProjectMutation,
  useLogClosureAuditMutation,
  useSaveMasterDataMutation,
} = projectsApi;

/* ---------- Old-name read wrappers (signature-compatible drop-ins) ---------- */

export const useDashboard = () => useGetDashboardQuery();

export const useProjects = (params) => useGetProjectsQuery(params);

export const useProject = (id) => useGetProjectQuery(id, { skip: !isValidId(id) });

export const useProjectActivity = (id, limit) =>
  useGetProjectActivityQuery({ id, limit }, { skip: !isValidId(id) });

export const useClosureReadiness = (id) => useGetClosureReadinessQuery(id, { skip: !isValidId(id) });

/* ---------- Old-name mutation wrappers (React Query mutation ergonomics) ---------- */

/** `useCreateProject()` — mutate/mutateAsync take the new project's body. */
export const useCreateProject = () => useCompatMutation(useCreateProjectMutation);

/** `useUpdateProject(id)` — mutate/mutateAsync take the patch body only, id bound here. */
export const useUpdateProject = (id) => {
  const compat = useCompatMutation(useUpdateProjectMutation);
  return {
    ...compat,
    mutate: (body, opts) => compat.mutate({ id, ...body }, opts),
    mutateAsync: (body) => compat.mutateAsync({ id, ...body }),
  };
};

/** `usePublishDraft()` — mutate/mutateAsync take the draft's project id. */
export const usePublishDraft = () => useCompatMutation(usePublishDraftMutation);

/** `useCompleteStage(id)` — mutate/mutateAsync take the stageKey only, id bound here. */
export const useCompleteStage = (id) => {
  const compat = useCompatMutation(useCompleteStageMutation);
  return {
    ...compat,
    mutate: (stageKey, opts) => compat.mutate({ id, stageKey }, opts),
    mutateAsync: (stageKey) => compat.mutateAsync({ id, stageKey }),
  };
};

export const useReopenStage = (id) => {
  const compat = useCompatMutation(useReopenStageMutation);
  return {
    ...compat,
    mutate: (stageKey, opts) => compat.mutate({ id, stageKey }, opts),
    mutateAsync: (stageKey) => compat.mutateAsync({ id, stageKey }),
  };
};

/** `useArchiveProject(id)` — mutate/mutateAsync take `remarks` only, id bound here. */
export const useArchiveProject = (id) => {
  const compat = useCompatMutation(useArchiveProjectMutation);
  return {
    ...compat,
    mutate: (remarks, opts) => compat.mutate({ id, remarks }, opts),
    mutateAsync: (remarks) => compat.mutateAsync({ id, remarks }),
  };
};

/** `useLogClosureAudit(id)` — mutate/mutateAsync take the `event` key only. */
export const useLogClosureAudit = (id) => {
  const compat = useCompatMutation(useLogClosureAuditMutation);
  return {
    ...compat,
    mutate: (event, opts) => compat.mutate({ id, event }, opts),
    mutateAsync: (event) => compat.mutateAsync({ id, event }),
  };
};

/** `useSaveMasterData(id)` — mutate/mutateAsync take `{ stageKey, values }`. */
export const useSaveMasterData = (id) => {
  const compat = useCompatMutation(useSaveMasterDataMutation);
  return {
    ...compat,
    mutate: (body, opts) => compat.mutate({ id, ...body }, opts),
    mutateAsync: (body) => compat.mutateAsync({ id, ...body }),
  };
};

export default projectsApi;
