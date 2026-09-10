import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../core/middleware/validate.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { publicIntakeLimiter, honeypot } from '../../crm/intake/intake.guards.js';
import { publicTenantContext } from '../../../core/tenancy/tenancy.js';
import { uploadSingle, enforceTypeSizeLimits } from '../../../core/middleware/upload.js';
import { recordService } from '../records/record.service.js';
import { franchiseService } from './franchise.service.js';

/**
 * The UNAUTHENTICATED half — the enquiry form an interested franchisee opens
 * from a shared link. Mounted at /franchise/public, before the authenticated
 * router. Same defences as every public intake here: rate limit, honeypot
 * (bots get a polite fake success), and the tenant resolved the way CRM's
 * web form resolves it.
 */
const mediaRef = z.object({
  url: z.string().url(),
  name: z.string().max(200).optional(),
  publicId: z.string().max(200).optional(),
});

const propertySchema = z.object({
  label: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(60),
  locality: z.string().trim().max(120).optional(),
  address: z.string().trim().min(5).max(400),
  carpetAreaSqft: z.number().positive().max(100000).optional(),
  floor: z.string().trim().max(60).optional(),
  ownership: z.enum(['owned', 'leased', 'family', 'other']).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  photos: z.array(mediaRef).max(10).optional(),
  videos: z.array(mediaRef).max(4).optional(),
  documents: z.array(mediaRef).max(6).optional(),
  // Big walkthrough videos live on Google Drive — links instead of uploads.
  driveLinks: z.array(z.string().trim().url().max(500)).max(6).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

const submitSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(7).max(20),
      email: z.string().trim().email().max(160).optional().or(z.literal('')),
      background: z.string().trim().max(2000).optional(),
      /* The fork: property in hand (one or many), or interest only. */
      hasProperty: z.boolean(),
      properties: z.array(propertySchema).max(12).optional(),
      interestCity: z.string().trim().max(60).optional(),
      interestArea: z.string().trim().max(200).optional(),
      plan: z.string().trim().max(2000).optional(),
      investmentReady: z.string().trim().max(200).optional(),
      message: z.string().trim().max(3000).optional(),
      // The honeypot — filled only by bots; the guard answers them with a
      // fake success before this schema ever runs.
      website: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.hasProperty && !(data.properties?.length >= 1)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['properties'], message: 'Add at least one property.' });
      }
      if (!data.hasProperty && !(data.interestCity && data.interestCity.trim().length >= 2)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interestCity'], message: 'Tell us which city you are interested in.' });
      }
    }),
});

const router = Router();
router.use(publicTenantContext('A public franchise enquiry'));

/* Photos first, then the form referencing their URLs — the same two-step the
   in-app capture uses, minus the login. Rate-limited like the submission. */
router.post(
  '/uploads',
  publicIntakeLimiter,
  uploadSingle('file'),
  enforceTypeSizeLimits,
  asyncHandler(async (req, res) => {
    const ref = await recordService.uploadMedia(req.file);
    return ApiResponse.created(res, ref, 'File uploaded');
  }),
);

router.post(
  '/enquiries',
  publicIntakeLimiter,
  honeypot,
  validate(submitSchema),
  asyncHandler(async (req, res) => {
    if (req.isHoneypot) return ApiResponse.created(res, { received: true }, 'Thank you — we will be in touch.');
    await franchiseService.submit(req.body);
    return ApiResponse.created(res, { received: true }, 'Thank you — our team will review and get back to you.');
  }),
);

export default router;
