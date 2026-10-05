import { api } from '../../lib/api.js';

/**
 * DOWNLOADING THE DOCUMENTS SOMEBODY TICKED.
 *
 * ONE FILE goes straight to the browser as a normal download. ONE OR MORE
 * does not go through this page at all for reading: the files sit behind a
 * redirect to private storage that sends no CORS headers, so a script on this
 * page can neither read them nor put them in an archive.
 *
 *   one file   -> the file's own link with `?download=<name>`, which asks
 *                 storage for `Content-Disposition: attachment`. Plain
 *                 navigation, so nothing is read by the page and nothing is
 *                 blocked. The same file, saved under its name.
 *   several    -> the server bundles them and streams ONE .zip back
 *                 (POST property-capture/download-bundle). The request carries
 *                 the user's login, so who may bundle is the module's grant.
 *
 * A file that is not ours to fetch (a Google Drive link) cannot be bundled and
 * is opened in its own tab instead of being silently dropped — and a bundle
 * that had to leave something out says what, via the returned `skipped`.
 */

/** Stored URLs from one deployment have a newline inside them; links must not. */
const clean = (u) => String(u || '').replace(/\s+/g, '');

/** True for a link into this app's own file storage (the /files proxy). */
export const isStoredFile = (u) => /\/files\//.test(clean(u));

/** The name a downloaded file should have: its own, or the last part of its URL. */
export function downloadNameOf(entry, fallback = 'file') {
  const own = String(entry?.originalName || entry?.name || '').trim();
  if (own) return own;
  try {
    const tail = decodeURIComponent(new URL(clean(entry?.url)).pathname.split('/').filter(Boolean).pop() || '');
    return tail.replace(/^[A-Za-z0-9_-]{8,24}-/, '') || fallback;
  } catch {
    return fallback;
  }
}

/** Save a Blob under a name, the way a click on a download link does. */
function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoked on a delay: revoking inside the click can cancel the save in some
     browsers before it has begun reading the blob. */
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** The filename out of a Content-Disposition header, if it carries one. */
function nameFromDisposition(header) {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header || '');
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(header || '');
  return plain ? plain[1] : null;
}

/**
 * @param entries      [{ url, name | originalName, ... }] — only the ticked ones
 * @param archiveName  what the .zip is called when there are several
 * @returns            { mode: 'single' | 'zip' | 'none', count, skipped: [{name, why}] }
 * @throws             with a readable `.message` when the bundle could not be made
 */
export async function downloadDocuments(entries, { archiveName = 'Property documents' } = {}) {
  const list = (entries || []).filter((e) => clean(e?.url));
  if (!list.length) return { mode: 'none', count: 0, skipped: [] };

  /* ── exactly one ─────────────────────────────────────────────────────── */
  if (list.length === 1) {
    const e = list[0];
    const url = clean(e.url);
    if (!isStoredFile(url)) {
      /* Not in our storage: there is nothing to attach a filename to, so it is
         opened, which is what such a link has always done. */
      window.open(url, '_blank', 'noopener');
      return { mode: 'single', count: 1, skipped: [] };
    }
    const sep = url.includes('?') ? '&' : '?';
    const a = document.createElement('a');
    a.href = `${url}${sep}download=${encodeURIComponent(downloadNameOf(e))}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { mode: 'single', count: 1, skipped: [] };
  }

  /* ── several ─────────────────────────────────────────────────────────── */
  let res;
  try {
    res = await api.post(
      '/pms/property-capture/download-bundle',
      { archiveName, files: list.map((e) => ({ url: clean(e.url), name: downloadNameOf(e) })) },
      { responseType: 'blob' },
    );
  } catch (err) {
    /* A failed request still has a blob body; the server's message is in it. */
    let message = 'The documents could not be downloaded. Please try again.';
    try {
      const text = await err?.response?.data?.text?.();
      const parsed = text ? JSON.parse(text) : null;
      if (parsed?.message) message = parsed.message;
    } catch { /* keep the generic one */ }
    throw new Error(message);
  }

  let skipped = [];
  try { skipped = JSON.parse(decodeURIComponent(res.headers?.['x-zip-skipped'] || '[]')); } catch { /* none */ }
  const name = nameFromDisposition(res.headers?.['content-disposition']) || `${archiveName}.zip`;
  saveBlob(res.data, name);
  return { mode: 'zip', count: Number(res.headers?.['x-zip-count']) || list.length - skipped.length, skipped };
}
