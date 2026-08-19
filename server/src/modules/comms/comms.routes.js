import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { authenticate, authorize } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { uploadMultiple, enforceTypeSizeLimitsMulti } from '../../core/middleware/upload.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { CAN_CAPTURE } from '../../core/constants/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../config/logger.js';

/**
 * Outbound communications — currently one endpoint: send an email with
 * attachments (purchase orders to vendors being the first user).
 *
 * Fully built against SMTP config that may not exist yet: with no SMTP_* in
 * .env every send answers 503 naming exactly which variables to set, so the
 * whole feature goes live by editing .env — no code change, no redeploy of
 * anything but config. That contract is the point of this module.
 */

const emailListField = z.string().max(500).optional().transform((v) => (v || '')
  .split(/[,;]/)
  .map((e) => e.trim())
  .filter(Boolean));

const sendEmailSchema = z.object({
  body: z.object({
    to: z.string().min(3, 'At least one recipient is required').max(500),
    cc: z.string().max(500).optional(),
    subject: z.string().min(1, 'A subject is required').max(200),
    text: z.string().min(1, 'The message body is empty').max(10000),
  }),
});

/** Lazily built and reused — nodemailer pools connections internally. */
let transport = null;
function getTransport() {
  if (!config.smtp.configured) {
    throw new ApiError(503,
      'Email sending isn’t connected yet. Set SMTP_HOST, SMTP_USER, SMTP_PASS '
      + '(and optionally SMTP_PORT, SMTP_FROM) in the server’s .env to enable it.',
      { code: 'SMTP_NOT_CONFIGURED' });
  }
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transport;
}

const router = Router();
router.use(authenticate);

/**
 * POST /comms/email — multipart: to, cc?, subject, text, attachments[] (≤5).
 * Attachments ride the same upload middleware (and size rules) as every other
 * file in the system; they go straight from memory to the mail, never to disk.
 */
router.post(
  '/email',
  authorize(...CAN_CAPTURE),
  uploadMultiple('attachments', 5),
  enforceTypeSizeLimitsMulti,
  validate(sendEmailSchema),
  asyncHandler(async (req, res) => {
    const { to, cc, subject, text } = req.body;
    const toList = emailListField.parse(to);
    const ccList = emailListField.parse(cc);
    if (!toList.length) throw ApiError.badRequest('At least one valid recipient is required.');

    const mailer = getTransport(); // throws the 503 before any work if unconfigured

    const info = await mailer.sendMail({
      from: config.smtp.from,
      to: toList.join(', '),
      ...(ccList.length ? { cc: ccList.join(', ') } : {}),
      subject,
      text,
      attachments: (req.files || []).map((f) => ({
        filename: f.originalname,
        content: f.buffer,
        contentType: f.mimetype,
      })),
    });

    // The audit line ops will grep for: who sent what to whom, with what.
    logger.info(
      `email sent: "${subject}" to=${toList.join(',')}${ccList.length ? ` cc=${ccList.join(',')}` : ''} `
      + `attachments=${req.files?.length || 0} by=${req.user?.email || req.user?.id} id=${info.messageId}`,
    );

    return ApiResponse.ok(res, { messageId: info.messageId, to: toList, cc: ccList }, 'Email sent');
  }),
);

export default router;
