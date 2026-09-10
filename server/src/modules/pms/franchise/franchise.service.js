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
 * An approval takes ONE of three roads, chosen by the decider:
 *
 *  'assess' — several candidate properties. The project is created WITHOUT
 *     the usual franchise phase skips: every property is filed as a Phase 1
 *     record, the chosen ones marked shortlisted, and the normal pipeline
 *     (assessment in Phase 2, one winner approved) runs exactly as it does
 *     for our own scouting. Nothing is retyped — the applicant's data IS the
 *     capture.
 *  'loi' — one obvious property. Phases 1-2 are completed by the system,
 *     the chosen property is filed as the APPROVED site, and the project
 *     stands at Phase 3 ready for the LOI. Any other properties they sent
 *     are filed too (as submitted) so nothing they shared is lost.
 *  'scout' — no property yet, but a partner worth saying yes to. The project
 *     starts at Phase 1 — the property search — in their city of interest.
 *
 * REJECT always records why — the reason is for the expansion team's map as
 * much as for the applicant.
 */

/**
 * Old enquiries carried ONE property in flat fields. Everything downstream
 * reads `properties[]`, so legacy rows get their flat fields lifted into a
 * one-element array on the way out — no migration, no dual code paths.
 */
function normalizeEnquiry(doc) {
  if (!doc) return doc;
  const e = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if ((!e.properties || e.properties.length === 0) && (e.city || e.address)) {
    e.properties = [{
      _id: `legacy-${e._id}`,
      label: e.locality || e.city,
      city: e.city,
      locality: e.locality,
      address: e.address,
      carpetAreaSqft: e.carpetAreaSqft,
      floor: e.floor,
      ownership: e.ownership,
      location: e.location,
      photos: e.photos || [],
      videos: [],
      documents: [],
      driveLinks: [],
    }];
    e.hasProperty = true;
  }
  return e;
}

/** The values object a property becomes when filed as a Phase 1 record. */
function propertyRecordValues(enquiry, prop) {
  const links = (prop.driveLinks || []).filter(Boolean);
  const extra = [
    prop.remarks,
    links.length ? `Drive links shared by the applicant: ${links.join(' , ')}` : null,
    (prop.videos || []).length ? `Videos: ${prop.videos.map((v) => v.url).join(' , ')}` : null,
    (prop.documents || []).length ? `Documents: ${prop.documents.map((d) => d.url).join(' , ')}` : null,
  ].filter(Boolean).join('\n');
  return {
    property_name: prop.label || `${prop.locality || prop.city} — franchisee's property`,
    city: prop.city,
    locality: prop.locality,
    address: prop.address,
    carpet_area: prop.carpetAreaSqft,
    floor: prop.floor,
    broker_name: `${enquiry.name} (franchisee)`,
    contact_phone: enquiry.phone,
    ...(Number.isFinite(prop.location?.lat) && Number.isFinite(prop.location?.lng)
      ? { live_location: { lat: prop.location.lat, lng: prop.location.lng, capturedAt: enquiry.createdAt } }
      : {}),
    ...((prop.photos || []).length ? { photos: prop.photos.map((p) => ({ url: p.url, name: p.name, publicId: p.publicId })) } : {}),
    /* Raw media kept on the record too, for anything that learns to read them. */
    ...((prop.videos || []).length ? { videos: prop.videos.map((v) => ({ url: v.url, name: v.name })) } : {}),
    ...((prop.documents || []).length ? { documents: prop.documents.map((d) => ({ url: d.url, name: d.name })) } : {}),
    ...(links.length ? { drive_links: links } : {}),
    remarks: ['Submitted by the franchisee through the public enquiry form.', extra].filter(Boolean).join('\n'),
  };
}

export const franchiseService = {
  /** Public intake. Trusts nothing; stores exactly what was said. */
  async submit(data) {
    const hasProperty = data.hasProperty !== false;
    const enquiry = await FranchiseEnquiry.create({
      name: data.name,
      phone: data.phone,
      email: data.email,
      background: data.background,
      hasProperty,
      properties: hasProperty
        ? (data.properties || []).slice(0, 12).map((p) => ({
            label: p.label,
            city: p.city,
            locality: p.locality,
            address: p.address,
            carpetAreaSqft: p.carpetAreaSqft,
            floor: p.floor,
            ownership: p.ownership,
            location: p.location,
            photos: (p.photos || []).slice(0, 10),
            videos: (p.videos || []).slice(0, 4),
            documents: (p.documents || []).slice(0, 6),
            driveLinks: (p.driveLinks || []).slice(0, 6),
            remarks: p.remarks,
          }))
        : [],
      interestCity: hasProperty ? undefined : data.interestCity,
      interestArea: hasProperty ? undefined : data.interestArea,
      plan: hasProperty ? undefined : data.plan,
      investmentReady: data.investmentReady,
      message: data.message,
    });
    return { id: enquiry._id };
  },

  async list({ status } = {}) {
    const filter = {};
    if (status) filter.status = status;
    const rows = await FranchiseEnquiry.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('decidedBy', 'name')
      .populate('project', 'name code')
      .lean();
    return rows.map(normalizeEnquiry);
  },

  async get(id) {
    const doc = await FranchiseEnquiry.findById(id)
      .populate('decidedBy', 'name')
      .populate('project', 'name code')
      .lean();
    if (!doc) throw ApiError.notFound('Enquiry not found');
    return normalizeEnquiry(doc);
  },

  async decide(id, { decision, reason, mode, propertyIds = [] }, user) {
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
      return normalizeEnquiry(enquiry);
    }
    if (decision !== 'approve') throw ApiError.badRequest('Unknown decision');

    const norm = normalizeEnquiry(enquiry);
    const props = norm.properties || [];

    /* Which road? Default sensibly: properties present → 'loi' if exactly one,
       'assess' if several; none → 'scout'. The client always sends it. */
    const road = mode || (props.length === 0 ? 'scout' : props.length === 1 ? 'loi' : 'assess');
    const wanted = new Set(propertyIds.map(String));
    const chosen = props.filter((p) => wanted.has(String(p._id)));

    if (road === 'loi') {
      if (props.length === 0) throw ApiError.badRequest('This applicant has no property — start a property search instead.');
      if (props.length > 1 && chosen.length !== 1) {
        throw ApiError.badRequest('Going straight to LOI needs exactly one chosen property.');
      }
    }
    if (road === 'assess') {
      if (props.length === 0) throw ApiError.badRequest('This applicant has no property — start a property search instead.');
      if (chosen.length === 0) throw ApiError.badRequest('Shortlist at least one property to assess.');
    }
    if (road === 'scout' && !norm.interestCity && props.length === 0) {
      throw ApiError.badRequest('No city of interest on this enquiry.');
    }

    const site = road === 'loi' ? (chosen[0] || props[0]) : null;
    const projectCity = site?.city || chosen[0]?.city || props[0]?.city || norm.interestCity;
    const areaSqft = site?.carpetAreaSqft || chosen[0]?.carpetAreaSqft;

    /* ── Approval births the project — shaped by the road taken. ── */
    const project = await projectService.create({
      name: `${projectCity} — ${enquiry.name} (franchise)`,
      city: projectCity,
      address: site?.address,
      areaSqft,
      description: [
        `Franchise project from an approved enquiry by ${enquiry.name} (${enquiry.phone}).`,
        enquiry.background ? `Applicant: ${enquiry.background}` : null,
        road === 'scout' && norm.interestArea ? `Preferred area: ${norm.interestArea}` : null,
        road === 'scout' && norm.plan ? `Their plan: ${norm.plan}` : null,
        enquiry.message ? `Their words: ${enquiry.message}` : null,
      ].filter(Boolean).join('\n'),
      plannedStartDate: new Date(),
      owner: user._id,
      kind: 'franchise',
      /* 'loi' keeps the franchise skip (Phases 1-2 done by the system);
         the other two roads RUN those phases, so nothing is skipped. */
      ...(road === 'loi' ? {} : { skipPhases: [] }),
      tags: ['franchise'],
    }, user._id || user.id);

    /* File every property the applicant brought — the submission IS the
       Phase 1 capture. Status depends on the road. */
    const now = new Date();
    for (const prop of props) {
      const isSite = road === 'loi' && String(prop._id) === String((site || {})._id);
      const isShortlisted = road === 'assess' && wanted.has(String(prop._id));
      await Record.create({
        project: project._id,
        stageKey: 'p1',
        title: prop.label || `${prop.locality || prop.city} — franchisee's property`,
        status: isSite ? 'approved' : isShortlisted ? 'shortlisted' : 'submitted',
        ...(isSite ? { approvedBy: user._id, approvedAt: now } : {}),
        values: propertyRecordValues(norm, prop),
      });
    }

    // Properties filed as shortlisted need their Phase 2 assessment tasks now.
    if (road === 'assess') await projectService.syncAssessmentTasks(project._id, { actorId: user._id || user.id });

    enquiry.status = 'approved';
    enquiry.decisionMode = road;
    enquiry.decidedBy = user._id;
    enquiry.decidedAt = now;
    enquiry.project = project._id;
    await enquiry.save();

    const roadStory = {
      loi: 'project starts at Phase 3 (LOI); their property filed and approved as the site',
      assess: `project starts at Phase 1 with ${props.length} propert${props.length === 1 ? 'y' : 'ies'} filed, ${chosen.length} shortlisted for assessment`,
      scout: `project starts at Phase 1 — property search in ${projectCity}`,
    }[road];
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: user._id,
      message: `Franchise enquiry from ${enquiry.name} (${projectCity}) approved — ${roadStory}.`,
    });

    return { ...normalizeEnquiry(enquiry), project: { _id: project._id, name: project.name, code: project.code } };
  },
};

export default franchiseService;
