import { z } from 'zod';
import {
  TASK_STATUS_VALUES,
  PRIORITY_VALUES,
  DEPARTMENT_VALUES,
} from '../../../core/constants/index.js';

const objectId = z.string().length(24);

export const listTasksSchema = z.object({
  query: z.object({
    project: objectId.optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    assignee: objectId.optional(),
    stageKey: z.string().optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    overdue: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
    search: z.string().optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
    sort: z.string().optional(),
  }),
});

export const boardSchema = z.object({
  query: z.object({ project: objectId }),
});

const attachmentInput = z.object({
  url: z.string(),
  publicId: z.string(),
  resourceType: z.string().optional(),
  originalName: z.string().optional(),
  mimetype: z.string().optional(),
  bytes: z.number().optional(),
});

export const createTaskSchema = z.object({
  body: z.object({
    project: objectId,
    stageKey: z.string().min(1),
    title: z.string().min(2),
    description: z.string().optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    assignee: objectId.nullable().optional(),
    // Buddy / CC + roster ids.
    watchers: z.array(objectId).optional(),
    backupAssignee: z.string().optional(),
    primaryAssignee: z.string().optional(),
    assignees: z.array(z.string()).optional(),
    plannedStart: z.coerce.date().optional(),
    plannedEnd: z.coerce.date().optional(),
    estimatedHours: z.number().min(0).optional(),
    checklist: z
      .array(z.object({ label: z.string().min(1), required: z.boolean().optional() }))
      .optional(),
    links: z.array(z.object({ label: z.string().optional(), url: z.string().min(1) })).optional(),
    attachments: z.array(attachmentInput).optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const updateTaskSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    title: z.string().min(2).optional(),
    description: z.string().optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    assignee: objectId.nullable().optional(),
    plannedStart: z.coerce.date().optional(),
    plannedEnd: z.coerce.date().optional(),
    estimatedHours: z.number().min(0).optional(),
    actualHours: z.number().min(0).optional(),
    checklist: z
      .array(
        z.object({
          _id: z.string().optional(),
          label: z.string().min(1),
          done: z.boolean().optional(),
          required: z.boolean().optional(),
        }),
      )
      .optional(),
    dependencies: z.array(objectId).optional(),
    tags: z.array(z.string()).optional(),
    order: z.number().optional(),
  }),
});

export const statusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(TASK_STATUS_VALUES) }),
});

export const commentSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ body: z.string().min(1).max(2000) }),
});

export const attachmentParamSchema = z.object({
  params: z.object({ id: objectId, attachmentId: objectId }),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });
