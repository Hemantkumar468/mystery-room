import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './api.js';

// A stray `undefined`/`null` reaching a template literal (e.g. a URL built
// with `${maybeMissingId}`) stringifies to the literal text "undefined" /
// "null" — a plain `!!id` truthiness check doesn't catch that. Route params
// and ids threaded through props should be checked with this instead.
export const isValidId = (v) => typeof v === 'string' && v.length > 0 && v !== 'undefined' && v !== 'null';

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== 'undefined' && v !== 'null'),
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
    enabled: isValidId(id),
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
    enabled: isValidId(id),
    queryKey: ['project', id],
    queryFn: () => unwrap(api.get(`/pms/projects/${id}`)).then((r) => r.data),
  });

export const useProjectActivity = (id) =>
  useQuery({
    enabled: isValidId(id),
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

const invalidateProject = (qc, id) => {
  qc.invalidateQueries({ queryKey: ['project', id] });
  qc.invalidateQueries({ queryKey: ['project-activity', id] });
  qc.invalidateQueries({ queryKey: ['projects'] });
};

export const useCompleteStage = (id) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stageKey) =>
      unwrap(api.post(`/pms/projects/${id}/stages/${stageKey}/complete`)).then((r) => r.data),
    onSuccess: () => invalidateProject(qc, id),
  });
};

export const useReopenStage = (id) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stageKey) =>
      unwrap(api.post(`/pms/projects/${id}/stages/${stageKey}/reopen`)).then((r) => r.data),
    onSuccess: () => invalidateProject(qc, id),
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

/* ---------------- Tasks ---------------- */
export const useBoard = (projectId) =>
  useQuery({
    enabled: isValidId(projectId),
    queryKey: ['board', projectId],
    queryFn: () => unwrap(api.get(`/pms/tasks/board${qs({ project: projectId })}`)).then((r) => r.data),
  });

export const useTasks = (params) =>
  useQuery({
    queryKey: ['tasks', params],
    queryFn: () => unwrap(api.get(`/pms/tasks${qs(params)}`)),
  });

export const useTask = (id) =>
  useQuery({
    enabled: isValidId(id),
    queryKey: ['task', id],
    queryFn: () => unwrap(api.get(`/pms/tasks/${id}`)).then((r) => r.data),
  });

/** Same task detail as useTask, looked up by its human-readable `code`
 * (e.g. MR-BHO-001-T052) — backs the URL-friendly /projects/:id/tasks/:code
 * route so no raw Mongo id appears in the URL. */
export const useTaskByCode = (code) =>
  useQuery({
    enabled: !!code,
    queryKey: ['task-by-code', code],
    queryFn: () => unwrap(api.get(`/pms/tasks/by-code/${encodeURIComponent(code)}`)).then((r) => r.data),
  });

/** Tasks assigned to the current user (the `/mine` endpoint), soonest first. */
export const useMyTasks = (params) =>
  useQuery({
    queryKey: ['my-tasks', params],
    queryFn: () => unwrap(api.get(`/pms/tasks/mine${qs(params)}`)),
  });

/** Allocate (create) a task at runtime — Phase 5 department planning. */
export const useCreateTask = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.post('/pms/tasks', { project: projectId, ...body })).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
    },
  });
};

export const useUpdateTaskStatus = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) =>
      unwrap(api.patch(`/pms/tasks/${id}/status`, { status })).then((r) => r.data),
    // Optimistically move the task into its new status column; roll back on error.
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['board', projectId] });
      const previous = qc.getQueryData(['board', projectId]);
      qc.setQueryData(['board', projectId], (old) => {
        if (!old?.columns) return old;
        let moving;
        const stripped = old.columns.map((col) => ({
          ...col,
          tasks: col.tasks.filter((t) => {
            if (t._id === id) { moving = t; return false; }
            return true;
          }),
        }));
        if (!moving) return old;
        const moved = { ...moving, status };
        return {
          ...old,
          columns: stripped.map((col) =>
            (col.status === status ? { ...col, tasks: [...col.tasks, moved] } : col)),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['board', projectId], ctx.previous);
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', id] });
      qc.invalidateQueries({ queryKey: ['task-by-code'] });
    },
  });
};

export const useUpdateTask = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => unwrap(api.patch(`/pms/tasks/${id}`, body)).then((r) => r.data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', id] });
      qc.invalidateQueries({ queryKey: ['task-by-code'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
    },
  });
};

/** Delete a task outright (admin/manager only, enforced server-side). */
export const useDeleteTask = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => unwrap(api.delete(`/pms/tasks/${id}`)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
};

/** Upload one file to a task; `onProgress(pct)` reports 0-100 upload progress. */
export const useUploadTaskAttachment = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, file, onProgress }) => {
      const form = new FormData();
      form.append('file', file);
      return unwrap(
        api.post(`/pms/tasks/${taskId}/attachments`, form, {
          onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
          },
        }),
      ).then((r) => r.data);
    },
    onSuccess: (_data, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['task-by-code'] });
    },
  });
};

export const useDeleteTaskAttachment = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, attachmentId }) =>
      unwrap(api.delete(`/pms/tasks/${taskId}/attachments/${attachmentId}`)).then((r) => r.data),
    onSuccess: (_data, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['task-by-code'] });
    },
  });
};

/** Post a plain text comment on a task (Task Details → Comments tab). */
export const useAddTaskComment = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, body }) =>
      unwrap(api.post(`/pms/tasks/${taskId}/comments`, { body })).then((r) => r.data),
    onSuccess: (_data, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['task-by-code'] });
    },
  });
};

/** Post a progress "update" (text + up to 4 photos) on a task (Task Details → Updates tab). */
export const useAddTaskUpdate = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, body, photos = [], onProgress }) => {
      const form = new FormData();
      form.append('body', body || '');
      for (const file of photos) form.append('photos', file);
      return unwrap(
        api.post(`/pms/tasks/${taskId}/updates`, form, {
          onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
          },
        }),
      ).then((r) => r.data);
    },
    onSuccess: (_data, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['task-by-code'] });
    },
  });
};

const invalidateTaskApproval = (qc, projectId, taskId) => {
  qc.invalidateQueries({ queryKey: ['board', projectId] });
  qc.invalidateQueries({ queryKey: ['project-activity', projectId] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['task', taskId] });
  qc.invalidateQueries({ queryKey: ['task-by-code'] });
  qc.invalidateQueries({ queryKey: ['project', projectId] }); // stage status / progress may change
};

/** Assignee hands a Completed task off for department-manager sign-off. */
export const useSubmitTaskForApproval = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId) => unwrap(api.post(`/pms/tasks/${taskId}/submit-approval`)).then((r) => r.data),
    onSuccess: (_data, taskId) => invalidateTaskApproval(qc, projectId, taskId),
  });
};

/** Department manager (or Admin) approves/rejects a task Waiting Approval. */
export const useTaskDecision = (projectId) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, decision, reason, remarks }) =>
      unwrap(api.post(`/pms/tasks/${taskId}/decision`, { decision, reason, remarks })).then((r) => r.data),
    onSuccess: (_data, { taskId }) => invalidateTaskApproval(qc, projectId, taskId),
  });
};

/* ---------------- Records (collection-mode stages) ---------------- */
/**
 * `extra` adds further filters (e.g. `{ status: 'shortlisted' }` for eligible
 * properties, `{ parentRecordId }` for a specific record's assessments) —
 * merged into both the query key and the querystring, so different filters
 * cache independently.
 */
export const useStageRecords = (projectId, stageKey, extra = {}, options = {}) =>
  useQuery({
    enabled: isValidId(projectId) && !!stageKey,
    ...options,
    queryKey: ['records', projectId, stageKey, extra],
    queryFn: () =>
      unwrap(api.get(`/pms/records${qs({ projectId, stageKey, ...extra })}`)).then((r) => r.data),
  });

export const useRecord = (recordId, options = {}) =>
  useQuery({
    enabled: isValidId(recordId),
    ...options,
    queryKey: ['record', recordId],
    queryFn: () => unwrap(api.get(`/pms/records/${recordId}`)).then((r) => r.data),
  });

const invalidateRecords = (qc, projectId, stageKey) => {
  qc.invalidateQueries({ queryKey: ['records', projectId, stageKey] });
  qc.invalidateQueries({ queryKey: ['record'] }); // refresh any open detail view
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

/** Activity-only: log that a doer opened a record's dedicated workspace. */
export const useMarkRecordOpened = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => unwrap(api.post(`/pms/records/${id}/open`)).then((r) => r.data),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

export const useRecordDecision = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason, remarks }) =>
      unwrap(api.post(`/pms/records/${id}/decision`, { decision, reason, remarks })).then((r) => r.data),
    onSuccess: () => invalidateRecords(qc, projectId, stageKey),
  });
};

export const useAddRecordComment = (projectId, stageKey) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      unwrap(api.post(`/pms/records/${id}/comments`, { body })).then((r) => r.data),
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

/** Upload a media file to Cloudinary (unattached) for the record form. */
export const useUploadMedia = () =>
  useMutation({
    mutationFn: ({ file, onProgress }) => {
      const form = new FormData();
      form.append('file', file);
      return unwrap(
        api.post('/pms/records/uploads', form, {
          onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
          },
        }),
      ).then((r) => r.data);
    },
  });

export const useDestroyMedia = () =>
  useMutation({
    mutationFn: ({ publicId, resourceType }) =>
      unwrap(api.post('/pms/records/uploads/destroy', { publicId, resourceType })).then((r) => r.data),
  });

/* ---------------- MIS ---------------- */
export const useMisPortfolio = () =>
  useQuery({
    queryKey: ['mis', 'portfolio'],
    queryFn: () => unwrap(api.get('/pms/mis/portfolio')).then((r) => r.data),
  });

export const useMisProject = (id) =>
  useQuery({
    enabled: isValidId(id),
    queryKey: ['mis', 'project', id],
    queryFn: () => unwrap(api.get(`/pms/mis/projects/${id}`)).then((r) => r.data),
  });

/* ---------------- Calendar ---------------- */
export const useCalendar = (range) =>
  useQuery({
    queryKey: ['calendar', range],
    queryFn: () => unwrap(api.get(`/pms/calendar/events${qs(range)}`)).then((r) => r.data),
  });
