import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

/**
 * In-memory upload middleware. Files are held as buffers (never written to
 * local disk) and streamed straight to S3 by the service layer.
 *
 * Size policy (no prior convention beyond a flat 10 MB): videos up to 50 MB,
 * audio up to 20 MB, everything else (images/documents/archives) up to 10 MB.
 * Multer's own limit is the largest of the three; the tighter per-type caps
 * are enforced afterwards by `enforceTypeSizeLimits` once size is known.
 */
const MB = 1024 * 1024;
const DEFAULT_MAX = 10 * MB; // images, documents, archives
const AUDIO_MAX = 20 * MB;
const VIDEO_MAX = 50 * MB;
/**
 * CAD / design files get their own, much larger cap.
 *
 * A single architectural DWG with xrefs, or a Revit model, routinely runs past
 * 50 MB — and these are the deliverable of an entire phase, not an attachment.
 * A 10 MB limit meant the drawings phase could not receive a real drawing.
 *
 * 150 MB is a deliberate ceiling, not an arbitrary one: files are buffered in
 * MEMORY (see storage below) before streaming to S3, so this much is briefly
 * resident per concurrent upload. Raising it further means moving to disk
 * storage or presigned direct-to-S3 uploads, which is the right answer above
 * this size rather than a bigger number here.
 */
const DESIGN_MAX = 150 * MB;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska',
]); // .mp4 .mov .webm .avi .mkv
const AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
  'audio/webm', // MediaRecorder's default output in Chrome/Firefox (in-browser mic recording)
]); // .mp3 .wav .m4a .aac .ogg .webm
const DOC_MIME = new Set([
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain', // .txt
  'text/csv', // .csv
  'application/csv', 'text/x-csv', // .csv as some Windows browsers report it
  'application/rtf', 'text/rtf', // .rtf
  'application/vnd.oasis.opendocument.text', // .odt
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  'application/vnd.oasis.opendocument.presentation', // .odp
]);
const ARCHIVE_MIME = new Set([
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.rar', 'application/x-rar-compressed',
  'application/x-7z-compressed',
]); // .zip .rar .7z
const ALLOWED_MIME = new Set([
  ...IMAGE_MIME, ...VIDEO_MIME, ...AUDIO_MIME, ...DOC_MIME, ...ARCHIVE_MIME,
]);

/**
 * CAD and design formats, matched by EXTENSION rather than MIME type.
 *
 * This has to be extension-based: browsers have no registered MIME type for
 * most of these and send `application/octet-stream`, so a MIME allow-list
 * rejects every one of them — which is exactly why uploading a .dwg failed.
 * Some send vendor strings (`image/vnd.dwg`, `application/acad`) that vary by
 * OS and browser, so the file name is the only reliable signal available.
 */
const DESIGN_EXT = new Set([
  // 2D CAD
  '.dwg', '.dxf', '.dwf', '.dgn',
  // BIM / 3D
  '.rvt', '.rfa', '.ifc', '.skp', '.3ds', '.max', '.obj', '.fbx', '.dae', '.blend',
  // Engineering / manufacturing
  '.step', '.stp', '.iges', '.igs', '.stl', '.sldprt', '.sldasm',
  // Graphic design
  '.ai', '.psd', '.indd', '.eps', '.cdr', '.sketch', '.fig', '.xd', '.afdesign',
]);

/**
 * Office/text/archive formats by EXTENSION, for the same reason as DESIGN_EXT:
 * Windows browsers routinely send .xlsx, .csv and friends as
 * application/octet-stream (having Excel installed changes the registered type),
 * so the MIME allow-list alone 400s a perfectly ordinary spreadsheet.
 */
const DOC_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.csv', '.tsv', '.txt', '.rtf',
  '.ppt', '.pptx', '.odt', '.ods', '.odp', '.zip', '.rar', '.7z',
]);

const extOf = (name = '') => {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i).toLowerCase();
};

const isDesign = (file) => DESIGN_EXT.has(extOf(file?.originalname));
const isVideo = (mimetype) => VIDEO_MIME.has(mimetype);
const isAudio = (mimetype) => AUDIO_MIME.has(mimetype);

/** The size ceiling that applies to one file, by what it actually is. */
const maxFor = (file) => {
  if (isDesign(file)) return DESIGN_MAX;
  if (isVideo(file.mimetype)) return VIDEO_MAX;
  if (isAudio(file.mimetype)) return AUDIO_MAX;
  return DEFAULT_MAX;
};

/** Human label for the limit message, so the error names the real rule. */
const kindOf = (file) => {
  if (isDesign(file)) return 'design/CAD files';
  if (isVideo(file.mimetype)) return 'videos';
  if (isAudio(file.mimetype)) return 'audio';
  return 'this file type';
};

const multerUpload = multer({
  storage: multer.memoryStorage(),
  // The largest cap of any category; the tighter per-type limits are applied
  // afterwards by enforceTypeSizeLimits once the real size is known.
  limits: { fileSize: DESIGN_MAX },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    // Extension fallback — CAD/design formats and, just as often on Windows,
    // ordinary office files arrive as application/octet-stream, so the file
    // name is the only reliable signal for both.
    if (isDesign(file)) return cb(null, true);
    if (DOC_EXT.has(extOf(file?.originalname))) return cb(null, true);
    return cb(ApiError.badRequest(
      `Unsupported file type: ${file.mimetype || extOf(file.originalname) || 'unknown'}`,
    ));
  },
});

/**
 * Wrap a multer handler so its errors become ApiErrors — keeping the global
 * error handler's response shape uniform (e.g. file-too-large → 400, not 500).
 */
function withMulterErrors(handler) {
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `File is too large (max ${DESIGN_MAX / MB} MB)`
            : err.message;
        return next(ApiError.badRequest(message, { code: err.code }));
      }
      return next(err); // already an ApiError (from fileFilter) or unknown
    });
}

/**
 * Enforce the per-type cap after multer has the file: videos up to 50 MB,
 * audio up to 20 MB, everything else up to 10 MB. Runs right after `uploadSingle`.
 */
export const enforceTypeSizeLimits = (req, _res, next) => {
  const file = req.file;
  if (!file) return next();
  const max = maxFor(file);
  if (file.size > max) {
    return next(ApiError.badRequest(`File is too large (max ${max / MB} MB for ${kindOf(file)})`));
  }
  return next();
};

/** Same per-type cap as `enforceTypeSizeLimits`, applied to every file in `req.files` (array upload). */
export const enforceTypeSizeLimitsMulti = (req, _res, next) => {
  const files = req.files;
  if (!files?.length) return next();
  for (const file of files) {
    const max = maxFor(file);
    if (file.size > max) {
      return next(ApiError.badRequest(
        `"${file.originalname}" is too large (max ${max / MB} MB for ${kindOf(file)})`,
      ));
    }
  }
  return next();
};

/** Accept a single file under the given form field name. */
export const uploadSingle = (field) => withMulterErrors(multerUpload.single(field));

/** Accept up to `maxCount` files under the given form field name. */
export const uploadMultiple = (field, maxCount) => withMulterErrors(multerUpload.array(field, maxCount));

export default multerUpload;
