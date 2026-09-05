import { FranchiseEnquiry } from './franchiseEnquiry.model.js';
import { Record } from '../records/record.model.js';
import { projectService } from '../projects/project.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { activityService } from '../activity/activity.service.js';
import { ACTIVITY_ACTIONS } from '../../../core/constants/index.js';

/**
 * Franchise enquiries: the public submission, the MD's queue, and the
 * decision — where an approval does the real work.
 *
 * APPROVE = a project exists. Not a note, not a task for someone to remember:
 * the service creates the project with kind 'franchise' (which auto-completes
 * Phases 1-2 — the franchisee's submission IS the property capture, and the
 * commitment replaces the comparative assessment), files the property itself
 * as an APPROVED Phase 1 record so LOI and every later phase have a real site
 * to hang off, and links the project back to the enquiry. The MD lands on a
 * project standing at Phase 3, ready for the LOI.
 *
 * REJECT always records why — the reason is for the expansion team's map as
 * much as for the applicant.
 */

export const franchiseService = {
  /** Public intake. Trusts nothing; stores exactly what was said. */
  async submit(data) {
    const enquiry = await FranchiseEnquiry.create({
      name: data.name,
      phone: data.phone,
      email: data.email,
      background: data.background,
      city: data.city,
      locality: data.locality,
      address: data.address,
      carpetAreaSqft: data.carpetAreaSqft,
      floor: data.floor,
      ownership: data.ownership,
      location: data.location,
      photos: (data.photos || []).slice(0, 10),
      investmentReady: data.investmentReady,
      message: data.message,
    });
    return { id: enquiry._id };
  },

  async list({ status } = {}) {
    const filter = {};
    if (status) filter.status = status;
    return FranchiseEnquiry.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('decidedBy', 'name')
      .populate('project', 'name code')
      .lean();
  },

  async decide(id, { decision, reason }, user) {
    const enquiry = await FranchiseEnquiry.findById(id);
    if (!enquiry) throw ApiError.notFound('Enquiry not found');
    if (enquiry.status !== 'submitted') {
      throw ApiError.badRequest(`This enquiry was already ${enquiry.status}.`);
    }

    if (decision === 'reject') {
      if (!reason?.trim()) {
        throw ApiError.badRequest('A reason is needed to reject — it is the record of why this city said no.', {
          code: 'REJECTION_REASON_REQUIRED',
        });
      }
      enquiry.status = 'rejected';
      enquiry.rejectReason = reason.trim();
      enquiry.decidedBy = user._id;
      enquiry.decidedAt = new Date();
      await enquiry.save();
      return enquiry.toObject();
    }
    if (decision !== 'approve') throw ApiError.badRequest('Unknown decision');

    /* ── Approval births the project. ── */
    const project = await projectService.create({
      name: `${enquiry.city} — ${enquiry.name} (franchise)`,
      city: enquiry.city,
      address: enquiry.address,
      areaSqft: enquiry.carpetAreaSqft,
      description: [
        `Franchise project from an approved enquiry by ${enquiry.name} (${enquiry.phone}).`,
        enquiry.background ? `Applicant: ${enquiry.background}` : null,
        enquiry.message ? `Their words: ${enquiry.message}` : null,
      ].filter(Boolean).join('\n'),
      plannedStartDate: new Date(),
      owner: user._id,
      kind: 'franchise',
      tags: ['franchise'],
    }, user._id || user.id);

    /* The franchisee's property, filed as the project's APPROVED Phase 1
       record — LOI and everything after it need a real site to point at.
       Built directly (trusted server path): the applicant already submitted
       it, and the MD's approval of the enquiry IS the property decision. */
    const property = await Record.create({
      project: project._id,
      stageKey: 'p1',
      title: `${enquiry.locality || enquiry.city} — franchisee's property`,
      status: 'approved',
      approvedBy: user._id,
      approvedAt: new Date(),
      values: {
        property_name: `${enquiry.locality || enquiry.city} — franchisee's property`,
        city: enquiry.city,
        locality: enquiry.locality,
        address: enquiry.address,
        carpet_area: enquiry.carpetAreaSqft,
        floor: enquiry.floor,
        broker_name: `${enquiry.name} (franchisee)`,
        contact_phone: enquiry.phone,
        ...(Number.isFinite(enquiry.location?.lat) && Number.isFinite(enquiry.location?.lng)
          ? { live_location: { lat: enquiry.location.lat, lng: enquiry.location.lng, capturedAt: enquiry.createdAt } }
          : {}),
        ...(enquiry.photos?.length ? { photos: enquiry.photos.map((p) => ({ url: p.url, name: p.name, publicId: p.publicId })) } : {}),
        remarks: 'Submitted by the franchisee through the public enquiry form; approved with the enquiry.',
      },
    });

    enquiry.status = 'approved';
    enquiry.decidedBy = user._id;
    enquiry.decidedAt = new Date();
    enquiry.project = project._id;
    await enquiry.save();

    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: user._id,
      message: `Franchise enquiry from ${enquiry.name} (${enquiry.city}) approved — project starts at Phase 3 (LOI); their property filed and approved as the site.`,
    });

    return { ...enquiry.toObject(), project: { _id: project._id, name: project.name, code: project.code }, propertyRecordId: property._id };
  },
};

export default franchiseService;
