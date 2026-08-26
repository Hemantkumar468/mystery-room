import { Router } from 'express';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { publicIntakeLimiter, honeypot } from '../crm/intake/intake.guards.js';
import { uploadSingle } from '../../core/middleware/upload.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { publicTenantContext } from '../../core/tenancy/tenancy.js';
import { publicApplySchema } from './hrms.validation.js';
import { hrmsService } from './hrms.service.js';
import { Requisition } from './requisitions/requisition.model.js';
import { REQUISITION_STATUS } from '../hrms/hrms.constants.js';

/**
 * The UNAUTHENTICATED half of HRMS — the job page an applicant sees, and the
 * form they submit. Mounted at /hrms/public, before the authenticated router.
 *
 * Two routes, each deliberately minimal in what it reveals:
 *   GET  /jobs/:id   the public face of an OPEN requisition — title, JD,
 *                    location, type; never the hiring manager, never the
 *                    pipeline, salary only when the requisition allows it.
 *   POST /jobs/:id/apply   rate-limited, honeypot-guarded. Always answers as
 *                    if it worked: a public form must not be a lookup oracle.
 */
const router = Router();

// No session on these routes, so nothing names the company. Same device as
// CRM's public intake: the single company is used while one exists, and the
// moment a second appears this refuses loudly instead of guessing whose
// applicant this is.
router.use(publicTenantContext('A public HRMS request (job page, application form)'));

router.get('/jobs/:id', asyncHandler(async (req, res) => {
  const r = await Requisition.findOne({ _id: req.params.id, deletedAt: null }).populate('project', 'name city').lean();
  if (!r || r.status !== REQUISITION_STATUS.OPEN || !r.acceptingApplications) {
    return ApiResponse.ok(res, null, 'This job is no longer open');
  }
  return ApiResponse.ok(res, {
    _id: r._id,
    code: r.code,
    title: r.title,
    department: r.department,
    city: r.city,
    location: r.location,
    centre: r.project?.name || null,
    employmentType: r.employmentType,
    experienceMinYears: r.experienceMinYears,
    experienceMaxYears: r.experienceMaxYears,
    headcount: r.headcount,
    salary: r.showSalary ? { min: r.salaryMin, max: r.salaryMax } : null,
    jd: {
      summary: r.jd?.summary || '',
      responsibilities: r.jd?.responsibilities || [],
      requirements: r.jd?.requirements || [],
      niceToHave: r.jd?.niceToHave || [],
    },
  }, 'Job');
}));

router.post(
  '/jobs/:id/apply',
  publicIntakeLimiter,
  honeypot,
  validate(publicApplySchema),
  asyncHandler(async (req, res) => {
    if (req.isHoneypot) return ApiResponse.created(res, { received: true }, 'Thanks — we will be in touch.');
    const { website, ...data } = req.body;
    await hrmsService.applyPublic(req.params.id, data);
    return ApiResponse.created(res, { received: true }, 'Thanks — your application is in.');
  }),
);

/**
 * A CV, uploaded before the form is submitted.
 *
 * Two things happen and they are deliberately independent: the file is stored,
 * and then we TRY to read it. Parsing is best-effort — an unreadable CV, a
 * scanned image, AI switched off, all return the stored URL with no fields and
 * the applicant simply types. Losing an application because a PDF was awkward
 * would be the worst possible trade.
 *
 * Public, so the guards matter: the same rate limiter as the form, a hard type
 * allow-list (a public upload endpoint that accepts anything is a file drop for
 * the internet), and a 5 MB cap — a CV that large is a scan, not a document.
 */
const RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const RESUME_MAX_BYTES = 5 * 1024 * 1024;

router.post(
  '/resume',
  publicIntakeLimiter,
  uploadSingle('resume'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest('Attach a PDF or Word file');

    const name = String(file.originalname || '').toLowerCase();
    const looksRight = RESUME_TYPES.has(file.mimetype)
      || /\.(pdf|doc|docx)$/.test(name);
    if (!looksRight) {
      throw ApiError.badRequest('That file type is not accepted — upload a PDF or a Word document');
    }
    if (file.size > RESUME_MAX_BYTES) {
      throw ApiError.badRequest('That file is over 5 MB — upload a smaller PDF');
    }

    const stored = await hrmsService.storeResume(file);
    const read = await hrmsService.parseResume(file.buffer, file.mimetype, file.originalname);

    return ApiResponse.created(res, { ...stored, ...read }, 'Resume uploaded');
  }),
);


export default router;
