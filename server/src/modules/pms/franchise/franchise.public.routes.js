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

/* The messages are the ones an applicant would read — the same sentences the
   form shows, not Zod's own wording. */
const NAME_OK = /^[\p{L}][\p{L}\s.'-]*$/u;
const nameField = z.string().trim()
  .min(2, 'Please write your full name — our team will address you by it.')
  .max(120)
  .regex(NAME_OK, 'A name cannot contain numbers or symbols. Please write it in letters only.');
const phoneField = z.string().trim().max(20)
  .refine((v) => {
    const d = String(v).replace(/\D/g, '');
    const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d;
    return ten.length === 10 && /^[6-9]/.test(ten);
  }, 'An Indian mobile number has 10 digits and starts with 6, 7, 8 or 9 — we cannot reach you otherwise.');
const emailField = z.string().trim()
  .min(1, 'We send the written reply by email, so we need an address that works.')
  .email('That address looks incomplete — it should look like name@example.com.')
  .max(160);

const propertySchema = z.object({
  label: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, 'Which city is this property in?').max(60),
  locality: z.string().trim().min(2, 'Which part of the city — the locality or nearest landmark?').max(120),
  address: z.string().trim().min(10, 'The full address, so our team can find the shop and visit it.').max(400),
  carpetAreaSqft: z.number({ invalid_type_error: 'How big is it, in square feet? Numbers only, e.g. 2400.' })
    .min(100, 'That looks too small for a centre — please check the square feet.')
    .max(100000, 'That looks too large to be right — please check the square feet.'),
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
      name: nameField,
      phone: phoneField,
      email: emailField,
      /* No longer asked for on the public form, and therefore no longer
         required here — a required field the form cannot supply rejects every
         application. Still accepted and still stored: the expansion team
         captures both when they call, and older enquiries carry them. */
      background: z.string().trim().max(2000).optional(),
      /* A property is no longer optional: an enquiry with no site cannot be
         assessed, costed or shortlisted, and those reached the MD as empty
         rows. The interest-only road is recorded by the expansion team now. */
      hasProperty: z.literal(true, { errorMap: () => ({ message: 'Add the property you want the centre in — an application without a site cannot be assessed.' }) }),
      properties: z.array(propertySchema)
        .min(1, 'Add the property you want the centre in — an application without a site cannot be assessed.')
        .max(12),
      interestCity: z.string().trim().max(60).optional(),
      interestArea: z.string().trim().max(200).optional(),
      plan: z.string().trim().max(2000).optional(),
      investmentReady: z.string().trim().max(200).optional(),
      message: z.string().trim().max(3000).optional(),
      // The honeypot — filled only by bots; the guard answers them with a
      // fake success before this schema ever runs.
      website: z.string().optional(),
    })
    ,
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

/**
 * The BROKER link — "I have a shop that would suit you."
 *
 * Same submission, narrower question. A broker is not applying for a
 * franchise, so the franchise-only fields (background, plan, investment) are
 * not asked for and `hasProperty` is not a fork: a broker with no property has
 * nothing to send. The row lands in the property queue labelled 'broker' and
 * is never shown as a lead to approve.
 */
const brokerSchema = z.object({
  body: z.object({
    /* Which of the two referral roads this came down. Absent means broker, so
       anything already pointing at this endpoint keeps its old meaning. */
    source: z.enum(['broker', 'other']).optional(),
    name: nameField,
    phone: phoneField,
    email: emailField,
    properties: z.array(propertySchema)
      .min(1, 'Add the property you are telling us about — there is nothing to look at otherwise.')
      .max(12),
    message: z.string().trim().max(3000).optional(),
    website: z.string().optional(), // honeypot
  }),
});

router.post(
  '/properties',
  publicIntakeLimiter,
  honeypot,
  validate(brokerSchema),
  asyncHandler(async (req, res) => {
    if (req.isHoneypot) return ApiResponse.created(res, { received: true }, 'Thank you — we will be in touch.');
    await franchiseService.submit({
      ...req.body,
      source: req.body.source === 'other' ? 'other' : 'broker',
      hasProperty: true,
    });
    return ApiResponse.created(res, { received: true }, 'Thank you — our team will review this property.');
  }),
);

export default router;
