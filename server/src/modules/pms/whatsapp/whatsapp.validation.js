import { z } from 'zod';
import { WHATSAPP_EVENTS, RECIPIENT_RULES, PARAM_SOURCES } from './whatsapp.model.js';

const objectId = z.string().length(24);

/**
 * Phone is validated loosely on purpose: normalisation happens at send time
 * (core/services/whatsapp.service.js), so "+91 98765-43210" is as valid as
 * "9876543210". Rejecting formatting here would only mean rejecting the way
 * people actually paste numbers.
 */
const phone = z.string().min(10).max(20);

export const updateSettingsSchema = z.object({
  body: z
    .object({
      isEnabled: z.boolean().optional(),
      quietHoursStart: z.number().int().min(0).max(23).optional(),
      quietHoursEnd: z.number().int().min(0).max(23).optional(),
      maxMessagesPerUserPerDay: z.number().int().min(1).max(50).optional(),
      escalateAfterDays: z.number().int().min(1).max(30).optional(),
      taskLinkBaseUrl: z.string().url().or(z.literal('')).optional(),
    })
    .strict(),
});

export const listTemplatesSchema = z.object({
  query: z
    .object({
      category: z.enum(['UTILITY', 'AUTHENTICATION', 'MARKETING', 'UNKNOWN']).optional(),
      status: z.enum(['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'REMOVED']).optional(),
    })
    .strict(),
});

export const updateTemplateSchema = z.object({
  params: z.object({ id: objectId }),
  // Only the two fields that are ours. Everything else is owned by sync and
  // would be overwritten on the next one.
  body: z
    .object({
      description: z.string().max(300).optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

const paramBinding = z
  .object({
    position: z.number().int().min(1).max(10),
    source: z.enum(PARAM_SOURCES),
    value: z.string().max(300).optional(),
  })
  .strict()
  // A 'custom' binding with no text renders an empty gap in the message.
  .refine((b) => b.source !== 'custom' || Boolean(b.value?.trim()), {
    message: 'A custom value needs text',
    path: ['value'],
  });

export const upsertEventMapSchema = z.object({
  body: z
    .object({
      eventKey: z.enum(Object.values(WHATSAPP_EVENTS)),
      templateName: z.string().min(1),
      language: z.string().min(2).max(10).default('en'),
      paramMapping: z.array(paramBinding).max(10).default([]),
      recipientRule: z.enum(RECIPIENT_RULES).default('assignee'),
      isEnabled: z.boolean().default(false),
      leadTimeDays: z.number().int().min(0).max(30).default(1),
    })
    .strict(),
});

export const listLogsSchema = z.object({
  query: z
    .object({
      status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'skipped']).optional(),
      eventKey: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict(),
});

export const testSendSchema = z.object({
  body: z
    .object({
      phone,
      templateName: z.string().min(1),
      language: z.string().min(2).max(10).default('en'),
      params: z.array(z.string().max(1000)).max(10).default([]),
    })
    .strict(),
});

export const createTemplateSchema = z.object({
  body: z
    .object({
      name: z.string().min(3).max(60),
      category: z.enum(['UTILITY', 'AUTHENTICATION', 'MARKETING']).default('UTILITY'),
      language: z.string().min(2).max(10).default('en'),
      body: z.string().min(1).max(1024),
      bodySampleValues: z.array(z.string().max(200)).max(10).default([]),
      footer: z.string().max(60).optional(),
      description: z.string().max(300).optional(),
    })
    .strict(),
});

export const idParamSchema = z.object({
  params: z.object({ id: objectId }),
});
