import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * FMS · Assign Work — who each recurring job in a flow belongs to.
 *
 * ONE READ FOR THE WHOLE SCREEN. Every row needs the same directory of
 * people to choose from, so fetching them per row would be a request per
 * assessment. The board comes back with the catalogue, the current answers
 * and the directory together.
 *
 * SAVING RETURNS THE WHOLE BOARD, and the endpoint is written that way on
 * purpose: putting somebody on a job can change what another row SAYS (a
 * row still on the fallback describes who would get it today), so a
 * response carrying only the row that changed would leave the rest of the
 * screen quietly out of date.
 */
export const fmsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getFmsAssignments: build.query({
      query: () => ({ url: '/fms/assignments', method: 'GET' }),
      providesTags: ['FmsAssignment'],
    }),

    saveFmsAssignment: build.mutation({
      query: ({ item, doers, buddies, note }) => ({
        url: `/fms/assignments/${encodeURIComponent(item)}`,
        method: 'PUT',
        data: { doers, buddies, note },
      }),
      invalidatesTags: ['FmsAssignment'],
    }),

    clearFmsAssignment: build.mutation({
      query: (item) => ({ url: `/fms/assignments/${encodeURIComponent(item)}`, method: 'DELETE' }),
      invalidatesTags: ['FmsAssignment'],
    }),
  }),
});

export const {
  useGetFmsAssignmentsQuery,
  useSaveFmsAssignmentMutation,
  useClearFmsAssignmentMutation,
} = fmsApi;

export const useSaveFmsAssignment = () => useCompatMutation(useSaveFmsAssignmentMutation);
export const useClearFmsAssignment = () => useCompatMutation(useClearFmsAssignmentMutation);

export default fmsApi;
