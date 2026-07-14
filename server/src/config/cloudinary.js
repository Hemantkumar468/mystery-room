import { v2 as cloudinary } from 'cloudinary';
import { config } from './index.js';
import { logger } from './logger.js';

/**
 * Reusable Cloudinary client. Initialized once from the validated `config`
 * object so the rest of the app imports helpers here, never the SDK directly.
 */
const { cloudName, apiKey, apiSecret } = config.cloudinary;

export const isCloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
} else {
  logger.warn(
    'Cloudinary is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and ' +
      'CLOUDINARY_API_SECRET to enable file uploads.',
  );
}

/** Default folder so uploads stay grouped and easy to prune in the dashboard. */
const UPLOAD_FOLDER = 'mysteryrooms/attachments';

/**
 * Upload an in-memory file buffer to Cloudinary and resolve with the result
 * (secure_url, public_id, resource_type, bytes, …).
 */
export function uploadBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: UPLOAD_FOLDER, resource_type: 'auto', ...options },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
}

/**
 * Delete a previously uploaded asset by its public_id. `resourceType` must match
 * what it was stored as ('image' | 'video' | 'raw') — non-image types won't
 * delete under the default 'image'.
 */
export function destroyAsset(publicId, resourceType = 'image') {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

export { cloudinary };
export default cloudinary;
