import { baseApi } from './baseApi.js';

/**
 * Approval level 3 — the review surface for one task.
 *
 * Three reads, deliberately separate. The submission is the evidence and must
 * render as fast as it can; the analysis blocks each run their own queries and
 * are the slowest part; the history is only interesting on a resubmission. One
 * combined endpoint would make the common case wait for the rarest one.
 *
 * All three provide the task's own `Task` tag, so approving or rejecting —
 * which invalidates `Task` — refreshes this page and the counts on levels 1
 * and 2 together, with no hard reload. That is the whole reason the decision
 * itself stays on the existing task endpoints rather than being reimplemented
 * here: one mutation, one invalidation, every level correct.
 */
export const approvalsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTaskSubmission: build.query({
      query: (taskId) => ({ url: `/pms/approvals/tasks/${taskId}/submission`, method: 'GET' }),
      providesTags: (_r, _e, taskId) => [{ type: 'Task', id: taskId }],
    }),

    getTaskDecisionHistory: build.query({
      query: (taskId) => ({ url: `/pms/approvals/tasks/${taskId}/history`, method: 'GET' }),
      providesTags: (_r, _e, taskId) => [{ type: 'Task', id: taskId }],
    }),

    getTaskAnalysis: build.query({
      query: (taskId) => ({ url: `/pms/approvals/tasks/${taskId}/analysis`, method: 'GET' }),
      providesTags: (_r, _e, taskId) => [{ type: 'Task', id: taskId }],
    }),
  }),
});

export const {
  useGetTaskSubmissionQuery,
  useGetTaskDecisionHistoryQuery,
  useGetTaskAnalysisQuery,
} = approvalsApi;

export default approvalsApi;
