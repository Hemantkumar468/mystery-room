import { Router } from 'express';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { publicIntakeLimiter, honeypot } from '../crm/intake/intake.guards.js';
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

export default router;
