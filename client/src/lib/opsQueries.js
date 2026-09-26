import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, unwrap } from './api.js';

/**
 * Data hooks for the operations modules: org (branches, teams, groups, people,
 * catalog, holidays, notifications, activity), Delegation, Checklist and
 * Performance. Every key starts with 'ops' so one invalidation can refresh
 * everything these screens show.
 */

export const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== 'All'),
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

const get = (url) => unwrap(api.get(url));
const data = (url) => get(url).then((r) => r.data);

/** Invalidate the ops caches touched by a change. */
export function useOpsInvalidate() {
  const qc = useQueryClient();
  return (...scopes) =>
    Promise.all(
      (scopes.length ? scopes : ['delegation', 'checklist', 'performance', 'org']).map((s) =>
        qc.invalidateQueries({ queryKey: ['ops', s] }),
      ),
    );
}

/** Generic mutation that refreshes the given ops scopes on success. */
function useOpsMutation(fn, scopes = ['delegation']) {
  const invalidate = useOpsInvalidate();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate(...scopes, 'notifications'),
  });
}

/* ------------------------------------------------------------------ */
/* Org                                                                 */
/* ------------------------------------------------------------------ */

export const useBranches = (params) =>
  useQuery({
    queryKey: ['ops', 'org', 'branches', params],
    queryFn: () => get(`/org/branches${qs(params)}`),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

export const useSaveBranch = () =>
  useOpsMutation(({ _id, ...body }) => (_id ? unwrap(api.patch(`/org/branches/${_id}`, body)) : unwrap(api.post('/org/branches', body))), ['org']);

export const usePeople = (params) =>
  useQuery({
    queryKey: ['ops', 'org', 'people', params],
    queryFn: () => data(`/org/people${qs(params)}`),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

export const useUpdatePerson = () =>
  useOpsMutation(({ id, ...body }) => unwrap(api.patch(`/org/people/${id}`, body)), ['org']);

export const useTeams = (params) =>
  useQuery({ queryKey: ['ops', 'org', 'teams', params], queryFn: () => data(`/org/teams${qs(params)}`), staleTime: 60_000 });

export const useTeam = (id) =>
  useQuery({ enabled: !!id, queryKey: ['ops', 'org', 'team', id], queryFn: () => data(`/org/teams/${id}`) });

export const useSaveTeam = () =>
  useOpsMutation(({ _id, ...body }) => (_id ? unwrap(api.patch(`/org/teams/${_id}`, body)) : unwrap(api.post('/org/teams', body))), ['org']);
export const useDeleteTeam = () => useOpsMutation((id) => unwrap(api.delete(`/org/teams/${id}`)), ['org']);
export const useUpsertTeamMember = () =>
  useOpsMutation(({ teamId, ...body }) => unwrap(api.post(`/org/teams/${teamId}/members`, body)), ['org']);
export const useRemoveTeamMember = () =>
  useOpsMutation(({ teamId, userId }) => unwrap(api.delete(`/org/teams/${teamId}/members/${userId}`)), ['org']);

export const useGroups = () =>
  useQuery({ queryKey: ['ops', 'org', 'groups'], queryFn: () => data('/org/groups'), staleTime: 60_000 });
export const useGroup = (id) =>
  useQuery({ enabled: !!id, queryKey: ['ops', 'org', 'group', id], queryFn: () => data(`/org/groups/${id}`) });
export const useSaveGroup = () =>
  useOpsMutation(({ _id, ...body }) => (_id ? unwrap(api.patch(`/org/groups/${_id}`, body)) : unwrap(api.post('/org/groups', body))), ['org', 'delegation']);
export const useDeleteGroup = () => useOpsMutation((id) => unwrap(api.delete(`/org/groups/${id}`)), ['org', 'delegation']);

export const useCatalog = (kind) =>
  useQuery({ queryKey: ['ops', 'org', kind], queryFn: () => data(`/org/${kind}`), staleTime: 5 * 60_000 });
export const useSaveCatalog = (kind) =>
  useOpsMutation(({ _id, ...body }) => (_id ? unwrap(api.patch(`/org/${kind}/${_id}`, body)) : unwrap(api.post(`/org/${kind}`, body))), ['org', 'delegation']);
export const useDeleteCatalog = (kind) => useOpsMutation((id) => unwrap(api.delete(`/org/${kind}/${id}`)), ['org']);

export const useHolidays = (params) =>
  useQuery({ queryKey: ['ops', 'org', 'holidays', params], queryFn: () => data(`/org/holidays${qs(params)}`) });
export const useAddHolidays = () => useOpsMutation((body) => unwrap(api.post('/org/holidays', body)), ['org', 'checklist']);
export const useDeleteHoliday = () => useOpsMutation((id) => unwrap(api.delete(`/org/holidays/${id}`)), ['org']);

export const useActivityLog = (params) =>
  useQuery({ queryKey: ['ops', 'org', 'activity', params], queryFn: () => get(`/org/activity${qs(params)}`), placeholderData: keepPreviousData });

/* Notifications — polled so the bell stays live. */
export const useNotifications = () =>
  useQuery({
    queryKey: ['ops', 'notifications'],
    queryFn: () => get('/org/notifications?limit=60'),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
export const useNotificationActions = () => {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ops', 'notifications'] });
  return {
    read: useMutation({ mutationFn: (id) => unwrap(api.post(`/org/notifications/${id}/read`)), onSuccess: refresh }),
    readAll: useMutation({ mutationFn: () => unwrap(api.post('/org/notifications/read-all')), onSuccess: refresh }),
    clear: useMutation({ mutationFn: () => unwrap(api.delete('/org/notifications')), onSuccess: refresh }),
  };
};

/* Files */
export async function uploadFiles(files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f));
  const res = await api.post('/files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data.data; // [{ url, name, size, mimeType }]
}

/* ------------------------------------------------------------------ */
/* Delegation                                                          */
/* ------------------------------------------------------------------ */

export const useDelegations = (params, options = {}) =>
  useQuery({
    queryKey: ['ops', 'delegation', 'list', params],
    queryFn: () => get(`/delegation/tasks${qs(params)}`),
    placeholderData: keepPreviousData,
    ...options,
  });

export const useDelegationSummary = (params) =>
  useQuery({ queryKey: ['ops', 'delegation', 'summary', params], queryFn: () => data(`/delegation/tasks/summary${qs(params)}`) });

export const useDelegation = (id) =>
  useQuery({ enabled: !!id, queryKey: ['ops', 'delegation', 'detail', id], queryFn: () => data(`/delegation/tasks/${id}`) });

export const useDeletedDelegations = (params) =>
  useQuery({ queryKey: ['ops', 'delegation', 'deleted', params], queryFn: () => data(`/delegation/tasks/deleted${qs(params)}`) });

export const useCollaborators = () =>
  useQuery({ queryKey: ['ops', 'delegation', 'collaborators'], queryFn: () => data('/delegation/tasks/collaborators'), staleTime: 5 * 60_000 });

export const useCreateDelegation = () => useOpsMutation((body) => unwrap(api.post('/delegation/tasks', body)), ['delegation', 'performance']);
export const useUpdateDelegation = () =>
  useOpsMutation(({ id, ...body }) => unwrap(api.patch(`/delegation/tasks/${id}`, body)), ['delegation']);
export const useDeleteDelegation = () => useOpsMutation((id) => unwrap(api.delete(`/delegation/tasks/${id}`)), ['delegation']);
export const useRestoreDelegation = () => useOpsMutation((id) => unwrap(api.post(`/delegation/tasks/${id}/restore`)), ['delegation']);

/**
 * One hook for every lifecycle action on a task:
 *   act.mutateAsync({ id, action: 'complete', body: {...} })
 * actions: status | complete | approve | send-back | reopen | due-date |
 *          dependent | blocked | reassign | comments | management-remark |
 *          coordinator-note | followups
 */
export const useDelegationAction = () =>
  useOpsMutation(({ id, action, body }) => unwrap(api.post(`/delegation/tasks/${id}/${action}`, body || {})), ['delegation', 'performance']);

export const useSaveReminders = () =>
  useOpsMutation(({ id, reminders }) => unwrap(api.put(`/delegation/tasks/${id}/reminders`, { reminders })), ['delegation']);

export const useTemplates = () =>
  useQuery({ queryKey: ['ops', 'delegation', 'templates'], queryFn: () => data('/delegation/templates'), staleTime: 60_000 });
export const useSaveTemplate = () =>
  useOpsMutation(({ _id, ...body }) => (_id ? unwrap(api.patch(`/delegation/templates/${_id}`, body)) : unwrap(api.post('/delegation/templates', body))), ['delegation']);
export const useDeleteTemplate = () => useOpsMutation((id) => unwrap(api.delete(`/delegation/templates/${id}`)), ['delegation']);

export const useRecurrences = (params) =>
  useQuery({ queryKey: ['ops', 'delegation', 'recurrences', params], queryFn: () => data(`/delegation/recurrences${qs(params)}`) });
export const useRecurrence = (id) =>
  useQuery({ enabled: !!id, queryKey: ['ops', 'delegation', 'recurrence', id], queryFn: () => data(`/delegation/recurrences/${id}`) });
export const useUpdateRecurrence = () =>
  useOpsMutation(({ id, ...body }) => unwrap(api.patch(`/delegation/recurrences/${id}`, body)), ['delegation']);
export const previewRecurrence = (rule) => unwrap(api.post('/delegation/recurrences/preview', rule)).then((r) => r.data);

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

export const useChecklistTasks = (params, options = {}) =>
  useQuery({
    queryKey: ['ops', 'checklist', 'tasks', params],
    queryFn: () => get(`/checklist/tasks${qs(params)}`),
    placeholderData: keepPreviousData,
    ...options,
  });
export const useChecklistTask = (id) =>
  useQuery({ enabled: !!id, queryKey: ['ops', 'checklist', 'task', id], queryFn: () => data(`/checklist/tasks/${id}`) });
export const useChecklistRoutine = (id) =>
  useQuery({ enabled: !!id, queryKey: ['ops', 'checklist', 'routine', id], queryFn: () => data(`/checklist/routines/${id}`) });
export const useChecklistSummary = (params) =>
  useQuery({ queryKey: ['ops', 'checklist', 'summary', params], queryFn: () => data(`/checklist/summary${qs(params)}`) });
export const useChecklistRoutines = (params, options = {}) =>
  useQuery({ queryKey: ['ops', 'checklist', 'routines', params], queryFn: () => data(`/checklist/routines${qs(params)}`), ...options });
export const useChecklistDepartments = (params) =>
  useQuery({ queryKey: ['ops', 'checklist', 'departments', params], queryFn: () => data(`/checklist/departments${qs(params)}`), staleTime: 5 * 60_000 });
export const useChecklistReport = (params, options = {}) =>
  useQuery({ queryKey: ['ops', 'checklist', 'report', params], queryFn: () => data(`/checklist/report/departments${qs(params)}`), ...options });
export const useChecklistSites = (params) =>
  useQuery({ queryKey: ['ops', 'checklist', 'sites', params], queryFn: () => data(`/checklist/sites${qs(params)}`), staleTime: 60_000 });

export const useCreateRoutine = () => useOpsMutation((body) => unwrap(api.post('/checklist/routines', body)), ['checklist', 'performance']);
export const useUpdateRoutine = () =>
  useOpsMutation(({ id, ...body }) => unwrap(api.patch(`/checklist/routines/${id}`, body)), ['checklist']);
export const useStopRoutine = () => useOpsMutation((id) => unwrap(api.delete(`/checklist/routines/${id}`)), ['checklist']);
/** actions: complete | non-functional | reassign */
export const useChecklistAction = () =>
  useOpsMutation(({ id, action, body }) => unwrap(api.post(`/checklist/tasks/${id}/${action}`, body || {})), ['checklist', 'performance']);
export const useChecklistRemarks = () => useOpsMutation((body) => unwrap(api.post('/checklist/tasks/remarks', body)), ['checklist']);
export const useSaveSite = () =>
  useOpsMutation(({ _id, ...body }) => (_id ? unwrap(api.patch(`/checklist/sites/${_id}`, body)) : unwrap(api.post('/checklist/sites', body))), ['checklist']);
export const useRemoveSite = () => useOpsMutation((id) => unwrap(api.delete(`/checklist/sites/${id}`)), ['checklist']);

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export const useKra = (params) =>
  useQuery({ queryKey: ['ops', 'performance', 'kra', params], queryFn: () => data(`/performance/kra${qs(params)}`) });
export const useScoreboard = (params) =>
  useQuery({
    queryKey: ['ops', 'performance', 'scoreboard', params],
    queryFn: () => data(`/performance/scoreboard${qs(params)}`),
    refetchInterval: 60_000,
  });
