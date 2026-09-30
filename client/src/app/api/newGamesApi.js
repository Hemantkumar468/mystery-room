import { baseApi } from './baseApi.js';
import { api } from '../../lib/api.js';

/**
 * New Games Creation FMS — /new-games.
 *
 * Every write returns the game's fresh view, and invalidates My Tasks too: a
 * step finished here is a row that has to leave somebody's My Tasks, and a
 * step it opens is a row that has to arrive on somebody else's.
 */
const TAGS = ['NewGame', 'MyTasks'];

export const newGamesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getNewGames: build.query({
      query: (params = {}) => ({ url: '/new-games', method: 'GET', params }),
      providesTags: ['NewGame'],
    }),
    getNewGame: build.query({
      query: (id) => ({ url: `/new-games/${id}`, method: 'GET' }),
      providesTags: ['NewGame'],
    }),
    getNewGamePeople: build.query({
      query: () => ({ url: '/new-games/people', method: 'GET' }),
      keepUnusedDataFor: 600,
    }),
    createNewGame: build.mutation({
      query: (data) => ({ url: '/new-games', method: 'POST', data }),
      invalidatesTags: TAGS,
    }),
    updateNewGame: build.mutation({
      query: ({ id, ...data }) => ({ url: `/new-games/${id}`, method: 'PATCH', data }),
      invalidatesTags: TAGS,
    }),
    watchNewGame: build.mutation({
      query: (id) => ({ url: `/new-games/${id}/watch`, method: 'POST' }),
      invalidatesTags: TAGS,
    }),
    addNewGameBoq: build.mutation({
      query: ({ id, ...data }) => ({ url: `/new-games/${id}/boqs`, method: 'POST', data }),
      invalidatesTags: TAGS,
    }),
    updateNewGameBoq: build.mutation({
      query: ({ id, boqId, ...data }) => ({ url: `/new-games/${id}/boqs/${boqId}`, method: 'PATCH', data }),
      invalidatesTags: TAGS,
    }),
    removeNewGameBoq: build.mutation({
      query: ({ id, boqId }) => ({ url: `/new-games/${id}/boqs/${boqId}`, method: 'DELETE' }),
      invalidatesTags: TAGS,
    }),
    decideNewGameBoq: build.mutation({
      query: ({ id, boqId, decision, reason }) => ({
        url: `/new-games/${id}/boqs/${boqId}/decision`, method: 'POST', data: { decision, reason },
      }),
      invalidatesTags: TAGS,
    }),
    completeNewGameStep: build.mutation({
      query: ({ id, step, note }) => ({ url: `/new-games/${id}/steps/${step}/done`, method: 'POST', data: { note } }),
      invalidatesTags: TAGS,
    }),
    sendNewGameToPurchase: build.mutation({
      query: (id) => ({ url: `/new-games/${id}/send-to-purchase`, method: 'POST' }),
      invalidatesTags: TAGS,
    }),
    assignNewGameStep: build.mutation({
      query: ({ id, step, doers }) => ({ url: `/new-games/${id}/steps/${step}/assign`, method: 'PUT', data: { doers } }),
      invalidatesTags: TAGS,
    }),
  }),
});

export const {
  useGetNewGamesQuery,
  useGetNewGameQuery,
  useGetNewGamePeopleQuery,
  useCreateNewGameMutation,
  useUpdateNewGameMutation,
  useWatchNewGameMutation,
  useAddNewGameBoqMutation,
  useUpdateNewGameBoqMutation,
  useRemoveNewGameBoqMutation,
  useDecideNewGameBoqMutation,
  useCompleteNewGameStepMutation,
  useAssignNewGameStepMutation,
  useSendNewGameToPurchaseMutation,
} = newGamesApi;

/** Reference videos go through their own endpoint: the general upload stops at 15 MB. */
export async function uploadGameVideos(files, onProgress) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f));
  const res = await api.post('/new-games/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress
      ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
      : undefined,
  });
  return res.data.data; // [{ url, name, size }]
}

export default newGamesApi;
