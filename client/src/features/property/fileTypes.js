import {
  Image as ImageIcon, Video, FileText, FileSpreadsheet, Presentation,
  Music, Link2, FileArchive, File as FileIcon,
} from 'lucide-react';

/**
 * WHAT KIND OF FILE IS THIS — decided once, for every place that shows one.
 *
 * The record stores each upload under the FIELD it was uploaded into (photos,
 * videos, documents), and that field is a poor guide to what the file is: a
 * site photo uploaded through the Documents field is a photo, and a lease
 * scanned to a JPEG is an image whatever the lease form calls it. The viewer
 * needs the truth about the BYTES — it decides whether to draw an <img>, a
 * <video> or a PDF frame — so the order of evidence here is:
 *
 *   1. the MIME type, where the upload recorded one (it knows)
 *   2. the file extension, on the name and then on the URL
 *   3. the field it was filed under, only as a last resort
 *
 * Extend FILE_TYPES, not the callers: adding spreadsheets' cousins or a new
 * video container is one line here, and the icon, the label and whether the
 * viewer can show it inline all follow.
 */
export const FILE_TYPES = {
  image: { label: 'Image', icon: ImageIcon, tone: '#2563eb', inline: true, ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic', 'heif'] },
  video: { label: 'Video', icon: Video, tone: '#7c3aed', inline: true, ext: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv', '3gp'] },
  audio: { label: 'Audio', icon: Music, tone: '#0891b2', inline: true, ext: ['mp3', 'wav', 'm4a', 'aac', 'oga', 'ogg', 'opus', 'weba'] },
  pdf: { label: 'PDF', icon: FileText, tone: '#dc2626', inline: true, ext: ['pdf'] },
  word: { label: 'Word', icon: FileText, tone: '#1d4ed8', inline: false, ext: ['doc', 'docx', 'rtf', 'odt', 'txt'] },
  excel: { label: 'Excel', icon: FileSpreadsheet, tone: '#15803d', inline: false, ext: ['xls', 'xlsx', 'csv', 'ods'] },
  slides: { label: 'Slides', icon: Presentation, tone: '#c2410c', inline: false, ext: ['ppt', 'pptx', 'odp'] },
  archive: { label: 'Archive', icon: FileArchive, tone: '#64748b', inline: false, ext: ['zip', 'rar', '7z', 'tar', 'gz'] },
  link: { label: 'Link', icon: Link2, tone: '#0369a1', inline: false, ext: [] },
  file: { label: 'File', icon: FileIcon, tone: '#64748b', inline: false, ext: [] },
};

const BY_EXT = new Map(Object.entries(FILE_TYPES).flatMap(([key, t]) => t.ext.map((e) => [e, key])));

const extOf = (text) => {
  const m = String(text || '').split(/[?#]/)[0].match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : '';
};

const fromMime = (mime) => {
  const m = String(mime || '').toLowerCase();
  if (!m) return null;
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (/msword|wordprocessingml|rtf|opendocument\.text|text\/plain/.test(m)) return 'word';
  if (/ms-excel|spreadsheetml|opendocument\.spreadsheet|text\/csv/.test(m)) return 'excel';
  if (/ms-powerpoint|presentationml|opendocument\.presentation/.test(m)) return 'slides';
  if (/zip|rar|7z|tar|gzip/.test(m)) return 'archive';
  return null;
};

const FROM_FIELD = { photo: 'image', video: 'video', audio: 'audio', link: 'link' };

/** The FILE_TYPES key for one file: 'image' | 'video' | 'pdf' | 'word' | ... | 'file'. */
export function fileTypeOf(file) {
  if (!file) return 'file';
  return fromMime(file.mime)
    || BY_EXT.get(extOf(file.name))
    || BY_EXT.get(extOf(file.url))
    || FROM_FIELD[file.kind]
    || 'file';
}

/** Icon, label, colour and whether the viewer can show it in place. */
export const fileMetaOf = (file) => FILE_TYPES[fileTypeOf(file)];

/** "1.4 MB" — or null when the upload never recorded a size, so no dash is drawn. */
export function fileSizeText(file) {
  const n = Number(file?.size);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
