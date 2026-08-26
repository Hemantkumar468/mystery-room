import mongoose from 'mongoose';
import { Requisition } from './requisitions/requisition.model.js';
import { Candidate } from './candidates/candidate.model.js';
import { Project } from '../pms/projects/project.model.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { logger } from '../../config/logger.js';
import crypto from 'node:crypto';
import { can, ROLES, ROLE_VALUES } from '../../core/constants/index.js';
import { authService } from '../auth/auth.service.js';
import { withProvider, assertAiAvailable } from '../ai/providers/index.js';
import {
  REQUISITION_STATUS, CANDIDATE_STAGE, CANDIDATE_STAGE_VALUES, PIPELINE_ORDER, CANDIDATE_SOURCE,
} from './hrms.constants.js';

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (v) => mongoose.isValidObjectId(v);

/**
 * Who may CHANGE hiring data: anyone who manages (MD, EA, Manager) and anyone
 * in the HR department regardless of role — a recruiter is usually an
 * Employee by role and must still be able to work a pipeline. Everyone signed
 * in may read; a hiring manager in Operations needs to see their own
 * candidates.
 */
/**
 * Who may turn a hire into a LOGIN ACCOUNT: the MD and the EA only. This is
 * credentials, not hiring data, so the wider canHr gate (which admits any
 * manager and the HR department) is deliberately not enough.
 */
export const canCreateAccounts = (user) => Boolean(user) && (can.administer(user.role) || user.role === ROLES.EA);

export const canHr = (user) => Boolean(user) && (can.manage(user.role) || user.department === 'hr');

function assertHr(user) {
  if (!canHr(user)) throw ApiError.forbidden('Only HR or a manager can change hiring records');
}

/** REQ-0001 style code. Unique index catches a race; one retry covers it. */
async function nextCode() {
  const n = await Requisition.countDocuments();
  return `REQ-${String(n + 1).padStart(4, '0')}`;
}

const POPULATE_REQ = [
  { path: 'project', select: 'name code city' },
  { path: 'hiringManager', select: 'name avatarColor department' },
  { path: 'createdBy', select: 'name avatarColor' },
];

/* ── AI job description ──────────────────────────────────── */

const JD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2–4 sentences. What the role is, who it serves, why it matters at an escape-room centre. Plain Indian-English, no buzzwords.' },
    responsibilities: { type: 'array', items: { type: 'string' }, description: '5–8 concrete things the person does in a typical shift. Each under 20 words.' },
    requirements: { type: 'array', items: { type: 'string' }, description: '4–6 must-haves: experience, skills, availability (evenings/weekends are the peak for this business). Each under 20 words.' },
    niceToHave: { type: 'array', items: { type: 'string' }, description: '2–4 genuinely optional extras. Each under 15 words.' },
  },
  required: ['summary', 'responsibilities', 'requirements', 'niceToHave'],
};

/**
 * What we try to read off a CV. Every field is optional on purpose: a resume
 * that does not state a notice period must come back without one rather than
 * with a guess, because the applicant sees these values pre-filled and a
 * confident wrong number is worse than an empty box they would have filled in.
 */
const RESUME_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: "The candidate's full name as written on the CV. Empty string if unclear." },
    email: { type: 'string', description: 'Primary email address. Empty string if absent.' },
    phone: { type: 'string', description: 'Primary phone number, digits and + only. Empty string if absent.' },
    city: { type: 'string', description: 'The city they currently live in. Empty string if absent.' },
    experienceYears: { type: 'number', description: 'Total years of work experience, rounded to a whole number. 0 if a fresher or unclear.' },
    currentSalary: { type: 'number', description: 'Current annual salary in rupees, if stated. 0 if not stated.' },
    expectedSalary: { type: 'number', description: 'Expected annual salary in rupees, if stated. 0 if not stated.' },
    noticePeriodDays: { type: 'number', description: 'Notice period in days, if stated. 0 if not stated.' },
    coverNote: { type: 'string', description: 'Two or three plain sentences summarising what this person has done, in third person. No adjectives of praise.' },
  },
  required: ['name', 'email', 'phone', 'city', 'experienceYears', 'coverNote'],
};

const RESUME_SYSTEM = [
  'You read a CV and extract only what it actually says. You are filling a form',
  'the applicant is about to check and correct, so a blank is always better than',
  'a guess: if the CV does not state something, return an empty string or 0.',
  'Never invent an employer, a qualification, a salary or a date. Salaries are',
  'Indian rupees per year — convert "12 LPA" to 1200000 and "45,000/month" to',
  '540000. Return the phone number without spaces or brackets.',
].join(' ');

const JD_SYSTEM = [
  'You write job descriptions for Mystery Rooms, an Indian escape-room and location-based',
  'entertainment company opening new centres. Guests book online, arrive in groups of 2–8,',
  'and play themed 60–90 minute games run by a Game Master. Peak hours are evenings and',
  'weekends; centres run 2–3 shifts up to midnight.',
  '',
  'Write for a real applicant reading on a phone: specific, honest about hours, free of',
  'filler ("dynamic", "rockstar", "fast-paced environment"). Never invent pay, benefits or',
  'company facts you were not given. Return only the JSON the schema asks for.',
].join('\n');

/* ── Service ─────────────────────────────────────────────── */

export const hrmsService = {
  /* Requisitions */

  async listRequisitions(query = {}) {
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.department) where.department = query.department;
    if (query.project && isId(query.project)) where.project = query.project;
    if (query.city) where.city = new RegExp(escape(query.city), 'i');
    if (query.search) {
      const rx = new RegExp(escape(query.search), 'i');
      where.$or = [{ title: rx }, { code: rx }, { city: rx }, { location: rx }];
    }

    const items = await Requisition.find(where).populate(POPULATE_REQ).sort({ createdAt: -1 }).lean();

    // Pipeline counts per requisition in one query, not N.
    const ids = items.map((r) => r._id);
    const counts = await Candidate.aggregate([
      { $match: { requisition: { $in: ids }, deletedAt: null } },
      { $group: { _id: { req: '$requisition', stage: '$stage' }, n: { $sum: 1 } } },
    ]);
    const byReq = new Map();
    for (const c of counts) {
      const k = String(c._id.req);
      const row = byReq.get(k) || { total: 0 };
      row[c._id.stage] = c.n;
      if (c._id.stage !== CANDIDATE_STAGE.REJECTED) row.total += c.n;
      byReq.set(k, row);
    }
    return items.map((r) => ({ ...r, pipeline: byReq.get(String(r._id)) || { total: 0 } }));
  },

  async getRequisition(id) {
    if (!isId(id)) throw ApiError.notFound('Requisition not found');
    const r = await Requisition.findOne({ _id: id, deletedAt: null }).populate(POPULATE_REQ).lean();
    if (!r) throw ApiError.notFound('Requisition not found');
    const candidates = await Candidate.find({ requisition: id, deletedAt: null })
      .populate('owner', 'name avatarColor')
      .sort({ updatedAt: -1 })
      .lean();
    return { ...r, candidates };
  },

  async createRequisition(data, user) {
    assertHr(user);
    if (data.project && !isId(data.project)) throw ApiError.badRequest('Invalid project');
    if (data.project) {
      const p = await Project.findById(data.project).select('city name');
      if (!p) throw ApiError.notFound('Project not found');
      // A requisition for a centre inherits the centre's city unless told otherwise.
      data.city = data.city || p.city;
    }
    let code = await nextCode();
    try {
      return await Requisition.create({ ...data, code, createdBy: user._id, updatedBy: user._id });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      code = `${code}-${Date.now().toString().slice(-4)}`;
      return Requisition.create({ ...data, code, createdBy: user._id, updatedBy: user._id });
    }
  },

  async updateRequisition(id, data, user) {
    assertHr(user);
    const r = await Requisition.findOne({ _id: id, deletedAt: null });
    if (!r) throw ApiError.notFound('Requisition not found');
    // Hand edits to the JD mean it is the user's text now, whatever drafted it.
    if (data.jd) data.jd = { ...r.jd?.toObject?.() ?? r.jd, ...data.jd, generatedBy: 'user', generatedAt: undefined };
    Object.assign(r, data, { updatedBy: user._id });
    await r.save();
    return this.getRequisition(id);
  },

  async deleteRequisition(id, reason, user) {
    assertHr(user);
    const r = await Requisition.findOne({ _id: id, deletedAt: null });
    if (!r) throw ApiError.notFound('Requisition not found');
    r.deletedAt = new Date();
    r.deleteReason = reason;
    r.updatedBy = user._id;
    await r.save();
    return { ok: true };
  },

  /**
   * Draft the JD with AI. Advice only — it lands in the editable form, nothing
   * is saved until the person submits. Uses the same provider chain as the
   * rest of the app, so it works with whichever key is configured.
   */
  async draftJobDescription({ title, department, city, employmentType, experienceMinYears, experienceMaxYears, headcount, projectName, notes }) {
    assertAiAvailable();
    const prompt = [
      `Role: ${title}`,
      department ? `Department: ${department}` : null,
      city ? `Location: ${city}${projectName ? ` (new centre: ${projectName})` : ''}` : null,
      employmentType ? `Employment type: ${employmentType.replace('_', ' ')}` : null,
      experienceMinYears != null || experienceMaxYears != null
        ? `Experience: ${experienceMinYears ?? 0}–${experienceMaxYears ?? '+'} years` : null,
      headcount ? `Openings: ${headcount}` : null,
      notes ? `Hiring manager's notes: ${notes}` : null,
    ].filter(Boolean).join('\n');

    const result = await withProvider('synthesize', {
      system: JD_SYSTEM,
      prompt,
      schema: JD_SCHEMA,
      schemaName: 'job_description',
      maxOutputTokens: 1500,
    });
    const jd = result?.json ?? result;
    logger.info(`AI JD drafted for "${title}"`);
    return { ...jd, generatedBy: 'ai', generatedAt: new Date() };
  },


  /* ── Resume intake ────────────────────────────────────────── */

  /**
   * Pull plain text out of an uploaded CV.
   *
   * PDF and DOCX only. A .doc (the old binary Word format) is accepted for
   * STORAGE — losing somebody's application because of a file format would be
   * absurd — but there is no reliable pure-JS reader for it, so it simply
   * yields no text and the applicant fills the form by hand.
   */
  async extractResumeText(buffer, mimetype = '', filename = '') {
    const name = String(filename).toLowerCase();
    try {
      if (mimetype === 'application/pdf' || name.endsWith('.pdf')) {
        // pdf-parse v2 exports a PDFParse CLASS — there is no default export
        // and nothing callable. Imported the v1 way it is undefined, and then
        // every CV reads as empty without raising anything.
        const { PDFParse } = await import('pdf-parse');
        const out = await new PDFParse({ data: buffer }).getText();
        return String(out?.text || '').trim();
      }
      if (name.endsWith('.docx')
        || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const mammoth = await import('mammoth');
        const out = await mammoth.extractRawText({ buffer });
        return String(out?.value || '').trim();
      }
    } catch (err) {
      // A CV that will not parse is not a failed application. Log it and let
      // the applicant type; never reject the upload over this.
      logger.warn(`Resume text extraction failed: ${err.message}`);
    }
    return '';
  },

  /**
   * Read a CV into the shape the apply form uses.
   *
   * Returns `{ fields, parsed }` — `parsed` false when there was nothing to
   * read or AI is switched off, so the page can say "type it in yourself"
   * rather than showing an empty form that looks broken.
   */
  async parseResume(buffer, mimetype, filename) {
    const text = await this.extractResumeText(buffer, mimetype, filename);
    if (text.length < 40) return { fields: {}, parsed: false, reason: 'unreadable' };
    try {
      assertAiAvailable();
    } catch {
      // AI switched off is a normal deployment, not an error: the CV is still
      // stored and the applicant simply types the form themselves.
      return { fields: {}, parsed: false, reason: 'ai_off' };
    }

    try {
      const result = await withProvider('synthesize', {
        system: RESUME_SYSTEM,
        // A very long CV costs tokens and adds nothing: everything this form
        // needs is on the first page or two.
        prompt: text.slice(0, 12000),
        schema: RESUME_SCHEMA,
        schemaName: 'resume_fields',
        maxOutputTokens: 800,
      });
      const raw = result?.json ?? result ?? {};

      // Drop empties here rather than in the UI, so the client can treat every
      // key it receives as something the CV actually said.
      const fields = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
        if (typeof v === 'number' && v > 0) fields[k] = v;
      }
      return { fields, parsed: Object.keys(fields).length > 0 };
    } catch (err) {
      logger.warn(`Resume parse failed: ${err.message}`);
      return { fields: {}, parsed: false, reason: 'ai_error' };
    }
  },

  /** Store the CV itself and hand back the URL the candidate record keeps. */
  async storeResume(file) {
    if (!file) throw ApiError.badRequest('No file provided');
    const { isS3Configured, uploadBuffer } = await import('../../config/s3.js');
    if (!isS3Configured) {
      throw new ApiError(503, 'Resume uploads are not configured on this server', { code: 'S3_NOT_CONFIGURED' });
    }
    const result = await uploadBuffer(file.buffer, {
      folder: 'resumes',
      filename: file.originalname,
      contentType: file.mimetype,
    });
    return {
      resumeUrl: result.secure_url,
      resumeKey: result.public_id,
      resumeName: file.originalname,
      bytes: result.bytes,
    };
  },

  /* Candidates */

  async listCandidates(query = {}) {
    const where = { deletedAt: null };
    if (query.requisition && isId(query.requisition)) where.requisition = query.requisition;
    if (query.stage) where.stage = query.stage;
    if (query.source) where.source = query.source;
    if (query.search) {
      const rx = new RegExp(escape(query.search), 'i');
      where.$or = [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }];
    }
    return Candidate.find(where)
      .populate('requisition', 'title code city status')
      .populate('owner', 'name avatarColor')
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();
  },

  async createCandidate(data, user) {
    assertHr(user);
    const req = await Requisition.findOne({ _id: data.requisition, deletedAt: null });
    if (!req) throw ApiError.notFound('Requisition not found');
    const c = await Candidate.create({
      ...data,
      owner: data.owner || req.hiringManager || user._id,
      createdBy: user._id,
      stage: CANDIDATE_STAGE.APPLIED,
      stageHistory: [{ stage: CANDIDATE_STAGE.APPLIED, by: user._id, note: 'Added' }],
    });
    return c.populate('owner', 'name avatarColor');
  },

  /**
   * The public application — no user, no permission check. Duplicates by
   * phone on the same requisition are accepted but flagged in the note, so a
   * nervous applicant who submits twice does not look like two people.
   */
  async applyPublic(requisitionId, data) {
    if (!isId(requisitionId)) throw ApiError.notFound('This job is no longer available');
    const req = await Requisition.findOne({ _id: requisitionId, deletedAt: null });
    if (!req || req.status !== REQUISITION_STATUS.OPEN || !req.acceptingApplications) {
      throw ApiError.notFound('This job is no longer accepting applications');
    }
    const dup = data.phone ? await Candidate.findOne({ requisition: req._id, phone: data.phone, deletedAt: null }).select('_id') : null;
    const c = await Candidate.create({
      ...data,
      requisition: req._id,
      source: CANDIDATE_SOURCE.WEBSITE,
      owner: req.hiringManager,
      stage: CANDIDATE_STAGE.APPLIED,
      stageHistory: [{ stage: CANDIDATE_STAGE.APPLIED, note: dup ? 'Applied via the job page (repeat application)' : 'Applied via the job page' }],
    });
    logger.info(`HRMS: public application for ${req.code} (${c._id})`);
    return { received: true };
  },

  async updateCandidate(id, data, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    Object.assign(c, data);
    await c.save();
    return c.populate('owner', 'name avatarColor');
  },

  /** Move through the pipeline. Rejecting from anywhere is allowed; it needs a reason. */
  async moveCandidate(id, { stage, note, rejectionReason, rating }, user) {
    assertHr(user);
    if (!CANDIDATE_STAGE_VALUES.includes(stage)) throw ApiError.badRequest('Unknown stage');
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    if (stage === CANDIDATE_STAGE.REJECTED && !rejectionReason?.trim()) {
      throw ApiError.badRequest('A reason is needed to reject a candidate', { code: 'REJECTION_REASON_REQUIRED' });
    }
    if (c.stage === stage) return c;
    c.stage = stage;
    if (rating) c.rating = rating;
    if (stage === CANDIDATE_STAGE.REJECTED) c.rejectionReason = rejectionReason.trim();
    c.stageHistory.push({ stage, by: user._id, note: note?.trim() || undefined });
    await c.save();

    // A requisition fills itself when its headcount is hired — nobody should
    // have to remember to close it.
    if (stage === CANDIDATE_STAGE.HIRED) {
      const hired = await Candidate.countDocuments({ requisition: c.requisition, stage: CANDIDATE_STAGE.HIRED, deletedAt: null });
      const req = await Requisition.findById(c.requisition);
      if (req && hired >= (req.headcount || 1) && req.status === REQUISITION_STATUS.OPEN) {
        req.status = REQUISITION_STATUS.FILLED;
        req.acceptingApplications = false;
        await req.save();
      }
    }
    return c.populate('owner', 'name avatarColor');
  },

  /**
   * Turn a hired candidate into an employee login account.
   *
   * Name, email and phone come from the application; department and job
   * title from the requisition. The temporary password is returned ONCE
   * in this response and stored only as a hash — there is no way to read
   * it back later, only to reset it from the Employees page.
   */
  async createEmployeeAccount(id, { role, employeeId } = {}, user) {
    if (!canCreateAccounts(user)) throw ApiError.forbidden('Only the MD or EA can create employee accounts');
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    if (c.stage !== CANDIDATE_STAGE.HIRED) throw ApiError.badRequest('Only a hired candidate can be given an account');
    if (c.user) throw ApiError.conflict('This candidate already has an account');
    if (!c.email) {
      throw ApiError.badRequest('Add the candidate’s email first — the account needs it to log in', { code: 'CANDIDATE_EMAIL_REQUIRED' });
    }
    const req = await Requisition.findById(c.requisition).lean();
    const accountRole = ROLE_VALUES.includes(role) ? role : ROLES.EMPLOYEE;
    const tempPassword = `Mr@${crypto.randomBytes(6).toString('base64url')}`;
    const account = await authService.createUser({
      name: c.name,
      email: c.email,
      phone: c.phone || undefined,
      role: accountRole,
      department: req?.department || undefined,
      title: req?.title || undefined,
      employeeId: employeeId?.trim() || undefined,
      password: tempPassword,
    });
    c.user = account._id;
    c.stageHistory.push({ stage: CANDIDATE_STAGE.HIRED, by: user._id, note: `Employee account created (${accountRole})` });
    await c.save();
    return { account, tempPassword };
  },

  async deleteCandidate(id, reason, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    c.deletedAt = new Date();
    c.deleteReason = reason;
    await c.save();
    return { ok: true };
  },

  /* Overview */

  async overview() {
    const [reqByStatus, candByStage, recent, byProject] = await Promise.all([
      Requisition.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Candidate.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
      Candidate.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(8)
        .populate('requisition', 'title code').lean(),
      Requisition.aggregate([
        // Open AND filled — the QC phase asks "how did hiring for this centre
        // go?", and a fully-hired centre disappearing from the answer reads as
        // "never started" rather than "done".
        { $match: { deletedAt: null, status: { $in: [REQUISITION_STATUS.OPEN, REQUISITION_STATUS.FILLED] }, project: { $ne: null } } },
        { $group: { _id: '$project', openRoles: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } }, headcount: { $sum: '$headcount' } } },
        { $lookup: { from: 'projects', localField: '_id', foreignField: '_id', as: 'project' } },
        { $unwind: '$project' },
        { $project: { _id: 0, projectId: '$_id', name: '$project.name', code: '$project.code', city: '$project.city', openRoles: 1, headcount: 1 } },
        { $sort: { openRoles: -1 } },
      ]),
    ]);
    const hiredByProject = await Candidate.aggregate([
      { $match: { deletedAt: null, stage: CANDIDATE_STAGE.HIRED } },
      { $lookup: { from: 'requisitions', localField: 'requisition', foreignField: '_id', as: 'req' } },
      { $unwind: '$req' },
      { $match: { 'req.project': { $ne: null } } },
      { $group: { _id: '$req.project', hired: { $sum: 1 } } },
    ]);
    const hiredMap = new Map(hiredByProject.map((h) => [String(h._id), h.hired]));
    return {
      requisitions: Object.fromEntries(reqByStatus.map((r) => [r._id, r.n])),
      candidates: Object.fromEntries(candByStage.map((c) => [c._id, c.n])),
      pipelineOrder: PIPELINE_ORDER,
      recent,
      byProject: byProject.map((p) => ({ ...p, hired: hiredMap.get(String(p.projectId)) || 0 })),
    };
  },
};

export default hrmsService;
