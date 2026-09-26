import { z } from 'zod';
import { TEAM_ROLE_VALUES } from '../../../core/constants/ops.js';

const objectId = z.string().length(24);

const memberSchema = z.object({
  user: objectId,
  role: z.enum(TEAM_ROLE_VALUES).optional(),
  reportsTo: objectId.nullable().optional(),
});

export const listTeamsSchema = z.object({
  query: z.object({
    branch: objectId.optional(),
    mine: z.enum(['true', 'false']).optional(),
  }),
});

export const createTeamSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    branch: objectId.optional(),
    color: z.string().max(20).optional(),
    members: z.array(memberSchema).max(200).optional(),
  }),
});

export const updateTeamSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(500).optional(),
      branch: objectId.nullable().optional(),
      color: z.string().max(20).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
});

export const upsertMemberSchema = z.object({
  params: z.object({ id: objectId }),
  body: memberSchema,
});

export const memberParamSchema = z.object({
  params: z.object({ id: objectId, userId: objectId }),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });
