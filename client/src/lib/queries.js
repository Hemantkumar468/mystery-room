import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './api.js';

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null),
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

/* ---------------- Auth ---------------- */
export const useLogin = () =>
  useMutation({
    mutationFn: (body) => unwrap(api.post('/auth/login', body)),
  });

export const useUsers = (params) =>
  useQuery({
    queryKey: ['users', params],
    queryFn: () => unwrap(api.get(`/auth/users${qs(params)}`)).then((r) => r.data),
  });

/* ---------------- Employees (admin) ---------------- */
/** Any mutation to the directory can change what every picker shows. */
const invalidateUsers = (qc) => qc.invalidateQueries({ queryKey: ['users'] });

export const useCreateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.post('/auth/users', body)).then((r) => r.data),
    onSuccess: () => invalidateUsers(qc),
  });
};

export const useUpdateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => unwrap(api.patch(`/auth/users/${id}`, body)).then((r) => r.data),
    onSuccess: () => invalidateUsers(qc),
  });
};

export const useResetUserPassword = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }) =>
      unwrap(api.post(`/auth/users/${id}/password`, { password })).then((r) => r.data),
    onSuccess: () => invalidateUsers(qc),
  });
};

export const useSetUserStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }) =>
      unwrap(api.patch(`/auth/users/${id}/status`, { isActive })).then((r) => r.data),
    onSuccess: () => invalidateUsers(qc),
  });
};

export const useDeleteUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => unwrap(api.delete(`/auth/users/${id}`)),
    onSuccess: () => invalidateUsers(qc),
  });
};

/* ---------------- Dashboard ---------------- */
export const useDashboard = () =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: () => unwrap(api.get('/pms/dashboard/summary')).then((r) => r.data),
  });

/* ---------------- Templates ---------------- */
export const useTemplates = (params) =>
  useQuery({
    queryKey: ['templates', params],
    queryFn: () => unwrap(api.get(`/pms/templates${qs(params)}`)),
  });

export const useTemplate = (id) =>
  useQuery({
    enabled: !!id,
    queryKey: ['template', id],
    queryFn: () => unwrap(api.get(`/pms/templates/${id}`)).then((r) => r.data),
  });

export const useCreateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.post('/pms/templates', body)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
};

export const useUpdateTemplate = (id) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.patch(`/pms/templates/${id}`, body)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template', id] });
    },
  });
};

export const useDeleteTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => unwrap(api.delete(`/pms/templates/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template', 'default'] });
    },
  });
};

/** The playbook a new project starts from. `data` is null when none is set. */
export const useDefaultTemplate = () =>
  useQuery({
    queryKey: ['template', 'default'],
    queryFn: () => unwrap(api.get('/pms/templates/default')).then((r) => r.data),
  });

/** Promote one template to default; the server demotes whichever held the flag. */
export const useSetDefaultTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => unwrap(api.post(`/pms/templates/${id}/default`)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template'] });
    },
  });
};

/* ---------------- Projects ---------------- */
export const useProjects = (params) =>
  useQuery({
    queryKey: ['projects', params],
    queryFn: () => unwrap(api.get(`/pms/projects${qs(params)}`)),
  });

export const useProject = (id) =>
  useQuery({
    enabled: !!id,
    queryKey: ['project', id],
    queryFn: () => unwrap(api.get(`/pms/projects/${id}`)).then((r) => r.data),
  });

export const useProjectActivity = (id) =>
  useQuery({
    enabled: !!id,
    queryKey: ['project-activity', id],
    queryFn: () => unwrap(api.get(`/pms/projects/${id}/activity`)).then((r) => r.data),
  });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.post('/pms/projects', body)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useUpdateProject = (id) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.patch(`/pms/projects/${id}`, body)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
};

export const useSaveMasterData = (id) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stageKey, values }) =>
      unwrap(api.patch(`/pms/projects/${id}/master-data`, { stageKey, values })).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }),
  });
};

/* ---------------- Records (collection-mode stages, e.g. Phase-1 properties) ---------------- */
/** Rows captured for one collection-mode stage. `status` filters the funnel (undefined = all). */
export const useStageRecords = (projectId, stageKey, status) =>
  useQuery({
    enabled: !!projectId && !!stageKey,
    queryKey: ['records', projectId, stageKey, status || 'all'],
    queryFn: () =>
      unwrap(api.get(`/pms/records${qs({ projectId, stageKey, status })}`)).then((r) => r.data),
  });

/** Invalidate every status slice for a stage's rows, plus the project + its audit feed. */
const invalidateRecords = (qc, projectId, stageKey) => {
  qc.invalidateQueries({ queryKey: ['records', projectId, stageKey] });
  qc.invalidateQueries({ queryKey: ['project', projectId] });
  qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
};

export const useCreateRecord = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      unwrap(api.post('/pms/records', { projectId, stageKey, ...body })).then((r) => r.data),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

export const useUpdateRecord = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      unwrap(api.patch(`/pms/records/${id}`, body)).then((r) => r.data),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

export const useRecordDecision = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }) =>
      unwrap(api.post(`/pms/records/${id}/decision`, { decision, reason })).then((r) => r.data),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

export const useUndoRecordDecision = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      unwrap(api.post(`/pms/records/${id}/undo-decision`)).then((r) => r.data),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

export const useDeleteRecord = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => unwrap(api.delete(`/pms/records/${id}`)),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

/* ---------------- Tasks ---------------- */
export const useBoard = (projectId) =>
  useQuery({
    enabled: !!projectId,
    queryKey: ['board', projectId],
    queryFn: () => unwrap(api.get(`/pms/tasks/board${qs({ project: projectId })}`)).then((r) => r.data),
  });

export const useTasks = (params) =>
  useQuery({
    queryKey: ['tasks', params],
    queryFn: () => unwrap(api.get(`/pms/tasks${qs(params)}`)),
  });

export const useUpdateTaskStatus = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) =>
      unwrap(api.patch(`/pms/tasks/${id}/status`, { status })).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useUpdateTask = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => unwrap(api.patch(`/pms/tasks/${id}`, body)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
};

/* ---------------- MIS ---------------- */
export const useMisPortfolio = () =>
  useQuery({
    queryKey: ['mis', 'portfolio'],
    queryFn: () => unwrap(api.get('/pms/mis/portfolio')).then((r) => r.data),
  });

export const useMisProject = (id) =>
  useQuery({
    enabled: !!id,
    queryKey: ['mis', 'project', id],
    queryFn: () => unwrap(api.get(`/pms/mis/projects/${id}`)).then((r) => r.data),
  });

/* ---------------- Calendar ---------------- */
export const useCalendar = (range) =>
  useQuery({
    queryKey: ['calendar', range],
    queryFn: () => unwrap(api.get(`/pms/calendar/events${qs(range)}`)).then((r) => r.data),
  });
