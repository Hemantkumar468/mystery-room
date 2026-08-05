import { z } from 'zod';
import { BRANCH_KINDS, BRANCH_STATUSES } from './branch.model.js';

const objectId = z.string().length(24);

/** No `code` field anywhere in these schemas — it's server-generated
 * (see branch.service.js), so a client-sent value is stripped by Zod's
 * default strip-unknown-keys behavior before it reaches the controller. */
export const createBranchSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    kind: z.enum(BRANCH_KINDS).optional(),
    city: z.string().trim().max(80).optional(),
    address: z.string().trim().max(300).optional(),
    costCenterCode: z.string().trim().max(40).optional(),
    openedAt: z.coerce.date().optional(),
    manager: objectId.optional(),
    project: objectId.optional(),
  }),
});

export const updateBranchSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    kind: z.enum(BRANCH_KINDS).optional(),
    city: z.string().trim().max(80).optional(),
    address: z.string().trim().max(300).optional(),
    costCenterCode: z.string().trim().max(40).optional(),
    openedAt: z.coerce.date().optional(),
    manager: objectId.nullable().optional(),
    project: objectId.nullable().optional(),
    status: z.enum(BRANCH_STATUSES).optional(),
  }),
  params: z.object({ id: objectId }),
});

export const listBranchesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
    sort: z.string().optional(),
    status: z.enum(BRANCH_STATUSES).optional(),
    kind: z.enum(BRANCH_KINDS).optional(),
    city: z.string().trim().max(80).optional(),
    search: z.string().trim().max(100).optional(),
  }).optional(),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });
