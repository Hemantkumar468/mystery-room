import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import { config } from './index.js';
import { logger } from './logger.js';

/**
 * Reusable S3 client. Initialized once from the validated `config` object so
 * the rest of the app imports helpers here, never the SDK directly.
 *
 * The bucket (`config.s3.bucket`) is shared with other, unrelated projects.
 * Every key this module writes is namespaced under `config.s3.rootPrefix`
 * ("mysteryrooms/…") so this app never reads, writes or deletes anything
 * outside its own folder, no matter what else lives in the bucket.
 *
 * Objects are never made public (no ACL, no bucket policy needed). Every
 * stored `url` instead points at this server's own `/files/:key` proxy
 * (routes/files.routes.js), which mints a short-lived presigned S3 link on
 * each request and redirects to it. The stored URL itself never expires or
 * changes — only what it redirects to does.
 */
const { bucket, region, accessKeyId, secretAccessKey, rootPrefix } = config.s3;

export const isS3Configured = Boolean(bucket && region && accessKeyId && secretAccessKey);

const s3Client = isS3Configured
  ? new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  : null;

if (!isS3Configured) {
  logger.warn(
    'S3 is not configured — set S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID and ' +
      'AWS_SECRET_ACCESS_KEY to enable file uploads.',
  );
}

const extOf = (name = '') => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '');

/** Mirrors Cloudinary's three-way resource_type bucket, kept for callers that branch on it. */
function resourceTypeOf(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/') || mimetype.startsWith('audio/')) return 'video';
  return 'raw';
}

/**
 * Upload a file buffer to S3 under `{rootPrefix}/{options.folder}/…` and
 * resolve with a Cloudinary-shaped result ({ secure_url, public_id,
 * resource_type, bytes }) — this is what record.service.js / task.service.js
 * already expect, so switching the storage backend needed no call-site changes.
 */
export async function uploadBuffer(buffer, options = {}) {
  const folder = [rootPrefix, options.folder].filter(Boolean).join('/');
  const safeName = (options.filename || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const key = `${folder}/${nanoid(12)}-${safeName}`;
  const resourceType = resourceTypeOf(options.contentType);

  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: options.contentType,
  }));

  return {
    secure_url: `${config.publicApiUrl}/files/${key}`,
    public_id: key,
    resource_type: resourceType,
    bytes: buffer.length,
  };
}

/** Delete a previously uploaded object by its key (S3 has no separate resource types, unlike Cloudinary). */
/**
 * Read a stored object back into memory.
 *
 * Needed because the document reader has to send the actual file to the model:
 * the objects are private (no public URL), so nothing outside this server can
 * fetch one, and a presigned round-trip would be a second network hop for a
 * file we are about to post anyway.
 *
 * Capped, because the caller base64-encodes what comes back — a 200MB scan
 * would become a 270MB string and take the process down.
 */
export async function downloadBuffer(key, { maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!isS3Configured) throw new Error('S3 is not configured');
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const size = Number(res.ContentLength || 0);
  if (size > maxBytes) {
    throw new Error(`That file is ${(size / 1048576).toFixed(1)}MB — too large to read (limit ${Math.round(maxBytes / 1048576)}MB).`);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of res.Body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('File exceeded the read limit while downloading.');
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), contentType: res.ContentType || 'application/octet-stream' };
}

export async function destroyAsset(key) {
  if (!isS3Configured) return;
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * A time-limited link to an object, used by the `/files/:key` proxy route —
 * never stored, generated fresh on every request so it's always valid
 * regardless of how long ago the object was uploaded.
 */
export async function getPresignedUrl(key, expiresInSeconds = 300) {
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}

export { extOf };
export default s3Client;
