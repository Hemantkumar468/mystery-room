import { api, unwrap } from '../../lib/api.js';

/**
 * RTK Query baseQuery that delegates to the app's existing axios instance
 * (`lib/api.js`) rather than using `fetchBaseQuery`.
 *
 * Why: `lib/api.js` already owns the auth path — the Bearer-token request
 * interceptor, and a response interceptor whose single-flight `refreshing`
 * promise deduplicates concurrent 401 refreshes and replays the original
 * request exactly once (`config._retry`). It also carries `withCredentials`
 * for the httpOnly refresh cookie, and unwraps the server's
 * `{ success, data, meta }` envelope.
 *
 * Re-implementing that as a `baseQueryWithReauth` would mean a second HTTP
 * client with its own, subtly different refresh mutex — the highest-risk
 * thing we could do during a migration. Delegating instead means the auth
 * path is byte-identical for React Query and RTK Query, and `lib/api.js` is
 * never modified.
 *
 * Returns RTK Query's `{ data }` / `{ error }` contract. The error shape is
 * normalised here so every consumer (and errorMiddleware) sees the same
 * fields, including the machine-readable `code` the server attaches to every
 * business-rule refusal (e.g. ILLEGAL_TASK_TRANSITION, CLOSURE_NOT_READY).
 */
export const axiosBaseQuery = () => async (args) => {
  const { url, method = 'GET', data, params, headers, onUploadProgress, meta: passthroughMeta } = args;

  try {
    // `unwrap` returns { data, meta } from the server envelope; RTK Query
    // stores `data` and we keep `meta` (pagination) alongside it.
    // `onUploadProgress` is an optional passthrough for multipart uploads
    // (task/record attachments) that need to report 0-100% progress — every
    // other endpoint simply omits it.
    const { data: payload, meta } = await unwrap(
      api({ url, method, data, params, headers, onUploadProgress }),
    );
    return { data: payload, meta: { ...meta, ...passthroughMeta } };
  } catch (err) {
    // A request cancelled by the request interceptor (no access token) has no
    // `response`. Surface it as a 401 so downstream handling is uniform
    // rather than looking like a network fault.
    if (err?.name === 'CanceledError' || err?.message?.includes('No access token')) {
      return { error: { status: 401, code: 'NO_ACCESS_TOKEN', message: 'Not signed in.' } };
    }

    const res = err?.response;
    return {
      error: {
        status: res?.status ?? 0,
        code: res?.data?.code,
        message: res?.data?.message || err?.message || 'Something went wrong.',
        details: res?.data?.details,
      },
    };
  }
};

export default axiosBaseQuery;
