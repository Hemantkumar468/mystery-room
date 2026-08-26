import mongoose from 'mongoose';
import { Requisition } from './requisitions/requisition.model.js';
import { applyWindow } from './requisitions/applyWindow.js';
import { Candidate } from './candidates/candidate.model.js';
import { Project } from '../pms/projects/project.model.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { logger } from '../../config/logger.js';
import { mailService } from '../../core/services/mail.service.js';
import { toCsv } from '../../core/utils/csv.js';
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
    /* Computed here rather than in the client, so what HR is told about the
       link is produced by the same function the applicant's page obeys. Two
       implementations of "is it live" is how you get a page saying Live above
       a link that is refusing people. */
    return { ...r, candidates, applyWindow: applyWindow(r) };
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

    /* The SAME rule the job page rendered from, re-checked here at the moment
       of submission. Not belt-and-braces: an applicant can sit on an open form
       for an hour and press Send after the closing time, and a check that only
       ran when the page loaded would let that through. 404 rather than 403 —
       a public endpoint must not confirm what it is refusing. */
    const w = applyWindow(req);
    if (!w.open) throw ApiError.notFound('This job is no longer accepting applications');
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

  /* ── The candidate detail page ──────────────────────────────────────── */

  /**
   * One candidate, with everything the detail page shows: the role they
   * applied to, who owns them, and every interview round with its people
   * resolved. Rounds come back oldest-first, because that is the order the
   * story happened in and the page reads top to bottom.
   */
  async getCandidate(id) {
    if (!isId(id)) throw ApiError.notFound('Candidate not found');
    const c = await Candidate.findOne({ _id: id, deletedAt: null })
      .populate('requisition', 'code title department city location project status headcount')
      .populate('owner', 'name avatarColor department')
      .populate('createdBy', 'name avatarColor')
      .populate('user', 'name email employeeId')
      .populate('stageHistory.by', 'name avatarColor')
      .populate('interviews.interviewer', 'name avatarColor department')
      .populate('interviews.decidedBy', 'name avatarColor')
      .lean();
    if (!c) throw ApiError.notFound('Candidate not found');
    c.interviews = (c.interviews || []).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    /* The page offers "send the invite"; it must not offer it as though it
       will work on a deployment with no mail server. */
    c.mailConfigured = mailService.configured;
    return c;
  },

  /* ── Interview rounds ──────────────────────────────────────────────── */

  /**
   * Book a round.
   *
   * The round NUMBER is derived, never supplied: two people scheduling from
   * two tabs would otherwise both send "round 2" and the page would show two
   * round 2s with no way to tell them apart.
   *
   * Scheduling also drags the candidate into the Interview stage when they
   * are still sitting in Applied or Screening. Nobody interviews an
   * "applied" candidate, and leaving the board lying about where they are is
   * how a pipeline stops being worth looking at.
   */
  async scheduleInterview(id, data, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');

    const { sendInvite, ...fields } = data;
    const round = (c.interviews || []).reduce((max, i) => Math.max(max, i.round || 0), 0) + 1;
    c.interviews.push({ ...fields, round, createdBy: user._id });

    const behind = c.stage === CANDIDATE_STAGE.APPLIED || c.stage === CANDIDATE_STAGE.SCREENING;
    if (behind) {
      c.stage = CANDIDATE_STAGE.INTERVIEW;
      c.stageHistory.push({
        stage: CANDIDATE_STAGE.INTERVIEW,
        by: user._id,
        note: `Round ${round} scheduled`,
      });
    }
    await c.save();

    let invite = null;
    if (sendInvite) {
      const added = c.interviews[c.interviews.length - 1];
      invite = await hrmsService.sendInterviewInvite(id, String(added._id), {}, user);
    }
    return { candidate: await hrmsService.getCandidate(id), invite };
  },

  /** Move it, or change who is taking it. Never touches the verdict. */
  async updateInterview(id, interviewId, data, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    const iv = c.interviews.id(interviewId);
    if (!iv) throw ApiError.notFound('Interview not found');

    Object.assign(iv, data);
    /* A round that MOVED has an invite that is now wrong. Clearing the stamp
       is what puts "Send the invite" back on screen — leaving it would let a
       rescheduled interview keep a green "invited" tick against a time the
       candidate was never told. */
    if (data.scheduledAt) iv.inviteSentAt = undefined;
    await c.save();
    return hrmsService.getCandidate(id);
  },

  /**
   * Record how a round went.
   *
   * Deliberately does NOT move the candidate. A "rejected" round is not the
   * same decision as rejecting the person — panels disagree, and rejecting
   * requires a reason (see moveCandidate). The UI offers that as the obvious
   * next click instead of doing it silently here.
   */
  async decideInterview(id, interviewId, { outcome, feedback, rating }, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    const iv = c.interviews.id(interviewId);
    if (!iv) throw ApiError.notFound('Interview not found');

    iv.outcome = outcome;
    if (feedback !== undefined) iv.feedback = feedback;
    if (rating !== undefined) iv.rating = rating;
    iv.decidedBy = user._id;
    iv.decidedAt = new Date();

    /* The candidate's headline rating follows the latest round that gave one,
       so the list page can sort on something that means the current opinion
       rather than the first one anybody recorded. */
    if (rating !== undefined) c.rating = rating;
    await c.save();
    return hrmsService.getCandidate(id);
  },

  /** Cancel a round outright. Rounds are cheap; a wrong one left on the
   *  record costs more than the audit line loses. */
  async cancelInterview(id, interviewId, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null });
    if (!c) throw ApiError.notFound('Candidate not found');
    const iv = c.interviews.id(interviewId);
    if (!iv) throw ApiError.notFound('Interview not found');
    iv.deleteOne();
    await c.save();
    logger.info(`HRMS: interview ${interviewId} cancelled on candidate ${id}`);
    return hrmsService.getCandidate(id);
  },

  /**
   * Email the candidate their interview details.
   *
   * Returns what actually happened rather than throwing when mail is off: a
   * deployment with no SMTP server is a supported state, and an exception
   * here would make "we have no mail server" look identical to "the invite
   * failed". The caller shows the difference.
   */
  async sendInterviewInvite(id, interviewId, { to, message } = {}, user) {
    assertHr(user);
    const c = await Candidate.findOne({ _id: id, deletedAt: null })
      .populate('requisition', 'code title city location')
      .populate('interviews.interviewer', 'name');
    if (!c) throw ApiError.notFound('Candidate not found');
    const iv = c.interviews.id(interviewId);
    if (!iv) throw ApiError.notFound('Interview not found');

    const address = String(to || c.email || '').trim();
    if (!address) {
      return { sent: false, skipped: 'no_email', reason: 'This candidate has no email address on file.' };
    }

    const when = new Date(iv.scheduledAt).toLocaleString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
    });
    const role = c.requisition?.title || 'the role';
    const who = iv.interviewer?.name || iv.interviewerName;
    const kindLabel = {
      phone: 'a phone call', video: 'a video call', in_person: 'an in-person interview', hr: 'an HR discussion',
    }[iv.kind] || 'an interview';

    const result = await mailService.send({
      to: address,
      subject: `Interview for ${role} — ${when} IST`,
      html: [
        `<p>Hi ${String(c.name || '').split(' ')[0] || 'there'},</p>`,
        `<p>Thank you for applying for <strong>${role}</strong> at Mystery Rooms.`,
        ` We would like to invite you to ${kindLabel}.</p>`,
        `<p><strong>When:</strong> ${when} (IST)<br>`,
        `<strong>How long:</strong> about ${iv.durationMins || 30} minutes<br>`,
        iv.location ? `<strong>Where:</strong> ${iv.location}<br>` : '',
        who ? `<strong>Who you will meet:</strong> ${who}` : '',
        '</p>',
        message ? `<p>${message}</p>` : '',
        '<p>If this time does not work for you, just reply to this email and we will find another.</p>',
        '<p>We look forward to speaking with you.<br>Mystery Rooms Hiring Team</p>',
      ].join(''),
    });

    if (result.sent) {
      iv.inviteSentAt = new Date();
      iv.inviteTo = address;
      await c.save();
      logger.info(`HRMS: interview invite sent to ${address} for candidate ${id}`);
    } else {
      logger.warn(`HRMS: interview invite NOT sent (${result.skipped}) for candidate ${id}`);
    }
    return { ...result, to: address };
  },

  /**
   * Every candidate matching the current filters, as a CSV.
   *
   * Reuses the SAME listing filter as the screen, so what downloads is what
   * was on screen — an export that quietly widens the filter is how people
   * end up with a file they did not mean to have.
   *
   * This is personal data: names, phones, salaries. Deliberately HR-gated
   * rather than open to everyone who can read the page.
   */
  async exportCandidates(query, user) {
    assertHr(user);
    /* NOT listCandidates(): that caps at 500 for the screen, and an export
       that silently stops at row 500 is a file someone will trust. Own query,
       own ceiling, and the ceiling is REPORTED when it is hit. */
    const EXPORT_MAX = 10000;
    const where = { deletedAt: null };
    const q = query || {};
    if (q.requisition && isId(q.requisition)) where.requisition = q.requisition;
    if (q.stage) where.stage = q.stage;
    if (q.source) where.source = q.source;
    if (q.search) {
      const rx = new RegExp(escape(q.search), 'i');
      where.$or = [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }];
    }
    const total = await Candidate.countDocuments(where);
    const items = await Candidate.find(where)
      .populate('requisition', 'title code city status')
      .sort({ updatedAt: -1 })
      .limit(EXPORT_MAX)
      .lean();

    const headers = [
      'Candidate', 'Phone', 'Email', 'City', 'Role', 'Requisition', 'Stage',
      'Source', 'Experience (yrs)', 'Current salary', 'Expected salary',
      'Notice (days)', 'Rating', 'Rounds', 'Last round outcome',
      'Rejection reason', 'Applied on', 'Last updated',
    ];
    const rows = items.map((c) => {
      const rounds = c.interviews || [];
      const last = rounds.length ? rounds[rounds.length - 1] : null;
      return [
        c.name, c.phone, c.email, c.city,
        c.requisition?.title, c.requisition?.code,
        c.stage, c.source,
        c.experienceYears, c.currentSalary, c.expectedSalary, c.noticePeriodDays,
        c.rating, rounds.length, last?.outcome,
        c.rejectionReason,
        c.createdAt, c.updatedAt,
      ];
    });
    logger.info(`HRMS: ${user.email || user._id} exported ${rows.length} of ${total} candidate(s)`);
    return {
      csv: toCsv(headers, rows),
      rowCount: rows.length,
      total,
      truncated: total > rows.length,
    };
  },
};

export default hrmsService;
