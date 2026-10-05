import { config } from '../../../config/index.js';
import { headObject, getObjectStream } from '../../../config/s3.js';
import { writeZip, safeEntryName, uniqueName } from '../../../core/utils/zipStream.js';

/**
 * SEVERAL DOCUMENTS, ONE DOWNLOAD.
 *
 * The browser cannot do this itself: the files live behind a 302 to a presigned
 * S3 link, the bucket sends no CORS headers, and a page that cannot READ a file
 * cannot put it in an archive. So the server does it — reading each object
 * straight from storage and streaming one zip to the caller.
 *
 * WHAT IT WILL AND WILL NOT TOUCH. Only objects under this app's own prefix
 * (`config.s3.rootPrefix`), found by the same rule the `/files` route uses, and
 * never a path that climbs. The caller sends the URLs the app stored on the
 * record; a URL that is not one of ours (a Google Drive link, a dead host) has no
 * key to resolve and is reported back as skipped rather than fetched — this is a
 * bundler for our own storage, not a proxy for arbitrary addresses.
 *
 * Access is the route's: it sits under the property-capture module grant like
 * every other route in the file, and the unguessable-key rule that makes
 * single-file links work is not leaned on here.
 */

/** The storage key a stored file URL points at, or null if it is not one of ours. */
export function keyOfStoredUrl(rawUrl) {
  /* Stored URLs from one deployment contain a newline inside them (the API base
     they were built from ended in one). The URL parser ignores it; a string
     search does not, so it is stripped first. */
  const url = String(rawUrl ?? '').replace(/\s+/g, '');
  const at = url.indexOf('/files/');
  if (at < 0) return null;
  const rest = url.slice(at + '/files/'.length).split(/[?#]/)[0];
  let key;
  try { key = decodeURIComponent(rest); } catch { return null; }
  if (!key || key.includes('..') || !key.startsWith(`${config.s3.rootPrefix}/`)) return null;
  return key;
}

/** A readable name when the caller gave none: the last path piece, minus our id prefix. */
function nameOfKey(key) {
  const tail = key.split('/').pop() || 'file';
  return tail.replace(/^[A-Za-z0-9_-]{8,24}-/, '');
}

/**
 * Work out what can be bundled BEFORE anything is sent, so the response headers
 * can say what was left out — headers cannot be added once the body is streaming.
 *
 * @returns { entries, skipped }  entries ready for writeZip; skipped: [{ name, why }]
 */
export async function planBundle(files = []) {
  const taken = new Set();
  const entries = [];
  const skipped = [];

  for (const f of files) {
    const key = keyOfStoredUrl(f.url);
    const label = String(f.name || '').trim() || (key ? nameOfKey(key) : 'file');
    if (!key) { skipped.push({ name: label, why: 'not stored here' }); continue; }
    if (!(await headObject(key))) { skipped.push({ name: label, why: 'missing from storage' }); continue; }
    const name = uniqueName(safeEntryName(label), taken);
    entries.push({ name, stream: () => getObjectStream(key) });
  }
  return { entries, skipped };
}

export { writeZip };
