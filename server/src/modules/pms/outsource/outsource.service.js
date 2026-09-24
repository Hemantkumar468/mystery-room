import { OutsourceLink, mintToken, hashToken } from './outsourceLink.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { Task } from '../tasks/task.model.js';
import { Record } from '../records/record.model.js';
import { Game } from '../games/game.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { config } from '../../../config/index.js';
import { logger } from '../../../config/logger.js';

/**
 * Outsourced phase work: creating the invitations, and serving the brief the
 * outsider sees.
 *
 * The interesting half is `briefForToken`. A designer who is handed a link and
 * a deadline but not the site's area, its city or the games it has to hold
 * cannot start — they will ask, by phone, and somebody will retype facts that
 * are already in this system. So the brief assembles those facts from where
 * they already live: the project for the location, the approved Phase 1
 * property record for the measurements, Phase 3B's game selection joined to
 * the Games master for the floor space each game needs, and the task itself
 * for what to produce and by when.
 *
 * Everything not on that list is deliberately absent. No budget, no rent, no
 * owner or broker, no other phase, no other project, nobody's name. The rule
 * is that this endpoint answers "what do I need to draw this?" and nothing
 * else, because whoever holds the link is outside the company and the link
 * will be forwarded.
 */

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;

/** The public URL a designer opens. Short, because it is read over a phone. */
export function linkUrl(token) {
  return `${config.appUrl}/design/${token}`;
}

/**
 * What state an invitation is in, in one word.
 *
 * Computed here rather than as a Mongoose virtual because every read of these
 * is `.lean()` — a virtual would be silently absent on exactly the queries the
 * list screen uses, which is the sort of bug that ships.
 */
export function stateOf(link) {
  if (!link) return 'unknown';
  if (link.revokedAt) return 'revoked';
  if (new Date(link.expiresAt) <= new Date()) return 'expired';
  if (link.records?.length) return 'delivered';
  if (link.openCount > 0) return 'opened';
  if (link.sends?.length) return 'sent';
  return 'not sent';
}

const withState = (link) => (link ? { ...link, state: stateOf(link) } : link);

/* ── Creating and managing invitations ─────────────────────────────────── */

export async function createLink(data, actorId) {
  const project = await Project.findById(data.projectId).lean();
  if (!project) throw ApiError.notFound('That project no longer exists.');

  const days = Math.min(Math.max(Number(data.expiresInDays) || DEFAULT_DAYS, 1), MAX_DAYS);

  /* Tie the invitation to the TASK, not just the phase, so whatever the
     designer files lands against the job somebody is accountable for. */
  const task = data.taskId
    ? await Task.findOne({ _id: data.taskId, project: project._id }).lean()
    : data.templateTaskKey
      ? await Task.findOne({ project: project._id, templateTaskKey: data.templateTaskKey }).lean()
      : null;

  const { token, tokenHash, tokenHint } = mintToken();
  const link = await OutsourceLink.create({
    project: project._id,
    stageKey: data.stageKey,
    groupKey: data.groupKey || undefined,
    task: task?._id,
    templateTaskKey: task?.templateTaskKey || data.templateTaskKey || undefined,
    contact: {
      name: data.name,
      company: data.company,
      phone: data.phone,
      email: data.email,
    },
    note: data.note,
    tokenHash,
    tokenHint,
    expiresAt: new Date(Date.now() + days * DAY),
    createdBy: actorId,
  });

  // The ONLY time the raw token exists outside the designer's phone.
  return { link: withState(link.toObject()), token, url: linkUrl(token) };
}

export async function listLinks({ projectId, stageKey }) {
  const filter = { project: projectId };
  if (stageKey) filter.stageKey = stageKey;
  const links = await OutsourceLink.find(filter)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name')
    .populate('records', 'title status createdAt')
    .lean();
  return links.map(withState);
}

export async function revokeLink(id, actorId) {
  const link = await OutsourceLink.findById(id);
  if (!link) throw ApiError.notFound('That invitation no longer exists.');
  if (link.revokedAt) return withState(link.toObject());
  link.revokedAt = new Date();
  link.revokedBy = actorId;
  await link.save();
  return withState(link.toObject());
}

/**
 * Issue a NEW token for the same invitation.
 *
 * The old one stops working the moment this returns — that is the point. It is
 * what to press when a link went to the wrong number, or a designer forwarded
 * it to somebody who should not have it.
 */
export async function regenerateLink(id) {
  const link = await OutsourceLink.findById(id);
  if (!link) throw ApiError.notFound('That invitation no longer exists.');
  const { token, tokenHash, tokenHint } = mintToken();
  link.tokenHash = tokenHash;
  link.tokenHint = tokenHint;
  link.revokedAt = undefined;
  link.revokedBy = undefined;
  await link.save();
  return { link: withState(link.toObject()), token, url: linkUrl(token) };
}

/** Record that somebody actually sent it, and how. */
export async function recordSend(id, { channel, to }, actorId) {
  const link = await OutsourceLink.findByIdAndUpdate(
    id,
    { $push: { sends: { channel, to, by: actorId, at: new Date() } } },
    { new: true },
  ).lean();
  if (!link) throw ApiError.notFound('That invitation no longer exists.');
  return withState(link);
}

/* ── The brief the outsider sees ───────────────────────────────────────── */

/**
 * Resolve a token to its invitation, or say precisely why not.
 *
 * The three closed states are told apart on purpose: "we cancelled this",
 * "this ran out on the 3rd" and "this link was never real" are different
 * situations for the person holding it, and collapsing them into one message
 * produces a phone call every time.
 */
export async function findByToken(token) {
  if (!token || String(token).length < 20) return { link: null, reason: 'unknown' };
  const link = await OutsourceLink.findOne({ tokenHash: hashToken(token) });
  if (!link) return { link: null, reason: 'unknown' };
  if (link.revokedAt) return { link, reason: 'revoked' };
  if (link.expiresAt <= new Date()) return { link, reason: 'expired' };
  return { link, reason: null };
}

/**
 * "444 – 450 sq ft", or one figure when both ends agree.
 *
 * Mirrors Game's own virtual because this read is lean and a lean read drops
 * virtuals — relying on it would have shown every game with a blank area,
 * which is the single fact the designer most needs.
 */
function areaLabel(g) {
  const min = g?.minAreaSqft;
  const max = g?.maxAreaSqft;
  if (min == null && max == null) return '';
  if (min == null || max == null || min === max) return `${(max ?? min).toLocaleString('en-IN')} sq ft`;
  return `${min.toLocaleString('en-IN')} – ${max.toLocaleString('en-IN')} sq ft`;
}

/** The games this outlet is opening with, and the floor space each needs. */
async function gamesFor(projectId) {
  const plan = await Record.findOne({
    project: projectId,
    stageKey: 'p20',
    'values.selected_games': { $exists: true, $ne: [] },
  }).sort({ updatedAt: -1 }).lean();

  const chosen = plan?.values?.selected_games;
  const names = Array.isArray(chosen) ? chosen : (chosen ? [chosen] : []);
  if (!names.length) return [];

  const games = await Game.find({ name: { $in: names } }).lean();
  const byName = new Map(games.map((g) => [g.name, g]));

  /* A name with no match in the master is still shown. The designer needs the
     list of games more than the system needs its own referential integrity,
     and a silently shortened list is the worst of both. */
  return names.map((name) => {
    const g = byName.get(name);
    return {
      name,
      minAreaSqft: g?.minAreaSqft ?? null,
      maxAreaSqft: g?.maxAreaSqft ?? null,
      areaLabel: areaLabel(g),
      layouts: (g?.layouts || []).map((l) => ({ label: l.label, areaSqft: l.areaSqft })),
    };
  });
}

/** The site facts a designer measures against — and nothing commercial. */
async function siteFor(project) {
  /* SHORTLISTED, not approved. Phase 1 has no approved status — a property is
     shortlisted, and the winner is marked by a second shortlist after Site
     Evaluation (see isPropertyApprovedAtP2). Asking for 'approved' here matched
     nothing on a correctly-run project, so the brief quietly fell back to the
     project header's estimated area instead of the surveyed one. The franchise
     flow does file its single property as approved, so both are accepted. */
  const site = await Record.findOne({
    project: project._id,
    stageKey: 'p1',
    status: { $in: ['shortlisted', 'approved'] },
  }).sort({ decidedAt: -1, updatedAt: -1 }).lean();

  const v = site?.values || {};
  return {
    propertyName: v.property_name || null,
    locality: v.locality || null,
    // The approved property's own measurement beats the project header, which
    // is an early estimate typed before anyone stood in the unit.
    areaSqft: v.carpet_area ?? project.areaSqft ?? null,
    frontageFt: v.frontage_ft ?? null,
    floor: v.floor || null,
    mapLocation: typeof v.live_location === 'string' ? v.live_location : (v.live_location?.url || null),
  };
}

export async function briefForToken(token) {
  const { link, reason } = await findByToken(token);
  if (!link) return { closed: true, reason: 'unknown' };
  if (reason) return { closed: true, reason, expiresAt: link.expiresAt };

  const project = await Project.findById(link.project).lean();
  if (!project) return { closed: true, reason: 'unknown' };

  const templateId = project.template?.ref;
  const template = templateId ? await Template.findById(templateId).lean() : null;
  const stage = template?.stages?.find((s) => s.key === link.stageKey) || null;
  const group = stage?.recordGroups?.find((g) => g.key === link.groupKey) || null;
  const task = link.task ? await Task.findById(link.task).lean() : null;

  const [games, site, filed] = await Promise.all([
    gamesFor(project._id),
    siteFor(project),
    Record.find({ _id: { $in: link.records || [] } })
      .select('title status values createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  /* Counted here rather than in the route, so every path that serves a brief
     counts it — a refresh is genuinely another look. Not awaited: the designer
     is waiting for this page, and a failed counter must never cost them it. */
  OutsourceLink.updateOne(
    { _id: link._id },
    {
      $inc: { openCount: 1 },
      $set: { lastOpenedAt: new Date(), ...(link.firstOpenedAt ? {} : { firstOpenedAt: new Date() }) },
    },
  ).catch((err) => logger.warn(`Could not count an outsource link open: ${err.message}`));

  /* The form the designer fills. Only the fields the phase actually asks for,
     minus the one the list already answers — they were invited to a specific
     list, so asking which list this is would be asking them to classify work
     they were told the classification of. */
  const seeded = group?.values?.length === 1 ? { [group.field]: group.values[0] } : null;
  const schema = (stage?.masterDataSchema || [])
    .filter((f) => !(seeded && f.key === group.field))
    // Questions that are ours to answer, not theirs — see internalOnly.
    .filter((f) => !f.internalOnly);

  return {
    closed: false,
    expiresAt: link.expiresAt,
    invitedAs: link.contact?.name || null,
    note: link.note || null,

    project: {
      name: project.name,
      code: project.code,
      city: project.city || null,
      address: project.address || null,
      targetOpening: project.targetEndDate || null,
    },
    site,
    games,

    work: {
      phase: stage?.name || link.stageKey,
      list: group?.label || stage?.recordNoun || 'Entry',
      what: group?.hint || stage?.description || null,
      how: task?.brief?.how || null,
      checklist: (task?.checklist || []).map((c) => ({ label: c.label, required: Boolean(c.required) })),
      dueAt: task?.plannedEnd || task?.dueAt || null,
    },

    form: { schema, seeded },
    filed: filed.map((r) => ({
      title: r.title || 'Submission',
      status: r.status,
      at: r.createdAt,
    })),
  };
}

/**
 * File the designer's work as a real record on the phase.
 *
 * It arrives as a DRAFT-equivalent submission — `submitted`, never approved.
 * An outsider's upload entering the system pre-approved would mean an external
 * link could close a phase, which is exactly the authority a public URL must
 * not carry. Somebody inside still reviews it, in the same review screen they
 * use for an employee's submission.
 */
export async function submitThroughLink(token, { values }) {
  const { link, reason } = await findByToken(token);
  if (!link || reason) throw ApiError.forbidden('This link is no longer active.', { code: 'LINK_CLOSED' });

  const project = await Project.findById(link.project).lean();
  if (!project) throw ApiError.notFound('That project no longer exists.');

  const template = project.template?.ref ? await Template.findById(project.template.ref).lean() : null;
  const stage = template?.stages?.find((s) => s.key === link.stageKey) || null;
  const group = stage?.recordGroups?.find((g) => g.key === link.groupKey) || null;

  /* The list decides its own field, not the submitter. A public form that
     accepts the value that decides which list it lands in is a public form
     that can file into a list it was never invited to. */
  const forced = group?.values?.length === 1 ? { [group.field]: group.values[0] } : {};

  const record = await Record.create({
    project: link.project,
    stageKey: link.stageKey,
    task: link.task,
    values: { ...(values || {}), ...forced },
    status: 'submitted',
    submittedAt: new Date(),
    // No `createdBy`: there is no user. Who sent it is on the link, and the
    // title carries it so the reviewer sees a name and not an anonymous row.
    title: `${link.contact?.name || 'Outside designer'}${link.contact?.company ? ` · ${link.contact.company}` : ''}`,
  });

  await OutsourceLink.updateOne({ _id: link._id }, { $push: { records: record._id } });

  logger.info(
    `Outsourced work filed on ${project.code} ${link.stageKey}`,
    { record: String(record._id), link: String(link._id), by: link.contact?.name },
  );
  return { ok: true };
}

export default {
  createLink, listLinks, revokeLink, regenerateLink, recordSend,
  briefForToken, submitThroughLink, linkUrl, stateOf,
};
