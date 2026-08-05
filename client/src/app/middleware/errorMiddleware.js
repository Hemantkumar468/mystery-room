import { isRejectedWithValue } from '@reduxjs/toolkit';
import { toastPushed } from '../slices/notificationSlice.js';

/**
 * Turns a failed RTK Query request into a single, consistent toast.
 *
 * The server attaches a machine-readable `code` to essentially every
 * business-rule refusal (ILLEGAL_TASK_TRANSITION, MANDATORY_MODULES_PENDING,
 * CIRCULAR_DEPENDENCY, SELF_APPROVAL, DUPLICATE_TASK, P4_NOT_COMPLETE …),
 * and several carry a `details` array naming the exact blocking items.
 * `axiosBaseQuery` preserves all of it; today the client throws it away and
 * renders `err?.response?.data?.message` as a flat string.
 */

/**
 * Refusals that are an ANSWER, not a failure.
 *
 * The phase-gate endpoints exist precisely to say "not yet, and here is why".
 * Those pages render the reasons inline as page content, so a toast on top
 * would be noise — and would fire every time someone opens a phase that
 * isn't ready yet. Individual requests can also opt out by passing
 * `silentError: true` in their args.
 */
export const EXPECTED_CODES = new Set([
  'CLOSURE_NOT_READY',
  'LAUNCH_NOT_READY',
  'READINESS_NOT_READY',
  'APPROVAL_NOT_READY',
  'EXECUTION_NOT_READY',
  'ARCHIVE_NOT_READY',
  'NO_RECORDS',
  'NO_TASKS_ALLOCATED',
  'NO_APPROVED_PROPERTY',
  'NO_FINALIZED_PROPERTY',
  'PROJECT_SETUP_NOT_APPROVED',
  'MANDATORY_MODULES_PENDING',
  'INCOMPLETE_ALLOCATION',
  'NO_MANDATORY_MODULES',
  'P4_NOT_COMPLETE',
]);

/** True when a rejected action should NOT raise a toast. */
export function isSilent(action) {
  const { status, code } = action.payload || {};
  // 401 is handled end-to-end by lib/api.js — it refreshes once and replays,
  // and logs out if the refresh itself fails. A toast would just add noise to
  // an expected re-auth.
  if (status === 401) return true;
  if (action.meta?.arg?.originalArgs?.silentError) return true;
  return EXPECTED_CODES.has(code);
}

export const createErrorMiddleware = () => (storeApi) => (next) => (action) => {
  if (!isRejectedWithValue(action)) return next(action);

  // Let the rejection reach the reducers first so component state (isError,
  // error) is already correct by the time the toast renders.
  const result = next(action);
  if (isSilent(action)) return result;

  const { code, message, details } = action.payload || {};
  storeApi.dispatch(
    toastPushed({
      kind: 'error',
      message: message || 'Something went wrong.',
      // `details` is usually the list of specific blockers (missing modules,
      // blocking dependency codes) — worth showing verbatim. It can also be
      // an array of { field, message } (validate.js's zod issue shape) —
      // stringify each entry properly instead of letting Array.join coerce
      // an object to the literal string "[object Object]".
      detail: Array.isArray(details)
        ? details
          .map((d) => (typeof d === 'string' ? d : [d.field, d.message].filter(Boolean).join(': ')))
          .join(', ')
        : undefined,
      code,
      timeout: 6000,
    }),
  );

  return result;
};

export default createErrorMiddleware;
