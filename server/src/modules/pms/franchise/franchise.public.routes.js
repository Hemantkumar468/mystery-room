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
const submitSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(7).max(20),
    email: z.string().trim().email().max(160).optional().or(z.literal('')),
    background: z.string().trim().max(2000).optional(),
    city: z.string().trim().min(2).max(60),
    locality: z.string().trim().max(120).optional(),
    address: z.string().trim().min(5).max(400),
    carpetAreaSqft: z.number().positive().max(100000).optional(),
    floor: z.string().trim().max(60).optional(),
    ownership: z.enum(['owned', 'leased', 'family', 'other']).optional(),
    location: z.object({ lat: z.number(), lng: z.number() }).optional(),
    photos: z.array(z.object({
      url: z.string().url(),
      name: z.string().max(200).optional(),
      publicId: z.string().max(200).optional(),
    })).max(10).optional(),
    investmentReady: z.string().trim().max(200).optional(),
    message: z.string().trim().max(3000).optional(),
    // The honeypot — filled only by bots; the guard answers them with a
    // fake success before this schema ever runs.
    website: z.string().optional(),
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
