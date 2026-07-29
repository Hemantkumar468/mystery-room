import { baseApi } from './baseApi.js';
import { qs } from './qs.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Users / Employees directory — wasn't named as its own phase in the
 * migration order (the plan's ten phases cover the PMS business modules),
 * but Final Cleanup requires `lib/queries.js` to be empty, and this is the
 * only real implementation left in it. Same pattern as every other domain
 * file.
 */
export const usersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getUsers: build.query({
      query: (params) => ({ url: `/auth/users${qs(params)}`, method: 'GET' }),
      providesTags: (result) => [
        { type: 'User', id: 'LIST' },
        ...((result) || []).map((u) => ({ type: 'User', id: u._id })),
      ],
    }),

    createUser: build.mutation({
      query: (body) => ({ url: '/auth/users', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'User', id: 'LIST' }],
    }),

    updateUser: build.mutation({
      query: ({ id, ...body }) => ({ url: `/auth/users/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'User', id: 'LIST' }, { type: 'User', id }],
    }),

    resetUserPassword: build.mutation({
      query: ({ id, password }) => ({ url: `/auth/users/${id}/password`, method: 'POST', data: { password } }),
      invalidatesTags: [{ type: 'User', id: 'LIST' }],
    }),

    setUserStatus: build.mutation({
      query: ({ id, isActive }) => ({ url: `/auth/users/${id}/status`, method: 'PATCH', data: { isActive } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'User', id: 'LIST' }, { type: 'User', id }],
    }),

    deleteUser: build.mutation({
      query: (id) => ({ url: `/auth/users/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'User', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useResetUserPasswordMutation,
  useSetUserStatusMutation,
  useDeleteUserMutation,
} = usersApi;

export const useUsers = (params) => useGetUsersQuery(params);

export const useCreateUser = () => useCompatMutation(useCreateUserMutation);
export const useUpdateUser = () => useCompatMutation(useUpdateUserMutation);
export const useResetUserPassword = () => useCompatMutation(useResetUserPasswordMutation);
export const useSetUserStatus = () => useCompatMutation(useSetUserStatusMutation);
export const useDeleteUser = () => useCompatMutation(useDeleteUserMutation);

export default usersApi;
