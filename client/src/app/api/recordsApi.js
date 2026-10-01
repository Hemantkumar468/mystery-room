import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { isValidId } from '../../lib/id.js';
import { useCompatMutation } from './mutationCompat.js';
import { remindTaskChecklist } from './checklistReminder.js';

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

    /**
     * One stage's records across EVERY project — a master list rather than a
     * project-scoped one. `getAllVendors` below is this same query with p12
     * hardcoded; this generic form is what a schema field asks for when it
     * declares `optionsFromStage: { …, scope: 'global' }`.
     */
    getGlobalStageRecords: build.query({
      query: (stageKey) => ({ url: `/pms/records${qs({ stageKey })}`, method: 'GET' }),
      providesTags: (result, _e, stageKey) => [
        { type: 'Record', id: `STAGE-ALL-${stageKey}` },
        ...((result) || []).map((r) => ({ type: 'Record', id: r._id })),
      ],
    }),

    /**
     * Every vendor across every project — the vendor MASTER view. Same shape
     * as getAllProperties: one stage's records with no project filter.
     */
    getAllVendors: build.query({
      query: () => ({ url: `/pms/records${qs({ stageKey: 'p12' })}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Record', id: 'VENDORS_ALL' },
        ...((result) || []).map((r) => ({ type: 'Record', id: r._id })),
      ],
    }),

    /**
     * Just the number waiting, for the sidebar badge.
     *
     * The badge used to subscribe to `getPendingApprovals` and read its
     * length, which meant every page in the app pulled every submitted record
     * in the business - with its project and author - to draw two digits. The
     * count shares the PENDING_ALL tag, so approving something still updates
     * the badge at the same moment it updates the queue.
     */
    getPendingApprovalCount: build.query({
      query: () => ({ url: '/pms/records/pending-count', method: 'GET' }),
      transformResponse: (res) => res?.count ?? res?.data?.count ?? 0,
      providesTags: [{ type: 'Record', id: 'PENDING_ALL' }],
    }),

    /** Every submitted record across every project/stage, for the Dashboard's Pending Approvals panel. */
    getPendingApprovals: build.query({
      query: () => ({ url: `/pms/records${qs({ status: 'submitted' })}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'Record', id: 'PENDING_ALL' },
        ...((result) || []).map((r) => ({ type: 'Record', id: r._id })),
      ],
    }),

    /** Everything already approved, for the Approvals page's history tab. */
    getApprovedRecords: build.query({
      query: () => ({ url: `/pms/records${qs({ status: 'approved' })}`, method: 'GET' }),
      providesTags: [{ type: 'Record', id: 'PENDING_ALL' }],
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
      // A submit made for a task reminds the doer about that task's open checklist.
      onQueryStarted: remindTaskChecklist,
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    updateRecord: build.mutation({
      query: ({ id, projectId, stageKey, ...body }) => ({ url: `/pms/records/${id}`, method: 'PATCH', data: body }),
      onQueryStarted: remindTaskChecklist,
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    /**
     * Tracking fields only (Phase 6 order tracker) — PATCH /records/:id/tracking.
     * Allowed on approved records, unlike updateRecord; the server limits it to
     * the template's `tracker: true` fields and stamps who/when in changeLog.
     */
    updateRecordTracking: build.mutation({
      query: ({ id, projectId, stageKey, ...body }) => ({ url: `/pms/records/${id}/tracking`, method: 'PATCH', data: body }),
      invalidatesTags: (_result, _error, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    /** Append one deposit instalment to a record's ledger. */
    addPayment: build.mutation({
      query: ({ id, projectId, stageKey, ...body }) => ({ url: `/pms/records/${id}/payments`, method: 'POST', data: body }),
      invalidatesTags: (_r, _e, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
    }),

    /** Remove one, for a correction. The removal itself stays in the history. */
    removePayment: build.mutation({
      query: ({ id, paymentId }) => ({ url: `/pms/records/${id}/payments/${paymentId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { projectId, stageKey }) => recordInvalidation(projectId, stageKey),
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
        /* The property queue, which the six Property steps all read. Document
           Approvals' Shortlist approves through here, and without this the row
           it just answered sat on the sheet still asking to be answered — the
           single-record path busts this tag for p1 records, and nothing was
           busting it for a bulk decision at all. Unscoped like its neighbours,
           because a bulk decision can span projects. */
        'PropertyCapture',
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
    // The cross-project master pages for the stages that have one. Without
    // these, adding a property/vendor inside a project never refreshed the
    // global Properties/Vendors views.
    ...(stageKey === 'p1' ? [{ type: 'Record', id: 'PROPERTIES_ALL' }] : []),
    // The Step 1 property queue, which is a server-side union of p1 records
    // and undecided enquiries (propertyCapture.service.js). It owns no data,
    // so nothing else busts it: filing a property from anywhere — the phase
    // page, or the queue's own Capture button — left the queue showing the
    // list as it was before the property existed.
    /* Property FMS derives its six document, approval and project-creation
       rows from p1 together with its p2/p3/p20 children. A p3 decision used
       to refresh only the record detail, leaving Step 6 showing “Review” on a
       document that had just been approved and Step 7 showing stale plan
       state until a hard reload. */
    ...(['p1', 'p2', 'p3', 'p20'].includes(stageKey) ? ['PropertyCapture'] : []),
    ...(stageKey === 'p12' ? [{ type: 'Record', id: 'VENDORS_ALL' }] : []),
    // The GENERIC cross-project list for this stage — getGlobalStageRecords,
    // which is what the Purchase module reads for p13 (a BOQ line IS an
    // order) and what any `optionsFromStage: { scope: 'global' }` field asks
    // for. It was added after the two hardcoded masters above and never got
    // its tag busted here, so a line added from Purchase left the Purchase
    // Orders sheet showing the list as it was before the line existed.
    // Stage-scoped, so it is a no-op for every stage nothing is watching.
    { type: 'Record', id: `STAGE-ALL-${stageKey}` },
  ];
}

export const {
  useGetPendingApprovalCountQuery,
  useGetPendingApprovalsQuery,
  useGetApprovedRecordsQuery,
  useGetAllPropertiesQuery,
  useGetGlobalStageRecordsQuery,
  useGetAllVendorsQuery,
  useGetStageRecordsQuery,
  // Lazy form: for a project that did not exist when the component rendered
  // (a renovation reading back the plan the server just carried over).
  useLazyGetStageRecordsQuery,
  useGetRecordQuery,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useUpdateRecordTrackingMutation,
  useAddPaymentMutation,
  useRemovePaymentMutation,
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

/**
 * Every record of one stage, across all projects. Used by schema fields whose
 * options come from a company-wide master (the BOQ's Vendor picker).
 */
export const useGlobalStageRecords = (stageKey, { enabled } = {}) => {
  const on = enabled !== undefined ? enabled : Boolean(stageKey);
  return useGetGlobalStageRecordsQuery(stageKey, { skip: !on });
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

/** `useUpdateRecordTracking(projectId, stageKey)` — mutate/mutateAsync take `{ id, values, note? }`. */
export const useUpdateRecordTracking = (projectId, stageKey) => {
  const compat = useCompatMutation(useUpdateRecordTrackingMutation);
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

/**
 * `useBulkRecordDecision()` — mutate/mutateAsync take `{ ids, decision,
 * reason?, remarks? }`.
 *
 * No projectId/stageKey, unlike its single-record neighbour: a bulk decision
 * can span projects, so it busts the cross-project tags instead of a pair of
 * per-project ones. See the endpoint's own note.
 */
export const useBulkRecordDecision = () => useCompatMutation(useBulkRecordDecisionMutation);

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

/** `useAddPayment(projectId, stageKey)` — mutate takes `{ id, amount, paidOn, mode, reference, note, proof }`. */
export const useAddPayment = (projectId, stageKey) => {
  const compat = useCompatMutation(useAddPaymentMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId, stageKey }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId, stageKey }),
  };
};

/** `useRemovePayment(projectId, stageKey)` — mutate takes `{ id, paymentId }`. */
export const useRemovePayment = (projectId, stageKey) => {
  const compat = useCompatMutation(useRemovePaymentMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId, stageKey }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId, stageKey }),
  };
};
