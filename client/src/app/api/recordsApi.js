import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { isValidId } from '../../lib/id.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Records domain (collection-mode stages) — Phase 6. Same pattern as
 * projects/tasksApi.js.
 *
 * Tagging note: the old React Query layer scoped list invalidation to
 * `['records', projectId, stageKey]` via key-prefix matching, and separately
 * blanket-invalidated `['record']` (every open detail view) on every mutation
 * — "refresh whatever's open, we don't know what's open". Reproduced here as
 * a compound list tag (`LIST-${projectId}-${stageKey}`) plus a shared
 * `DETAIL_ALL` tag on every `getRecord` result, so the same blanket-refresh
 * behaviour survives the move to a tag-based cache.
 */
export const recordsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getStageRecords: build.query({
      query: ({ projectId, stageKey, extra }) => ({ url: `/pms/records${qs({ projectId, stageKey, ...extra })}`, method: 'GET' }),
      providesTags: (result, _error, { projectId, stageKey }) => [
        { type: 'Record', id: `LIST-${projectId}-${stageKey}` },
        ...((result) || []).map((r) => ({ type: 'Record', id: r._id })),
      ],
    }),

    /**
     * Every candidate property across every project — the p1 records, with no
     * projectId filter. Backs the top-level Properties page, which answers
     * "what sites are we looking at?" without first having to pick a project.
     */
    getAllProperties: build.query({
      query: () => ({ url: `/pms/records${qs({ stageKey: 'p1' })}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Record', id: 'PROPERTIES_ALL' },
        ...((result) || []).map((r) => ({ type: 'Record', id: r._id })),
      ],
    }),

    /** Every submitted record across every project/stage, for the Dashboard's Pending Approvals panel. */
    getPendingApprovals: build.query({
      query: () => ({ url: `/pms/records${qs({ status: 'submitted' })}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Record', id: 'PENDING_ALL' },
        ...((result) || []).map((r) => ({ type: 'Record', id: r._id })),
      ],
    }),

    getRecord: build.query({
      query: (recordId) => ({ url: `/pms/records/${recordId}`, method: 'GET' }),
      providesTags: (_result, _error, recordId) => [
        { type: 'Record', id: recordId },
        { type: 'Record', id: 'DETAIL_ALL' },
      ],
    }),

    createRecord: build.mutation({
      query: ({ projectId, stageKey, ...body }) => ({ url: '/pms/records', method: 'POST', data: { projectId, stageKey, ...body } }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    updateRecord: build.mutation({
      query: ({ id, projectId, stageKey, ...body }) => ({ url: `/pms/records/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    markRecordOpened: build.mutation({
      query: ({ id }) => ({ url: `/pms/records/${id}/open`, method: 'POST' }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    recordDecision: build.mutation({
      query: ({ id, projectId, stageKey, ...body }) => ({ url: `/pms/records/${id}/decision`, method: 'POST', data: body }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    /**
     * Decide many records at once, from the Approvals queue.
     *
     * The spread of projects/stages in a batch is unknowable up front, so this
     * cannot use `recordInvalidation(projectId, stageKey)` — it busts the
     * cross-project tags instead and lets the per-project lists refetch on
     * next view. Coarser than the single-record path deliberately: a stale
     * queue after a bulk approve is exactly the bug this feature exists to
     * avoid.
     */
    bulkRecordDecision: build.mutation({
      query: (body) => ({ url: '/pms/records/bulk-decision', method: 'POST', data: body }),
      invalidatesTags: [
        { type: 'Record', id: 'PENDING_ALL' },
        { type: 'Record', id: 'PROPERTIES_ALL' },
        { type: 'Record', id: 'DETAIL_ALL' },
        'Dashboard',
        'Activity',
      ],
    }),

    addRecordComment: build.mutation({
      query: ({ id, projectId, stageKey, body }) => ({ url: `/pms/records/${id}/comments`, method: 'POST', data: { body } }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    undoRecordDecision: build.mutation({
      query: ({ id }) => ({ url: `/pms/records/${id}/undo-decision`, method: 'POST' }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    deleteRecord: build.mutation({
      query: ({ id }) => ({ url: `/pms/records/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    /** Upload a media file to S3 (unattached) for the record form — not tied to any project/stage cache. */
    uploadMedia: build.mutation({
      query: ({ file, onProgress }) => {
        const form = new FormData();
        form.append('file', file);
        return {
          url: '/pms/records/uploads',
          method: 'POST',
          data: form,
          onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100)); },
        };
      },
    }),

    destroyMedia: build.mutation({
      query: ({ publicId, resourceType }) => ({ url: '/pms/records/uploads/destroy', method: 'POST', data: { publicId, resourceType } }),
    }),
  }),
});

function recordInvalidation(projectId, stageKey) {
  return [
    { type: 'Record', id: `LIST-${projectId}-${stageKey}` },
    { type: 'Record', id: 'DETAIL_ALL' },
    { type: 'Project', id: projectId },
    { type: 'Activity', id: projectId },
    // project.service.js's closureReadiness() reads p10-stage Records
    // directly (approvedOf() filters by assessmentType + APPROVED status) —
    // a decision on one of those records changes whether Archive Project is
    // eligible, but nothing invalidated this gate before. Scoped to the same
    // project, so this is a no-op cache bust for every other stage's records.
    { type: 'ClosureReadiness', id: projectId },
    // Dashboard's cross-project Pending Approvals panel — any record mutation
    // anywhere could add/remove a 'submitted' record, so bust it unscoped.
    { type: 'Record', id: 'PENDING_ALL' },
  ];
}

export const {
  useGetPendingApprovalsQuery,
  useGetAllPropertiesQuery,
  useGetStageRecordsQuery,
  useGetRecordQuery,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useMarkRecordOpenedMutation,
  useRecordDecisionMutation,
  useBulkRecordDecisionMutation,
  useAddRecordCommentMutation,
  useUndoRecordDecisionMutation,
  useDeleteRecordMutation,
  useUploadMediaMutation,
  useDestroyMediaMutation,
} = recordsApi;

/* ---------- Old-name read wrappers ---------- */

// `options.enabled`, when passed, OVERRIDES the default validity check
// entirely (matching the old `{ enabled: isValidId(...), ...options }` spread
// order, where a caller-supplied `enabled` wins) — not ANDed with it.
export const useStageRecords = (projectId, stageKey, extra = {}, { enabled, ...options } = {}) => {
  const effectiveEnabled = enabled !== undefined ? enabled : (isValidId(projectId) && !!stageKey);
  return useGetStageRecordsQuery({ projectId, stageKey, extra }, { skip: !effectiveEnabled, ...options });
};

export const useRecord = (recordId, { enabled, ...options } = {}) => {
  const effectiveEnabled = enabled !== undefined ? enabled : isValidId(recordId);
  return useGetRecordQuery(recordId, { skip: !effectiveEnabled, ...options });
};

/* ---------- Old-name mutation wrappers ---------- */

/** `useCreateRecord(projectId, stageKey)` — mutate/mutateAsync take the record body. */
export const useCreateRecord = (projectId, stageKey) => {
  const compat = useCompatMutation(useCreateRecordMutation);
  return {
    ...compat,
    mutate: (body, opts) => compat.mutate({ projectId, stageKey, ...body }, opts),
    mutateAsync: (body) => compat.mutateAsync({ projectId, stageKey, ...body }),
  };
};

/** `useUpdateRecord(projectId, stageKey)` — mutate/mutateAsync take `{ id, ...body }`. */
export const useUpdateRecord = (projectId, stageKey) => {
  const compat = useCompatMutation(useUpdateRecordMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId, stageKey }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId, stageKey }),
  };
};

/** `useMarkRecordOpened(projectId, stageKey)` — mutate/mutateAsync take the record id only. */
export const useMarkRecordOpened = (projectId, stageKey) => {
  const compat = useCompatMutation(useMarkRecordOpenedMutation);
  return {
    ...compat,
    mutate: (id, opts) => compat.mutate({ id, projectId, stageKey }, opts),
    mutateAsync: (id) => compat.mutateAsync({ id, projectId, stageKey }),
  };
};

/** `useRecordDecision(projectId, stageKey)` — mutate/mutateAsync take `{ id, decision, reason, remarks }`. */
export const useRecordDecision = (projectId, stageKey) => {
  const compat = useCompatMutation(useRecordDecisionMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId, stageKey }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId, stageKey }),
  };
};

/** `useAddRecordComment(projectId, stageKey)` — mutate/mutateAsync take `{ id, body }`. */
export const useAddRecordComment = (projectId, stageKey) => {
  const compat = useCompatMutation(useAddRecordCommentMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId, stageKey }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId, stageKey }),
  };
};

/** `useUndoRecordDecision(projectId, stageKey)` — mutate/mutateAsync take the record id only. */
export const useUndoRecordDecision = (projectId, stageKey) => {
  const compat = useCompatMutation(useUndoRecordDecisionMutation);
  return {
    ...compat,
    mutate: (id, opts) => compat.mutate({ id, projectId, stageKey }, opts),
    mutateAsync: (id) => compat.mutateAsync({ id, projectId, stageKey }),
  };
};

/** `useDeleteRecord(projectId, stageKey)` — mutate/mutateAsync take the record id only. */
export const useDeleteRecord = (projectId, stageKey) => {
  const compat = useCompatMutation(useDeleteRecordMutation);
  return {
    ...compat,
    mutate: (id, opts) => compat.mutate({ id, projectId, stageKey }, opts),
    mutateAsync: (id) => compat.mutateAsync({ id, projectId, stageKey }),
  };
};

/** `useUploadMedia()` — mutate/mutateAsync take `{ file, onProgress }`. */
export const useUploadMedia = () => useCompatMutation(useUploadMediaMutation);

/** `useDestroyMedia()` — mutate/mutateAsync take `{ publicId, resourceType }`. */
export const useDestroyMedia = () => useCompatMutation(useDestroyMediaMutation);

export default recordsApi;
