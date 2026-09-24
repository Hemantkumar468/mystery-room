import { baseApi } from './baseApi.js';
import { sessionStarted, userRefreshed } from '../slices/authSlice.js';

/**
 * Auth endpoints — the first module migrated off `lib/queries.js`.
 *
 * `useLogin` in lib/queries.js is now unused and removed with this phase.
 *
 * Note what is deliberately NOT here: the token refresh. That lives in
 * `lib/api.js`'s response interceptor, because it must be able to retry ANY
 * in-flight request transparently — including React Query's, which still
 * powers every other module. Modelling it as an RTK Query endpoint would
 * mean two refresh paths racing on a 401.
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation({
      query: (credentials) => ({ url: '/auth/login', method: 'POST', data: credentials }),
      /**
       * Commit the session here rather than in the component, so every future
       * caller of this endpoint gets the token holder, Redux and localStorage
       * updated identically — the component only decides where to navigate.
       */
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(sessionStarted({ user: data.user, accessToken: data.accessToken }));
      },
    }),

    /**
     * Ends the server session and clears the httpOnly refresh cookie.
     *
     * This endpoint has existed server-side all along and was never called —
     * logout was client-only, so the refresh cookie outlived it. The full
     * cascade (cache clearing, redirect) is owned by `logoutThunk`.
     */
    logout: build.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
    }),

    /**
     * Re-reads the signed-in user. Also previously unused: the persisted user
     * object was trusted verbatim across reloads, so an admin changing
     * someone's role never reached that session until they logged out.
     */
    me: build.query({
      query: () => ({ url: '/auth/me', method: 'GET' }),
      providesTags: ['User'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // The endpoint may return the user directly or wrapped.
          dispatch(userRefreshed(data?.user ?? data));
        } catch {
          // A failure here is not fatal — the interceptor already handles 401,
          // and the persisted user remains usable until it does.
        }
      },
    }),
  }),
});

export const { useLoginMutation, useLogoutMutation, useMeQuery, useLazyMeQuery } = authApi;
