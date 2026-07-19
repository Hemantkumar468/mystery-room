import { z } from 'zod';
import {
  TEMPLATE_STATUS,
  PRIORITY_VALUES,
  DEPARTMENT_VALUES,
  MASTER_DATA_FIELD_TYPES,
  STAGE_CAPTURE_MODE_VALUES,
} from '../../../core/constants/index.js';

const masterDataFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(Object.values(MASTER_DATA_FIELD_TYPES)).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  section: z.string().optional(),
  multiple: z.boolean().optional(),
  accept: z.string().optional(),
  recordAudio: z.boolean().optional(),
  showIf: z.object({ field: z.string(), in: z.array(z.string()) }).optional(),
  order: z.number().optional(),
});

const assessmentTypeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  masterDataSchema: z.array(masterDataFieldSchema).optional(),
});

const templateTaskSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().optional(),
  department: z.enum(DEPARTMENT_VALUES).optional(),
  estimatedDays: z.number().min(0).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  assignees: z.array(z.string()).optional(),
  primaryAssignee: z.string().optional(),
  backupAssignee: z.string().optional(),
  primaryAssigneeUnavailable: z.boolean().optional(),
  dependencies: z.array(z.string()).optional(),
  checklist: z
    .array(
      z.object({
        label: z.string().min(1),
        required: z.boolean().optional(),
        order: z.number().optional(),
      }),
    )
    .optional(),
});

const templateStageSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  order: z.number().optional(),
  color: z.string().optional(),
  slaDays: z.number().min(0).optional(),
  ownerDepartment: z.enum(DEPARTMENT_VALUES).optional(),
  tasks: z.array(templateTaskSchema).optional(),
  masterDataSchema: z.array(masterDataFieldSchema).optional(),
  assessmentTypes: z.array(assessmentTypeSchema).optional(),
  captureMode: z.enum(STAGE_CAPTURE_MODE_VALUES).optional(),
  recordNoun: z.string().optional(),
  requiresApproval: z.boolean().optional(),
  approverRoles: z.array(z.string()).optional(),
});

const baseTemplate = {
  name: z.string().min(2),
  code: z.string().min(2),
  description: z.string().optional(),
  category: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).optional(),
  stages: z.array(templateStageSchema).optional(),
  // `validate` replaces req.body with the parsed value, so anything omitted here
  // is silently dropped before it reaches the service.
  status: z.enum(Object.values(TEMPLATE_STATUS)).optional(),
  isDefault: z.boolean().optional(),
};

export const createTemplateSchema = z.object({
  body: z.object({ ...baseTemplate, stages: z.array(templateStageSchema).min(1) }),
});

export const updateTemplateSchema = z.object({
  params: z.object({ id: z.string().length(24) }),
  body: z.object({
    ...baseTemplate,
    name: baseTemplate.name.optional(),
    code: baseTemplate.code.optional(),
  }),
});

export const idParamSchema = z.object({ params: z.object({ id: z.string().length(24) }) });

export const listTemplatesSchema = z.object({
  query: z.object({
    status: z.enum(Object.values(TEMPLATE_STATUS)).optional(),
    category: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
    sort: z.string().optional(),
  }),
});
