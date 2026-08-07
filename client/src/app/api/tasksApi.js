import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Tasks domain — Phase 5. Same pattern as projectsApi.js: read endpoints
 * exposed under their old hook names as signature-compatible RTK Query
 * wrappers; mutations go through `useCompatMutation` so the many
 * mutate/mutateAsync/isPending call sites (including task/record approval
 * decisions) don't need rewriting alongside the data-layer swap.
 *
 * `useUpdateTaskStatus` is the one pre-existing optimistic update in the old
 * React Query layer (Kanban drag) — reimplemented here with `onQueryStarted`
 * + `updateQueryData('getBoard', ...)` instead of `onMutate`/`setQueryData`,
 * same rollback-on-error behaviour.
 */
export const tasksApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getBoard: build.query({
      query: (projectId) => ({ url: `/pms/tasks/board${qs({ project: projectId })}`, method: 'GET' }),
      providesTags: (_result, _error, projectId) => [{ type: 'Board', id: projectId }],
    }),

    getTasks: build.query({
      query: (params) => ({ url: `/pms/tasks${qs(params)}`, method: 'GET' }),
      // Old hook returned the full envelope ({data, meta}) as `data` — preserved.
      transformResponse: (payload, meta) => ({ data: payload, meta }),
      providesTags: (result) => [
        { type: 'Task', id: 'LIST' },
        ...((result?.data) || []).map((t) => ({ type: 'Task', id: t._id })),
      ],
    }),

    getTask: build.query({
      query: (id) => ({ url: `/pms/tasks/${id}`, method: 'GET' }),
      providesTags: (_result, _error, id) => [{ type: 'Task', id }],
    }),

    getTaskByCode: build.query({
      query: (code) => ({ url: `/pms/tasks/by-code/${encodeURIComponent(code)}`, method: 'GET' }),
      // Tag by the resolved task's real id, not the code — so a mutation that
      // invalidates {type:'Task', id} (the normal id-based path) also busts
      // this cache entry, even though it was fetched by its human-readable
      // code. The old React Query layer could only invalidate the whole
      // ['task-by-code'] prefix; this is strictly more precise.
      providesTags: (result) => (result?._id ? [{ type: 'Task', id: result._id }] : []),
    }),

    /**
     * Everything assigned to the signed-in user: `{ open, recentlyDone }`.
     *
     * The old `transformResponse` re-wrapped the payload as `{ data, meta }`,
     * a shape nothing consumed — this endpoint had no call sites at all until
     * the My Tasks page. Returning the payload as-is matches every other
     * endpoint here.
     */
    getMyTasks: build.query({
      query: (params) => ({ url: `/pms/tasks/mine${qs(params)}`, method: 'GET' }),
      providesTags: ['MyTasks'],
    }),

    createTask: build.mutation({
      query: ({ projectId, ...body }) => ({ url: '/pms/tasks', method: 'POST', data: { project: projectId, ...body } }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Task', id: 'LIST' },
        'MyTasks',
        { type: 'Board', id: projectId },
        { type: 'Project', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'ClosureReadiness', id: projectId },
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),

    updateTaskStatus: build.mutation({
      query: ({ id, status }) => ({ url: `/pms/tasks/${id}/status`, method: 'PATCH', data: { status } }),
      async onQueryStarted({ id, status, projectId }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          tasksApi.util.updateQueryData('getBoard', projectId, (draft) => {
            if (!draft?.columns) return;
            let moving;
            draft.columns.forEach((col) => {
              const idx = col.tasks.findIndex((t) => t._id === id);
              if (idx !== -1) [moving] = col.tasks.splice(idx, 1);
            });
            if (!moving) return;
            const target = draft.columns.find((col) => col.status === status);
            if (target) target.tasks.push({ ...moving, status });
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: (_result, _error, { id, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Project', id: projectId },
        { type: 'Activity', id: projectId },
        'Dashboard',
        'Mis',
        'MyTasks',
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id },
        { type: 'ClosureReadiness', id: projectId },
        'Calendar',
      ],
    }),

    /**
     * Move many tasks to one status in a single request — what the Store
     * Readiness checklist's "Complete selected" uses.
     *
     * No optimistic patch here, unlike updateTaskStatus above: the server may
     * land each id on a *different* status than asked (marking done
     * auto-submits to waiting_approval, and any id can legitimately fail), so
     * the only honest local state is what comes back. Invalidating the same
     * tag set the single-task mutation does is what refreshes the rows.
     */
    bulkTaskStatus: build.mutation({
      query: ({ ids, status }) => ({ url: '/pms/tasks/bulk-status', method: 'POST', data: { ids, status } }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Project', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'ClosureReadiness', id: projectId },
        { type: 'Task', id: 'LIST' },
        'MyTasks',
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),

    updateTask: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/tasks/${id}`, method: 'PATCH', data: body }),
      // update() is also the code path status changes go through server-side
      // (task.service.js stamps actualStart/actualEnd/completedOnTime here),
      // so this needs the same Dashboard/Mis coverage updateTaskStatus has.
      invalidatesTags: (_result, _error, { id, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id },
        { type: 'Project', id: projectId },
        { type: 'Activity', id: projectId },
        'MyTasks',
        { type: 'ClosureReadiness', id: projectId },
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),

    deleteTask: build.mutation({
      query: ({ id }) => ({ url: `/pms/tasks/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, { id, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id },
        { type: 'Project', id: projectId },
        'MyTasks',
        { type: 'ClosureReadiness', id: projectId },
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),

    uploadTaskAttachment: build.mutation({
      query: ({ taskId, file, onProgress }) => {
        const form = new FormData();
        form.append('file', file);
        return {
          url: `/pms/tasks/${taskId}/attachments`,
          method: 'POST',
          data: form,
          onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100)); },
        };
      },
      invalidatesTags: (_result, _error, { taskId, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id: taskId },
      ],
    }),

    deleteTaskAttachment: build.mutation({
      query: ({ taskId, attachmentId }) => ({ url: `/pms/tasks/${taskId}/attachments/${attachmentId}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, { taskId, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id: taskId },
      ],
    }),

    addTaskComment: build.mutation({
      query: ({ taskId, body }) => ({ url: `/pms/tasks/${taskId}/comments`, method: 'POST', data: { body } }),
      invalidatesTags: (_result, _error, { taskId, projectId }) => [
        { type: 'Activity', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id: taskId },
      ],
    }),

    addTaskUpdate: build.mutation({
      query: ({ taskId, body, photos = [], onProgress }) => {
        const form = new FormData();
        form.append('body', body || '');
        for (const file of photos) form.append('photos', file);
        return {
          url: `/pms/tasks/${taskId}/updates`,
          method: 'POST',
          data: form,
          onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100)); },
        };
      },
      invalidatesTags: (_result, _error, { taskId, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id: taskId },
      ],
    }),

    // Both of these move a task across the approval boundary (waiting-approval
    // ⇄ completed/rejected-back-to-assignee), which is exactly the kind of
    // status change the assignee's "My Tasks" view needs to reflect — the old
    // React Query layer never invalidated `my-tasks` here, only on create.
    submitTaskForApproval: build.mutation({
      query: ({ taskId }) => ({ url: `/pms/tasks/${taskId}/submit-approval`, method: 'POST' }),
      invalidatesTags: (_result, _error, { taskId, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id: taskId },
        { type: 'Project', id: projectId },
        'MyTasks',
        { type: 'ClosureReadiness', id: projectId },
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),

    taskDecision: build.mutation({
      query: ({ taskId, decision, reason, remarks, signature }) => ({
        url: `/pms/tasks/${taskId}/decision`,
        method: 'POST',
        data: { decision, reason, remarks, signature },
      }),
      invalidatesTags: (_result, _error, { taskId, projectId }) => [
        { type: 'Board', id: projectId },
        { type: 'Activity', id: projectId },
        { type: 'Task', id: 'LIST' },
        { type: 'Task', id: taskId },
        { type: 'Project', id: projectId },
        'MyTasks',
        { type: 'ClosureReadiness', id: projectId },
        'Calendar',
        'Dashboard',
        'Mis',
      ],
    }),
  }),
});

export const {
  useGetBoardQuery,
  useGetTasksQuery,
  useGetTaskQuery,
  useGetTaskByCodeQuery,
  useGetMyTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskStatusMutation,
  useBulkTaskStatusMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useUploadTaskAttachmentMutation,
  useDeleteTaskAttachmentMutation,
  useAddTaskCommentMutation,
  useAddTaskUpdateMutation,
  useSubmitTaskForApprovalMutation,
  useTaskDecisionMutation,
} = tasksApi;

/* ---------- Old-name read wrappers ---------- */

export const useBoard = (projectId) => useGetBoardQuery(projectId, { skip: !projectId });

export const useTasks = (params) => useGetTasksQuery(params);

export const useTask = (id) => useGetTaskQuery(id, { skip: !id });

export const useTaskByCode = (code) => useGetTaskByCodeQuery(code, { skip: !code });

export const useMyTasks = (params) => useGetMyTasksQuery(params);

/* ---------- Old-name mutation wrappers ---------- */

/** `useCreateTask(projectId)` — mutate/mutateAsync take the new task's body. */
export const useCreateTask = (projectId) => {
  const compat = useCompatMutation(useCreateTaskMutation);
  return {
    ...compat,
    mutate: (body, opts) => compat.mutate({ projectId, ...body }, opts),
    mutateAsync: (body) => compat.mutateAsync({ projectId, ...body }),
  };
};

/** `useUpdateTaskStatus(projectId)` — mutate/mutateAsync take `{ id, status }`. */
export const useUpdateTaskStatus = (projectId) => {
  const compat = useCompatMutation(useUpdateTaskStatusMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useBulkTaskStatus(projectId)` — mutateAsync takes `{ ids, status }`, resolves `{ succeeded, failed }`. */
export const useBulkTaskStatus = (projectId) => {
  const compat = useCompatMutation(useBulkTaskStatusMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useUpdateTask(projectId)` — mutate/mutateAsync take `{ id, ...body }`. */
export const useUpdateTask = (projectId) => {
  const compat = useCompatMutation(useUpdateTaskMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useDeleteTask(projectId)` — mutate/mutateAsync take the task id only. */
export const useDeleteTask = (projectId) => {
  const compat = useCompatMutation(useDeleteTaskMutation);
  return {
    ...compat,
    mutate: (id, opts) => compat.mutate({ id, projectId }, opts),
    mutateAsync: (id) => compat.mutateAsync({ id, projectId }),
  };
};

/** `useUploadTaskAttachment(projectId)` — mutate/mutateAsync take `{ taskId, file, onProgress }`. */
export const useUploadTaskAttachment = (projectId) => {
  const compat = useCompatMutation(useUploadTaskAttachmentMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useDeleteTaskAttachment(projectId)` — mutate/mutateAsync take `{ taskId, attachmentId }`. */
export const useDeleteTaskAttachment = (projectId) => {
  const compat = useCompatMutation(useDeleteTaskAttachmentMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useAddTaskComment(projectId)` — mutate/mutateAsync take `{ taskId, body }`. */
export const useAddTaskComment = (projectId) => {
  const compat = useCompatMutation(useAddTaskCommentMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useAddTaskUpdate(projectId)` — mutate/mutateAsync take `{ taskId, body, photos, onProgress }`. */
export const useAddTaskUpdate = (projectId) => {
  const compat = useCompatMutation(useAddTaskUpdateMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

/** `useSubmitTaskForApproval(projectId)` — mutate/mutateAsync take the task id only. */
export const useSubmitTaskForApproval = (projectId) => {
  const compat = useCompatMutation(useSubmitTaskForApprovalMutation);
  return {
    ...compat,
    mutate: (taskId, opts) => compat.mutate({ taskId, projectId }, opts),
    mutateAsync: (taskId) => compat.mutateAsync({ taskId, projectId }),
  };
};

/** `useTaskDecision(projectId)` — mutate/mutateAsync take `{ taskId, decision, reason, remarks, signature }`. */
export const useTaskDecision = (projectId) => {
  const compat = useCompatMutation(useTaskDecisionMutation);
  return {
    ...compat,
    mutate: (vars, opts) => compat.mutate({ ...vars, projectId }, opts),
    mutateAsync: (vars) => compat.mutateAsync({ ...vars, projectId }),
  };
};

export default tasksApi;
