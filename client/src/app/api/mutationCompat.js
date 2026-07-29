import { useCallback } from 'react';

/**
 * Adapts an RTK Query mutation hook to the `useMutation`-shaped surface every
 * business page in this app already calls against: `.mutate(vars, {onSuccess,
 * onError})`, `.mutateAsync(vars)`, `.isPending`, `.isSuccess`, `.isError`,
 * `.error`, `.reset()`.
 *
 * Why this exists: dozens of call sites across Projects/Tasks/Records use the
 * mutate-with-callback style (`stage.mutate(key, { onSuccess, onError })`),
 * not a bare trigger+promise. Rewriting every one of those call sites in the
 * same pass as swapping the data layer underneath them would multiply the
 * surface area for regressions in business-critical, phase-gating code
 * (stage completion, archive, task/record decisions — see the permanent
 * "phase gating rules" standard: task actions must never complete a phase,
 * eligibility gates must never blank the page). This wrapper changes NOTHING
 * about caching, fetching or invalidation — it is a 1:1 pass-through to the
 * real RTK Query mutation hook/trigger. It only re-shapes ergonomics and
 * normalizes the error back to the axios shape (`err.response.data.message`)
 * every `apiErrorMessage`-style helper in the app already expects, so no
 * error-handling call site needs to change either.
 *
 * This is NOT a "custom API hook outside RTK Query" in the sense the project
 * standard forbids — it wraps RTK Query's own generated hook and does not
 * fetch, cache or dedupe anything itself. It exists purely so business logic
 * (300+ call sites written against React Query's mutation ergonomics) can be
 * ported to the new data layer without a second, parallel rewrite of every
 * button handler at the same time.
 */
function toAxiosLikeError(rtkError) {
  if (!rtkError) return rtkError;
  return {
    response: {
      status: rtkError.status,
      data: { message: rtkError.message, code: rtkError.code, details: rtkError.details },
    },
    message: rtkError.message,
  };
}

export function useCompatMutation(useRtkMutationHook, arg) {
  const [trigger, state] = useRtkMutationHook(arg);

  const mutateAsync = useCallback(
    async (variables) => {
      try {
        return await trigger(variables).unwrap();
      } catch (err) {
        throw toAxiosLikeError(err);
      }
    },
    [trigger],
  );

  const mutate = useCallback(
    (variables, opts = {}) => {
      const { onSuccess, onError } = opts;
      mutateAsync(variables).then(onSuccess, (err) => {
        if (onError) onError(err);
      });
    },
    [mutateAsync],
  );

  return {
    mutate,
    mutateAsync,
    isPending: state.isLoading,
    isSuccess: state.isSuccess,
    isError: state.isError,
    error: toAxiosLikeError(state.error),
    reset: state.reset,
  };
}

export default useCompatMutation;
