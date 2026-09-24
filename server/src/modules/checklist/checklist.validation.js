import { z } from 'zod';
import { DEPARTMENT_VALUES } from '../../core/constants/index.js';
import { CHECKLIST_FREQUENCY_VALUES, CHECKLIST_STATUS_VALUES, REMARK_CHANNELS } from '../../core/constants/ops.js';

const objectId = z.string().length(24);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const branchParam = z.union([objectId, z.literal('all')]);
const idParams = z.object({ id: objectId });
const department = z.enum(DEPARTMENT_VALUES);

const scopeQuery = {
  branch: branchParam.optional(),
  doer: objectId.optional(),
  team: objectId.optional(),
  group: objectId.optional(),
  master: objectId.optional(),
  createdBy: z.enum(['me', 'admins']).optional(),
  frequency: z.enum(CHECKLIST_FREQUENCY_VALUES).optional(),
  department: z.union([department, z.literal('unassigned')]).optional(),
  site: z.string().max(160).optional(),
  search: z.string().max(100).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(),
};

export const listTasksSchema = z.object({
  query: z.object({
    ...scopeQuery,
    status: z.union([z.enum(CHECKLIST_STATUS_VALUES), z.enum(['pending_today', 'overdue', 'upcoming', 'due_today', 'on_time', 'late', 'all'])]).optional(),
    limit: z.coerce.number().int().positive().max(2000).optional(),
  }),
});

export const summarySchema = z.object({ query: z.object(scopeQuery) });

export const branchOnlySchema = z.object({ query: z.object({ branch: branchParam.optional() }) });

export const reportSchema = z.object({
  query: z.object({
    branch: branchParam.optional(),
    department: department.optional(),
    team: objectId.optional(),
    createdBy: z.enum(['me', 'admins']).optional(),
    from: dayKey.optional(),
    to: dayKey.optional(),
  }),
});

export const listMastersSchema = z.object({
  query: z.object({
    branch: branchParam.optional(),
    frequency: z.enum(CHECKLIST_FREQUENCY_VALUES).optional(),
    active: z.enum(['true', 'false']).optional(),
    team: objectId.optional(),
    group: objectId.optional(),
    doer: objectId.optional(),
    createdBy: z.enum(['me', 'admins']).optional(),
    search: z.string().max(100).optional(),
  }),
});

export const createMasterSchema = z.object({
  body: z
    .object({
      taskName: z.string().trim().min(2).max(300),
      description: z.string().trim().max(2000).optional(),
      doer: objectId.optional(), // members always create for themselves
      frequency: z.enum(CHECKLIST_FREQUENCY_VALUES),
      startDate: dayKey,
      endDate: dayKey.optional(),
      weeklyOffs: z.array(z.number().int().min(0).max(6)).max(6).optional(),
      anchorWeekday: z.number().int().min(0).max(6).optional(),
      anchorDay: z.number().int().min(1).max(31).optional(),
      autoRenew: z.boolean().optional(),
      proofRequired: z.boolean().optional(),
      branch: branchParam.optional(),
      department: department.optional(),
      site: z.string().trim().max(160).optional(),
      group: objectId.optional(),
    })
    .refine((b) => !b.endDate || b.endDate >= b.startDate, 'End date must be after the start date'),
});

export const updateMasterSchema = z.object({
  params: idParams,
  body: z
    .object({
      taskName: z.string().trim().min(2).max(300).optional(),
      description: z.string().trim().max(2000).optional(),
      doer: objectId.optional(),
      proofRequired: z.boolean().optional(),
      department: department.nullable().optional(),
      site: z.string().trim().max(160).nullable().optional(),
      group: objectId.nullable().optional(),
      endDate: dayKey.optional(),
      autoRenew: z.boolean().optional(),
      isActive: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
});

export const idSchema = z.object({ params: idParams });

export const completeSchema = z.object({
  params: idParams,
  body: z.object({ documentUrl: z.string().max(600).optional(), remark: z.string().trim().max(2000).optional() }),
});

export const nonFunctionalSchema = z.object({
  params: idParams,
  body: z.object({ reason: z.string().trim().min(2).max(1000) }),
});

export const reopenSchema = z.object({
  params: idParams,
  body: z.object({ reason: z.string().trim().min(2).max(1000) }),
});

export const reassignSchema = z.object({
  params: idParams,
  body: z.object({
    newDoerId: objectId,
    applyToFuture: z.boolean().optional(),
    reason: z.string().trim().max(1000).optional(),
  }),
});

export const remarksSchema = z.object({
  body: z.object({
    taskIds: z.array(objectId).min(1).max(500),
    remark: z.string().trim().min(1).max(2000),
    channel: z.enum(Object.values(REMARK_CHANNELS)).default(REMARK_CHANNELS.MANAGEMENT),
  }),
});

export const addSiteSchema = z.object({
  body: z.object({ name: z.string().trim().min(1).max(160), branch: branchParam.optional() }),
});
export const renameSiteSchema = z.object({
  params: idParams,
  body: z.object({ name: z.string().trim().min(1).max(160) }),
});
