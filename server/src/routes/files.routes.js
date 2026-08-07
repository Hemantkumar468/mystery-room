import { Router } from 'express';
import { asyncHandler } from '../core/utils/asyncHandler.js';
import { ApiError } from '../core/utils/ApiError.js';
import { config } from '../config/index.js';
import { getPresignedUrl, isS3Configured } from '../config/s3.js';

/**
 * Stable, never-expiring links to private S3 objects.
 *
 * The S3 objects themselves stay private — this route mints a short-lived
 * presigned link per request and redirects to it, so the URL stored on a
 * record/task keeps working forever while the underlying S3 access is only
 * ever granted for a few minutes at a time.
 *
 * Deliberately unauthenticated: these URLs are consumed by plain <img>,
 * <video> and download links in the browser, which cannot send the
 * Authorization header the rest of the API requires. Access therefore rests
 * on the key being unguessable (a nanoid per object), which is the same
 * protection the previous Cloudinary URLs had — this is not a regression
 * from that setup, but it does mean anyone holding a file's URL can open it.
 */
const router = Router();

router.get(
  '/*',
  asyncHandler(async (req, res) => {
    if (!isS3Configured) throw new ApiError(503, 'File storage is not configured');

    const key = req.params[0];
    // Never serve anything outside this app's own prefix, even though the
    // credentials could reach the rest of the shared bucket.
    if (!key || !key.startsWith(`${config.s3.rootPrefix}/`) || key.includes('..')) {
      throw ApiError.badRequest('Invalid file key');
    }

    const url = await getPresignedUrl(key);
    // 302, not 301 — the target is short-lived and must never be cached as
    // permanent by the browser.
    res.redirect(302, url);
  }),
);

export default router;
