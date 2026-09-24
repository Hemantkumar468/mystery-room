import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * The game catalogue — a company master, not project data.
 *
 * Read by two pickers that must never disagree: Phase 3B chooses which games an
 * outlet will run, and Phase 10 installs them. Both read this one list, so a
 * game added here appears in both without anyone editing a template.
 */
export const gamesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** `all: true` includes retired games — the master page wants them, the pickers do not. */
    getGames: build.query({
      query: (all) => ({ url: `/pms/games${all ? '?all=1' : ''}`, method: 'GET' }),
      providesTags: ['Game'],
    }),
    createGame: build.mutation({
      query: (body) => ({ url: '/pms/games', method: 'POST', data: body }),
      invalidatesTags: ['Game'],
    }),
    updateGame: build.mutation({
      query: ({ id, ...body }) => ({ url: `/pms/games/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: ['Game'],
    }),
    /** Retires it — projects that ran the game keep reading correctly. */
    retireGame: build.mutation({
      query: (id) => ({ url: `/pms/games/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Game'],
    }),
  }),
});

export const {
  useGetGamesQuery,
  useCreateGameMutation,
  useUpdateGameMutation,
  useRetireGameMutation,
} = gamesApi;

/** Every game the pickers may offer (retired ones excluded unless asked for). */
export const useGames = (all = false) => useGetGamesQuery(all, { skip: false });
export const useCreateGame = () => useCompatMutation(useCreateGameMutation);
export const useUpdateGame = () => useCompatMutation(useUpdateGameMutation);
export const useRetireGame = () => useCompatMutation(useRetireGameMutation);

/** "444 – 450 sq ft", or one figure when both ends agree. */
export function areaLabel(game) {
  const min = game?.minAreaSqft;
  const max = game?.maxAreaSqft;
  if (min == null && max == null) return '';
  const n = (x) => Number(x).toLocaleString('en-IN');
  if (min == null || max == null || min === max) return `${n(max ?? min)} sq ft`;
  return `${n(min)} – ${n(max)} sq ft`;
}
