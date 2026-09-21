import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { useCompatMutation } from './mutationCompat.js';
import { accessLoaded } from '../slices/accessSlice.js';

/**
 * Access Control — the catalogue, the saved policy, and this person's own
 * effective map.
 *
 * TWO AUDIENCES, ONE FILE. `/access/me` is read by every signed-in session on
 * every page load and is what the sidebar, the route gates and the step rails
 * draw from. Everything else is read only by the Settings screen, by the one
 * or two people allowed to open it.
 *
 * WHY ONE TAG FOR ALL OF IT. Saving a role layer changes the role matrix, the
 * per-person preview, AND the editor's own effective map if they edited their
 * own role. Splitting the tag would let one of those three go stale while the
 * other two refreshed, and the one most likely to be missed is the third —
 * which shows up as a sidebar that disagrees with the screen that just
 * changed it.
 */
export const accessApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * What the signed-in person may reach. The map the whole client gates on.
     *
     * `onQueryStarted` commits it to Redux and to the plain mirror in
     * lib/access.js in one step — see accessSlice.js for why there are two
     * copies and why this is the only writer of either.
     */
    getMyAccess: build.query({
      query: () => ({ url: '/access/me', method: 'GET' }),
      providesTags: ['Access'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(accessLoaded(data));
        } catch {
          /* Left alone on purpose. A failed read must NOT clear the map: the
             app would fall back to the static defaults and quietly widen
             everybody's access on a flaky connection. The previous answer
             stands until a fresh one replaces it, and a 401 is already the
             interceptor's job. */
        }
      },
    }),

    /** The registry the Settings screen draws: sections, surfaces, defaults. */
    getAccessCatalog: build.query({
      query: () => ({ url: '/access/catalog', method: 'GET' }),
      providesTags: ['AccessCatalog'],
      /* The catalogue only changes when the app itself ships a new module,
         so it is cached hard rather than re-read alongside the policy. */
      keepUnusedDataFor: 600,
    }),

    /** The five role layers, and everybody carrying a personal override. */
    getAccessPolicy: build.query({
      query: () => ({ url: '/access/policy', method: 'GET' }),
      providesTags: ['AccessPolicy'],
    }),

    /** The people picker — searched, capped, marked with who is overridden. */
    getAccessPeople: build.query({
      query: (params) => ({ url: `/access/people${qs(params)}`, method: 'GET' }),
      providesTags: ['AccessPolicy'],
    }),

    /** What one person actually sees, with the reason for every answer. */
    getAccessPreview: build.query({
      query: (userId) => ({ url: `/access/preview/${userId}`, method: 'GET' }),
      providesTags: ['AccessPolicy'],
    }),

    saveRoleAccess: build.mutation({
      query: ({ role, grants }) => ({ url: `/access/policy/role/${role}`, method: 'PUT', data: { grants } }),
      invalidatesTags: ['AccessPolicy', 'Access'],
    }),

    resetRoleAccess: build.mutation({
      query: (role) => ({ url: `/access/policy/role/${role}/reset`, method: 'POST' }),
      invalidatesTags: ['AccessPolicy', 'Access'],
    }),

    saveUserAccess: build.mutation({
      query: ({ userId, grants, note }) => ({
        url: `/access/policy/user/${userId}`, method: 'PUT', data: { grants, note },
      }),
      invalidatesTags: ['AccessPolicy', 'Access'],
    }),

    clearUserAccess: build.mutation({
      query: (userId) => ({ url: `/access/policy/user/${userId}`, method: 'DELETE' }),
      invalidatesTags: ['AccessPolicy', 'Access'],
    }),
  }),
});

export const {
  useGetMyAccessQuery,
  useGetAccessCatalogQuery,
  useGetAccessPolicyQuery,
  useGetAccessPeopleQuery,
  useGetAccessPreviewQuery,
  useSaveRoleAccessMutation,
  useResetRoleAccessMutation,
  useSaveUserAccessMutation,
  useClearUserAccessMutation,
} = accessApi;

export const useSaveRoleAccess = () => useCompatMutation(useSaveRoleAccessMutation);
export const useResetRoleAccess = () => useCompatMutation(useResetRoleAccessMutation);
export const useSaveUserAccess = () => useCompatMutation(useSaveUserAccessMutation);
export const useClearUserAccess = () => useCompatMutation(useClearUserAccessMutation);

export default accessApi;
