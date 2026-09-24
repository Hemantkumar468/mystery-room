import { baseApi } from './baseApi.js';
import { qs } from './qs.js';

/**
 * Calendar — Phase 9. `calendar.service.js` builds its event list from both
 * `Task` (deadlines) and `Project` (stage dates) collections directly, but
 * the old React Query layer never invalidated `['calendar']` from anywhere —
 * one of the four missing-invalidation classes the original audit flagged
 * (the others: MyTasks on status change [fixed in Phase 7], Dashboard on
 * stage completion [fixed in Phase 4], and MIS [Phase 10]). Now that
 * `Calendar` exists as a tag, the task/project mutations that actually change
 * a due date or stage date (createTask, updateTask, updateTaskStatus,
 * deleteTask, createProject, updateProject, completeStage, reopenStage) have
 * been updated to invalidate it too — see the `invalidatesTags` changes in
 * tasksApi.js and projectsApi.js alongside this file.
 */
export const calendarApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getCalendar: build.query({
      query: (range) => ({ url: `/pms/calendar/events${qs(range)}`, method: 'GET' }),
      providesTags: ['Calendar'],
    }),
  }),
});

export const { useGetCalendarQuery } = calendarApi;

export const useCalendar = (range) => useGetCalendarQuery(range);

export default calendarApi;
