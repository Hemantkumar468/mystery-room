import { z } from 'zod';
import { BRANCH_TYPE_VALUES } from '../../../core/constants/ops.js';

const objectId = z.string().length(24);

const branchBody = {
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, 'Code may use letters, numbers and dashes only'),
  type: z.enum(BRANCH_TYPE_VALUES).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
  isDefault: z.boolean().optional(),
};

export const createBranchSchema = z.object({ body: z.object(branchBody) });

export const updateBranchSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      ...branchBody,
      name: branchBody.name.optional(),
      code: branchBody.code.optional(),
      isActive: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
});

export const listBranchesSchema = z.object({
  query: z.object({ includeInactive: z.enum(['true', 'false']).optional() }),
});
