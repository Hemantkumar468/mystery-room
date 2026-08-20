import { baseApi } from './baseApi.js';
import { qs } from './qs.js';

/**
 * Gantt timeline (client doc §9.2).
 *
 * One endpoint serves both scopes: omit `project` for the portfolio timeline,
 * pass it for a single project. `level: 'task'` explodes phases into their
 * tasks and is only honoured with a `project` — the server refuses to draw
 * every task of every project on one canvas.
 *
 * Every filter is part of the cache key, so changing one refetches rather than
 * reusing the previous slice's rows.
 */
export const ganttApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getGantt: build.query({
      query: (params = {}) => ({ url: `/pms/gantt${qs(params)}`, method: 'GET' }),
      providesTags: ['Gantt'],
    }),
  }),
});

export const { useGetGanttQuery } = ganttApi;

export const useGantt = (params, enabled = true) =>
  useGetGanttQuery(params ?? {}, { skip: !enabled });

export default ganttApi;
