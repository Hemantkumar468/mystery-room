import { z } from 'zod';
import { PRIORITY_VALUES } from '../../core/constants/index.js';
import {
  DELEGATION_STATUS,
  DELEGATION_STATUS_VALUES,
  DELEGATION_FREQUENCY_VALUES,
  REMINDER_UNITS,
  REMINDER_TRIGGERS,
  REMINDER_CHANNELS,
  FOLLOWUP_CALL_STATUS,
} from '../../core/constants/ops.js';

const objectId = z.string().length(24);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dateLike = z.string().min(10).max(40);
const text = (max) => z.string().trim().min(1).max(max);
const url = z.string().max(600);
const branchParam = z.union([objectId, z.literal('all')]);
const idParams = z.object({ id: objectId });

const reminder = z.object({
  channel: z.enum(REMINDER_CHANNELS).optional(),
  value: z.number().int().min(1).max(999),
  unit: z.enum(REMINDER_UNITS),
  trigger: z.enum(REMINDER_TRIGGERS),
});

const repeat = z
  .object({
    frequency: z.enum(DELEGATION_FREQUENCY_VALUES),
    startDate: dayKey.optional(),
    endDate: dayKey.optional(),
    weeklyDays: z.array(z.number().int().min(0).max(6)).optional(),
    monthDates: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
    intervalDays: z.number().int().min(1).max(365).optional(),
    custom: z
      .object({
        every: z.enum(['week', 'month']),
        value: z.number().int().min(1).max(52),
        weekdays: z.array(z.number().int().min(0).max(6)).optional(),
        dates: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
      })
      .optional(),
  })
  .superRefine((r, ctx) => {
    const need = (cond, message) => !cond && ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (r.frequency === 'weekly') need(r.weeklyDays?.length, 'Pick at least one weekday');
    if (r.frequency === 'monthly') need(r.monthDates?.length, 'Pick at least one date of the month');
    if (r.frequency === 'periodically') need(r.intervalDays, 'Set how many days between repeats');
    if (r.frequency === 'custom') {
      need(r.custom, 'Describe the custom repeat');
      if (r.custom?.every === 'week') need(r.custom.weekdays?.length, 'Pick at least one weekday');
      if (r.custom?.every === 'month') need(r.custom.dates?.length, 'Pick at least one date');
    }
    if (r.startDate && r.endDate) need(r.endDate >= r.startDate, 'End date must be after the start date');
  });

export const listSchema = z.object({
  query: z.object({
    branch: branchParam.optional(),
    view: z.enum(['mine', 'delegated', 'loop', 'group', 'all']).optional(),
    status: z
      .union([z.enum(DELEGATION_STATUS_VALUES), z.enum(['all', 'open', 'incomplete', 'pending_today', 'overdue', 'due_today', 'stuck', 'on_time', 'completed_late'])])
      .optional(),
    recurrence: objectId.optional(),
    othersOnly: z.enum(['true', 'false']).optional(),
    assignedBy: z.enum(['me', 'admins']).optional(),
    group: objectId.optional(),
    team: objectId.optional(),
    doer: objectId.optional(),
    assigner: objectId.optional(),
    category: z.string().max(60).optional(),
    tag: z.string().max(60).optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    frequency: z.union([z.enum(DELEGATION_FREQUENCY_VALUES), z.enum(['once', 'recurring'])]).optional(),
    verification: z.enum(['required', 'not_required']).optional(),
    topLevel: z.enum(['true', 'false']).optional(),
    search: z.string().max(100).optional(),
    dueFrom: dayKey.optional(),
    dueTo: dayKey.optional(),
    createdFrom: dayKey.optional(),
    createdTo: dayKey.optional(),
    sort: z.enum(['due', '-due', 'created', '-created', 'updated']).optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
  }),
});

export const summarySchema = z.object({ query: z.object({ branch: branchParam.optional() }) });

export const createSchema = z.object({
  body: z.object({
    title: text(250),
    description: text(5000),
    doers: z.array(objectId).min(1, 'Choose who should do this').max(50),
    inLoop: z.array(objectId).max(50).optional(),
    category: text(60),
    priority: z.enum(PRIORITY_VALUES),
    dueDate: dateLike,
    branch: branchParam.optional(),
    group: objectId.optional(),
    parent: objectId.optional(),
    tags: z.array(z.string().trim().max(60)).max(20).optional(),
    checklistItems: z.array(z.object({ text: text(300) })).max(50).optional(),
    evidenceRequired: z.boolean().optional(),
    verificationRequired: z.boolean().optional(),
    voiceNoteUrl: url.optional(),
    referenceDocs: z.array(url).max(20).optional(),
    reminders: z.array(reminder).max(10).optional(),
    repeat: repeat.optional(),
  }),
});

export const updateSchema = z.object({
  params: idParams,
  body: z
    .object({
      title: text(250).optional(),
      description: z.string().trim().max(5000).optional(),
      category: z.string().trim().max(60).optional(),
      tags: z.array(z.string().trim().max(60)).max(20).optional(),
      priority: z.enum(PRIORITY_VALUES).optional(),
      inLoop: z.array(objectId).max(50).optional(),
      group: objectId.nullable().optional(),
      branch: objectId.optional(),
      evidenceRequired: z.boolean().optional(),
      verificationRequired: z.boolean().optional(),
      voiceNoteUrl: url.nullable().optional(),
      referenceDocs: z.array(url).max(20).optional(),
      evidenceUrls: z.array(url).max(20).optional(),
      checklistItems: z
        .array(z.object({ _id: objectId.optional(), text: text(300), completed: z.boolean().optional() }))
        .max(50)
        .optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
});

export const idSchema = z.object({ params: idParams });

export const statusSchema = z.object({
  params: idParams,
  body: z.object({
    status: z.enum([DELEGATION_STATUS.ACCEPTED, DELEGATION_STATUS.IN_PROGRESS]),
    remark: z.string().trim().max(2000).optional(),
  }),
});

export const completeSchema = z.object({
  params: idParams,
  body: z.object({
    evidenceUrls: z.array(url).max(20).optional(),
    remark: z.string().trim().max(2000).optional(),
  }),
});

export const remarkOptionalSchema = z.object({
  params: idParams,
  body: z.object({ remark: z.string().trim().max(2000).optional() }),
});

export const reasonSchema = z.object({
  params: idParams,
  body: z.object({ reason: text(2000) }),
});

export const reviseSchema = z.object({
  params: idParams,
  body: z.object({ newDate: dateLike, reason: text(2000), evidenceUrl: url.optional() }),
});

export const dependentSchema = z.object({
  params: idParams,
  body: z
    .object({
      personId: objectId.optional(),
      dependentOnTask: z.string().trim().max(250).optional(),
      pendingApproval: z.string().trim().max(250).optional(),
      requiredTeam: z.string().trim().max(120).optional(),
      remark: text(2000),
    })
    .refine((b) => b.personId || b.dependentOnTask || b.pendingApproval || b.requiredTeam, 'Say what the task depends on'),
});

export const blockedSchema = z.object({
  params: idParams,
  body: z
    .object({
      person: z.string().trim().max(120).optional(),
      department: z.string().trim().max(120).optional(),
      vendor: z.string().trim().max(120).optional(),
      consultant: z.string().trim().max(120).optional(),
      reason: text(2000),
    })
    .refine((b) => b.person || b.department || b.vendor || b.consultant, 'Name at least one person, department, vendor or consultant'),
});

export const reassignSchema = z.object({
  params: idParams,
  body: z.object({ newDoerId: objectId, reason: z.string().trim().max(2000).optional() }),
});

export const commentSchema = z.object({
  params: idParams,
  body: z.object({ body: text(4000), attachments: z.array(url).max(10).optional() }),
});

export const channelRemarkSchema = z.object({
  params: idParams,
  body: z.object({
    remark: text(2000),
    status: z.enum(DELEGATION_STATUS_VALUES).optional(),
  }),
});

export const followupSchema = z.object({
  params: idParams,
  body: z.object({
    callStatus: z.enum(FOLLOWUP_CALL_STATUS),
    observedStatus: z.string().trim().max(100).optional(),
    response: z.string().trim().max(2000).optional(),
    systemUpdated: z.boolean().optional(),
    nextFollowUpDate: dateLike.optional(),
    escalationRequired: z.boolean().optional(),
  }),
});

export const remindersSchema = z.object({
  params: idParams,
  body: z.object({ reminders: z.array(reminder).max(10) }),
});

export const deletedListSchema = z.object({
  query: z.object({
    branch: branchParam.optional(),
    search: z.string().max(100).optional(),
    from: dayKey.optional(),
    to: dayKey.optional(),
  }),
});

const templateBody = {
  title: text(250),
  description: z.string().trim().max(5000).optional(),
  category: z.string().trim().max(60).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  checklistItems: z.array(z.object({ text: text(300) })).max(50).optional(),
  evidenceRequired: z.boolean().optional(),
  verificationRequired: z.boolean().optional(),
};
export const templateCreateSchema = z.object({ body: z.object(templateBody) });
export const templateUpdateSchema = z.object({
  params: idParams,
  body: z.object({ ...templateBody, title: templateBody.title.optional() }),
});

export const recurrenceListSchema = z.object({
  query: z.object({ branch: branchParam.optional(), active: z.enum(['true', 'false']).optional() }),
});
export const recurrenceUpdateSchema = z.object({
  params: idParams,
  body: z.object({ isActive: z.boolean().optional(), endDate: dayKey.nullable().optional() }),
});
export const recurrencePreviewSchema = z.object({ body: repeat });
