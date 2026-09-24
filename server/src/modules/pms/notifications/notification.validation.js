import { z } from 'zod';

const objectId = z.string().length(24);

export const listNotificationsSchema = z.object({
  query: z.object({
    unreadOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
    limit: z.coerce.number().optional(),
  }),
});

export const idParamSchema = z.object({
  params: z.object({ id: objectId }),
});
