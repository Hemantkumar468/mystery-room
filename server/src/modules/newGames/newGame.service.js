import mongoose from 'mongoose';
import { NewGame } from './newGame.model.js';
import { Game } from '../pms/games/game.model.js';
import { Project } from '../pms/projects/project.model.js';
import { Template } from '../pms/templates/template.model.js';
import { Task } from '../pms/tasks/task.model.js';
import { Record } from '../pms/records/record.model.js';
import { User } from '../auth/auth.model.js';
import { fmsService } from '../fms/fms.service.js';
import { accessService } from '../access/access.service.js';
import { ACCESS } from '../../core/constants/access.js';
import { PROJECT_STATUS, PRIORITY_VALUES } from '../../core/constants/index.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { logger } from '../../config/logger.js';
import { notificationService } from '../pms/notifications/notification.service.js';

/**
 * THE FLOW — what, when, who and how for every step, left to right.
 *
 * Seven steps. The design's hardware/software and its separate quality step
 * were folded in by request: building is Assemble, and testing and the
 * quality check are one step.
 *
 * STEP 5 IS THE PURCHASE FMS. When every BOQ is approved, the game gets a host
 * project (kind 'new_game') and each approved BOQ item becomes a line on it,
 * already approved — so it lands on Purchase Orders at Vendor finalisation and
 * runs Raise PO → Tracking → GRN there, with that flow's own tasks. This step
 * reads those lines back and is done when every GRN is booked.
 *
 * `tat` is working days after the step before it finished (Sundays off, the
 * design's rule). Step 2's plan is the watch-by date on the indent; Step 5
 * takes the longest lead time of the approved BOQs.
 */
export const NG_STEPS = Object.freeze([
  {
    key: 'indent', n: 1, label: 'Indent form', tat: 0,
    what: 'Fill the indent form', when: 'Whenever a new game is wanted', who: 'Managing Director',
    how: 'The game’s name, what it is, the reference video and the watch-by date',
  },
  {
    key: 'video', n: 2, label: 'Watch the video', tat: 2, fmsItem: 'ng:ng_video',
    what: 'Watch the reference video', when: 'By the watch-by date on the indent', who: 'Everyone assigned',
    how: 'Each person watches it from My Tasks and marks it completed',
  },
  {
    key: 'boq', n: 3, label: 'Make the BOQ', tat: 2, fmsItem: 'ng:ng_boq',
    what: 'Make the BOQs', when: 'Within 2 days', who: 'BOQ maker',
    how: 'One BOQ per category — its items, quantity, rate and lead time',
  },
  {
    key: 'check', n: 4, label: 'Check the BOQ', tat: 1, fmsItem: 'ng:ng_check',
    what: 'Check and approve every BOQ', when: 'Within 1 day', who: 'BOQ checker',
    how: 'Approve it, or reject it with a reason',
  },
  {
    key: 'order', n: 5, label: 'Order & receive', tat: 7,
    what: 'Order and receive — in the Purchase FMS', when: 'The longest BOQ lead time', who: 'Purchase team',
    how: 'Vendor, PO, tracking and GRN run in Purchase Orders; this closes when every GRN is booked',
  },
  {
    key: 'assemble', n: 6, label: 'Assemble', tat: 7, fmsItem: 'ng:ng_assemble',
    what: 'Assemble the game', when: 'Within 7 days of the goods arriving', who: 'Technical team',
    how: 'Put the room together, then mark it complete',
  },
  {
    key: 'testing', n: 7, label: 'Testing & quality test', tat: 5, fmsItem: 'ng:ng_testing',
    what: 'Test the game and check its quality', when: 'Within 5 days', who: 'Game tester',
    how: 'Play it end to end and check every machine — it then joins the Games master',
  },
]);

const STEP = new Map(NG_STEPS.map((s) => [s.key, s]));
/** The steps a person finishes with one "Complete Task". */
export const DONE_STEPS = Object.freeze(['boq', 'check', 'assemble', 'testing']);
/** Step 5's people are the Purchase FMS's own, so it is not assigned here. */
export const ASSIGNABLE_STEPS = Object.freeze(NG_STEPS.filter((s) => s.fmsItem).map((s) => s.key));

/* The Purchase FMS steps a new game's lines walk, with the task that owns each. */
const PURCHASE_TASKS = [
  { key: 'p15_vendor', step: 'vendor', formKey: 'po-vendor', days: 2 },
  { key: 'p15_t1', step: 'raise', formKey: 'po-raise', days: 1 },
  { key: 'p15_track', step: 'tracking', formKey: 'po-tracking', days: null }, // the lead time
  { key: 'p15_t3', step: 'grn', formKey: 'po-grn', days: 1 },
];

const ids = (list) => (list || []).map((x) => String(x?._id ?? x));
const filled = (v) => v != null && String(v).trim() !== '';
const maxDate = (dates) => {
  const t = dates.filter(Boolean).map((d) => new Date(d).getTime()).filter((n) => !Number.isNaN(n));
  return t.length ? new Date(Math.max(...t)) : null;
};

/** Working days after `from`, Sundays off — the design's own rule. */
export function addWorkDays(from, n) {
  const d = new Date(from);
  let left = Math.max(0, Math.round(n || 0));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) left -= 1;
  }
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}

/* ── who does each step ─────────────────────────────────────────────────── */

/**
 * The game's own choice if it made one, otherwise FMS · Assign Work — read
 * live, so naming somebody there reaches games that are already running.
 */
function doersOf(game, key, fmsMap) {
  if (key === 'indent') return game.createdBy ? [String(game.createdBy)] : [];
  if (key === 'video') {
    if (game.watchers?.length) return ids(game.watchers);
    return fmsMap.get(STEP.get('video').fmsItem)?.doers ?? [];
  }
  if (key === 'order') return [];
  const own = game.steps?.[key]?.doers;
  if (own?.length) return ids(own);
  return fmsMap.get(STEP.get(key).fmsItem)?.doers ?? [];
}

/* ── Step 5: where each purchase line has got to ───────────────────────── */

function lineFacts(r) {
  const v = r.values || {};
  const qty = Number(v.quantity) || 0;
  const received = v.received_quantity != null && v.received_quantity !== '' ? Number(v.received_quantity) : null;
  const grnDone = filled(v.grn_number) || received != null;
  const cancelled = v.order_status === 'Cancelled';
  let stage = 'vendor';
  let label = 'Waiting for vendor';
  if (cancelled) { stage = 'tracking'; label = 'Cancelled'; }
  else if (grnDone && qty > 0 && received != null && received < qty) { stage = 'short'; label = `Short — ${received} of ${qty}`; }
  else if (grnDone) { stage = 'grn'; label = 'GRN done'; }
  else if (v.order_status === 'Delivered') { stage = 'grn'; label = 'Delivered — GRN pending'; }
  else if (filled(v.po_number)) { stage = 'tracking'; label = v.order_status || 'PO raised'; }
  else if (filled(v.vendor)) { stage = 'raise'; label = 'Vendor selected — raise the PO'; }
  return {
    id: String(r._id), seq: r.seq, item: v.item || r.title || 'Item', boq: v.boq_type || '', unit: v.unit || '',
    qty, rate: v.rate ?? null, vendor: v.vendor || '', po: v.po_number || '', orderStatus: v.order_status || '',
    promised: v.promised_delivery || null, received, receivedAt: v.received_date || null,
    grn: v.grn_number || '', grnDone, cancelled, stage, label, updatedAt: r.updatedAt,
  };
}

/* ── the derived view ───────────────────────────────────────────────────── */

/**
 * One game, with every step's plan, actual, people and state worked out.
 *
 * state: 'done' | 'ready' (open, on time) | 'late' (open, past its plan) |
 * 'waiting' (the step before is not finished yet).
 */
function shape(game, { fmsMap, people, purchase, now = new Date() }) {
  const g = game;
  const who = (id) => (id ? people.get(String(id)) ?? { id: String(id), name: 'Former user' } : null);
  const stateOf = (open, doneAt, plan) => {
    if (doneAt) return 'done';
    if (!open) return 'waiting';
    return now > plan ? 'late' : 'ready';
  };
  const lateBy = (doneAt, plan) => {
    const end = doneAt ? new Date(doneAt) : now;
    const days = Math.floor((end - new Date(plan)) / 86_400_000);
    return days > 0 ? days : 0;
  };

  const steps = {};

  steps.indent = {
    key: 'indent', plan: g.indentDate, doneAt: g.createdAt, doneBy: who(g.createdBy),
    doers: g.createdBy ? [who(g.createdBy)] : [], state: 'done', lateDays: 0,
  };

  /* Step 2 — one row per person, planned for the watch-by date on the indent. */
  const watcherIds = doersOf(g, 'video', fmsMap);
  const videoPlan = g.watchBy || addWorkDays(g.indentDate, STEP.get('video').tat);
  const watchedBy = new Map((g.watched || []).map((w) => [String(w.user), w.at]));
  const rowIds = [...new Set([...watcherIds, ...watchedBy.keys()])];
  const videoRows = rowIds.map((id) => {
    const at = watchedBy.get(id) || null;
    return {
      person: who(id), assignedAt: g.steps?.video?.assignedAt || g.createdAt, plan: videoPlan,
      doneAt: at, state: stateOf(true, at, videoPlan), lateDays: lateBy(at, videoPlan),
      stillAssigned: watcherIds.includes(id),
    };
  });
  const mustWatch = videoRows.filter((r) => r.stillAssigned);
  const videoDoneAt = mustWatch.length && mustWatch.every((r) => r.doneAt) ? maxDate(mustWatch.map((r) => r.doneAt)) : null;
  steps.video = {
    key: 'video', plan: videoPlan, doneAt: videoDoneAt, doneBy: null, rows: videoRows,
    doers: watcherIds.map(who), unassigned: watcherIds.length === 0,
    state: stateOf(true, videoDoneAt, videoPlan), lateDays: lateBy(videoDoneAt, videoPlan),
    watchedCount: mustWatch.filter((r) => r.doneAt).length, watcherCount: mustWatch.length,
  };

  const boqs = (g.boqs || []).map((b) => ({
    id: String(b._id), seq: b.seq, name: b.name, category: b.category || '', leadTimeDays: b.leadTimeDays ?? null,
    deadline: b.deadline || null, estimatedCost: b.estimatedCost ?? null, items: b.items || '', notes: b.notes || '',
    files: b.files || [], status: b.status, reason: b.reason || '',
    createdBy: who(b.createdBy), createdAt: b.createdAt, decidedBy: who(b.decidedBy), decidedAt: b.decidedAt || null,
  })).sort((a, b) => a.seq - b.seq);

  const host = g.purchaseProject ? purchase?.get(String(g.purchaseProject)) : null;
  const lines = (host?.lines || []).map(lineFacts).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  let prev = steps.video;
  for (const def of NG_STEPS.slice(2)) {
    const own = g.steps?.[def.key] || {};
    const open = Boolean(prev.doneAt);
    let tat = def.tat;
    if (def.key === 'order') {
      const longest = Math.max(0, ...boqs.filter((b) => b.status === 'approved').map((b) => b.leadTimeDays || 0));
      if (longest) tat = longest;
    }
    const plan = addWorkDays(prev.doneAt || prev.plan, tat);

    let doneAt = own.doneAt || null;
    let doneBy = who(own.doneBy);
    let doerList = doersOf(g, def.key, fmsMap).map(who);

    /* Step 4 is completed by its checker, by hand, once every BOQ is
       approved — the same Complete Task every other step has. It used to close
       itself on the last approval, which left the checker nothing to press and
       a task that vanished mid-review. `completeStep` refuses it while any BOQ
       is still waiting or rejected. */

    /* Step 5 is the Purchase FMS: done when every line that is still wanted
       has its GRN booked. Its people are that flow's task owners. */
    if (def.key === 'order') {
      const live = lines.filter((l) => !l.cancelled);
      doneAt = open && live.length && live.every((l) => l.grnDone)
        ? maxDate(live.map((l) => l.receivedAt || l.updatedAt))
        : null;
      doneBy = null;
      const owners = new Set();
      for (const t of host?.tasks || []) ids([t.assignee, ...(t.assigneeRefs || [])]).forEach((id) => { if (id && id !== 'null' && id !== 'undefined') owners.add(id); });
      doerList = [...owners].map(who);
    }

    steps[def.key] = {
      key: def.key, plan, doneAt, doneBy, note: own.note || '',
      doers: doerList, unassigned: doerList.length === 0, ownChoice: Boolean(own.doers?.length),
      assignedAt: own.assignedAt || null,
      state: stateOf(open, doneAt, plan), lateDays: open ? lateBy(doneAt, plan) : 0,
    };
    prev = steps[def.key];
  }
  steps.order.purchaseProject = g.purchaseProject ? String(g.purchaseProject) : null;
  steps.order.lines = lines;
  steps.order.counts = {
    total: lines.length,
    vendor: lines.filter((l) => l.vendor).length,
    po: lines.filter((l) => l.po).length,
    received: lines.filter((l) => l.grnDone).length,
  };

  const current = NG_STEPS.find((s) => steps[s.key].state !== 'done') || null;
  return {
    id: String(g._id),
    code: g.code,
    name: g.name,
    concept: g.concept || '',
    playersMin: g.playersMin ?? null,
    playersMax: g.playersMax ?? null,
    durationMinutes: g.durationMinutes ?? null,
    location: g.location || '',
    priority: g.priority || 'high',
    indentDate: g.indentDate,
    watchBy: g.watchBy || null,
    videoLinks: g.videoLinks || [],
    videoFiles: g.videoFiles || [],
    status: g.status,
    completedAt: g.completedAt || null,
    masterGame: g.masterGame ? String(g.masterGame) : null,
    createdBy: who(g.createdBy),
    createdAt: g.createdAt,
    boqs,
    steps,
    currentStep: current?.key ?? null,
    goLive: steps.testing.doneAt || steps.testing.plan,
    doneCount: NG_STEPS.filter((s) => steps[s.key].state === 'done').length,
  };
}

/** Each host project's purchase lines and Purchase-FMS tasks, read once. */
async function purchaseFor(games) {
  const hosts = [...new Set(games.map((g) => g.purchaseProject && String(g.purchaseProject)).filter(Boolean))];
  const map = new Map();
  if (!hosts.length) return map;
  const [lines, tasks] = await Promise.all([
    Record.find({ project: { $in: hosts }, stageKey: 'p13', status: { $ne: 'archived' } })
      .select('project seq title values status updatedAt').lean(),
    Task.find({ project: { $in: hosts }, stageKey: 'p15' })
      .select('project templateTaskKey assignee assigneeRefs status').lean(),
  ]);
  for (const h of hosts) map.set(h, { lines: [], tasks: [] });
  for (const l of lines) map.get(String(l.project))?.lines.push(l);
  for (const t of tasks) map.get(String(t.project))?.tasks.push(t);
  return map;
}

/** Everyone a set of games mentions, looked up once. */
async function peopleFor(games, fmsMap, purchase) {
  const wanted = new Set();
  const add = (x) => { if (x) wanted.add(String(x?._id ?? x)); };
  for (const g of games) {
    add(g.createdBy);
    ids(g.watchers).forEach(add);
    (g.watched || []).forEach((w) => add(w.user));
    (g.boqs || []).forEach((b) => { add(b.createdBy); add(b.decidedBy); });
    Object.values(g.steps || {}).forEach((s) => { ids(s?.doers).forEach(add); add(s?.doneBy); });
  }
  for (const v of fmsMap.values()) ids(v.doers).forEach(add);
  for (const p of purchase.values()) for (const t of p.tasks) { add(t.assignee); ids(t.assigneeRefs).forEach(add); }
  const valid = [...wanted].filter((id) => mongoose.isValidObjectId(id));
  const users = valid.length
    ? await User.find({ _id: { $in: valid } }).select('name title avatarColor').lean()
    : [];
  return new Map(users.map((u) => [String(u._id), {
    id: String(u._id), name: u.name, title: u.title || '', avatarColor: u.avatarColor,
  }]));
}

/**
 * WHO DOES EACH STEP, by name — what FMS · Assign Work says for every game
 * that has not named its own. The step strip's "Who" reads this, so it says
 * "Om Prakash" rather than "BOQ checker". Step 5 is the Purchase FMS's own
 * people.
 */
function stepPeopleOf(ctx) {
  const who = (id) => ctx.people.get(String(id)) || null;
  const named = (list) => [...new Set(ids(list))].map(who).filter(Boolean);
  const out = {};
  for (const s of NG_STEPS) {
    if (s.fmsItem) out[s.key] = named(ctx.fmsMap.get(s.fmsItem)?.doers);
  }
  out.order = named(['p15:p15_vendor', 'p15:p15_t1', 'p15:p15_track', 'p15:p15_t3']
    .flatMap((k) => ctx.fmsMap.get(k)?.doers || []));
  return out;
}

/** The people on one step of one shaped game — the video step's are its rows. */
function stepDoerIds(g, key) {
  if (key === 'indent') return g.createdBy?.id ? [g.createdBy.id] : [];
  if (key === 'video') return g.steps.video.rows.filter((r) => r.stillAssigned).map((r) => r.person?.id).filter(Boolean);
  return (g.steps[key]?.doers || []).map((p) => p?.id).filter(Boolean);
}

/** The state a game shows on a step's table; Step 1's is where the game stands now. */
function stateOn(g, key) {
  if (key === 'indent') return g.currentStep ? g.steps[g.currentStep].state : 'done';
  return g.steps[key]?.state || 'waiting';
}

/**
 * THE BELL. My Tasks already carries the work; this says it has arrived, so a
 * doer does not have to go looking. Best effort: the step moves on whether or
 * not the notification could be written.
 */
async function notifyPeople(recipients, actorId, { title, message, link }) {
  const to = [...new Set(ids(recipients))].filter((pid) => pid && pid !== String(actorId || ''));
  if (!to.length) return;
  await notificationService.notify({ recipients: to, type: 'task_assigned', title, message, link }).catch(() => {});
}

function notifyStep(gameView, key, people, actorId, extra) {
  const def = STEP.get(key);
  return notifyPeople((people || []).map((p) => p?.id ?? p), actorId, {
    title: `New task · Step ${def.n} · ${def.label}`,
    message: `${def.what} — ${gameView.name} (${gameView.code})${extra ? `. ${extra}` : ''}`,
    link: `/new-games/tasks/${gameView.id}/${key}`,
  });
}

async function context(games) {
  const fmsMap = await fmsService.resolve();
  const purchase = await purchaseFor(games);
  const people = await peopleFor(games, fmsMap, purchase);
  return { fmsMap, people, purchase, now: new Date() };
}

/* ── guards ─────────────────────────────────────────────────────────────── */

const canManage = (user) => accessService.allows(user, 'module:new-games', ACCESS.MANAGE);

/**
 * The steps this person may open, in flow order.
 *
 * The rail is drawn from whatever comes back here, so a seat that has been
 * denied "Step 4 · Check the BOQ" on the Access Control screen does not get a
 * tab it would be refused at — and does not get the BOQ queue behind it
 * either, which is the part a client-side filter alone would still have sent.
 *
 * Never empty in practice: reaching this code at all means the module itself
 * is granted, and a module open with every step shut is a policy nobody has
 * written. If somebody does write it, the page says so rather than rendering
 * a rail of nothing.
 */
export async function visibleSteps(user) {
  const allowed = await Promise.all(
    NG_STEPS.map((s) => accessService.allows(user, `step:ng-${s.key}`, ACCESS.VIEW)),
  );
  return NG_STEPS.filter((_s, i) => allowed[i]);
}

/**
 * THE STEPS OF ONE GAME THIS PERSON HOLDS — assigned to, or asked to watch.
 *
 * Holding the task is the permission, as it is for a project doer (see the
 * DOER_FLOOR note in access.catalog.js): a seatless Employee's access is
 * "their own queue and nothing else", and a step of a new game that a
 * manager put them on IS their own queue. Without this the task reached
 * My Tasks and its link bounced straight back there. Step 5 is worked in
 * Purchase, so it is never held here.
 */
export async function myStepsOn(id, user) {
  if (!mongoose.isValidObjectId(String(id || ''))) return [];
  const game = await NewGame.findById(id).lean();
  if (!game) return [];
  const fmsMap = await fmsService.resolve();
  const me = String(user?._id ?? user?.id ?? '');
  return NG_STEPS
    .filter((s) => s.key !== 'order' && doersOf(game, s.key, fmsMap).includes(me))
    .map((s) => s.key);
}

/** The rail: the steps this person's access opens, plus the ones they hold on the game in view. */
async function railFor(user, gameId) {
  const open = await visibleSteps(user);
  const held = gameId ? await myStepsOn(gameId, user) : [];
  if (!held.length) return open;
  return NG_STEPS.filter((s) => open.includes(s) || held.includes(s.key));
}

async function mustBeDoer(user, game, key, fmsMap) {
  if (doersOf(game, key, fmsMap).includes(String(user._id ?? user.id))) return;
  if (await canManage(user)) return;
  throw ApiError.forbidden(`Only the people assigned to “${STEP.get(key).label}” can do this — or a manager.`);
}

async function load(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Game not found');
  const game = await NewGame.findById(id);
  if (!game) throw ApiError.notFound('Game not found');
  return game;
}

async function validPeople(list) {
  const want = [...new Set(ids(list))];
  if (!want.length) return [];
  const found = await User.find({ _id: { $in: want } }).select('_id').lean();
  if (found.length !== want.length) throw ApiError.badRequest('One of those people no longer has an account.');
  return want;
}

/** Game view for one id — what every action returns. */
async function view(game) {
  const plain = game.toObject ? game.toObject() : game;
  return shape(plain, await context([plain]));
}

/* ── Step 5 · hand the approved BOQs to the Purchase FMS ────────────────── */

/* The BOQ items box is "item, quantity, unit, rate" per line. */
const UNIT_ALIAS = {
  no: 'nos', nos: 'nos', pc: 'nos', pcs: 'nos', piece: 'nos', pieces: 'nos', unit: 'nos', units: 'nos',
  set: 'set', sets: 'set', lot: 'lot', lots: 'lot', kg: 'kg', kgs: 'kg', l: 'litre', ltr: 'litre', litre: 'litre', liter: 'litre',
  sqft: 'sq ft', 'sq.ft': 'sq ft', 'sq ft': 'sq ft', rft: 'running ft', 'running ft': 'running ft', day: 'day', days: 'day',
};
export function parseItems(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, qty, unit, rate] = line.split(',').map((x) => x.trim());
    const q = Number(qty);
    const r = Number(String(rate || '').replace(/[₹,\s]/g, ''));
    const u = String(unit || '').toLowerCase();
    return {
      item: name || line,
      quantity: Number.isFinite(q) && q > 0 ? q : 1,
      unit: UNIT_ALIAS[u] || (u || 'nos'),
      rate: Number.isFinite(r) && r > 0 ? r : undefined,
    };
  });
}

/** The template every centre runs — for the BOQ form and the purchase stages. */
async function purchaseTemplate() {
  const recent = await Project.findOne({ 'template.ref': { $ne: null }, kind: { $ne: 'new_game' } })
    .sort({ createdAt: -1 }).select('template').lean();
  const tpl = recent?.template?.ref ? await Template.findById(recent.template.ref).lean() : null;
  if (tpl?.stages?.some((s) => s.key === 'p13') && tpl.stages.some((s) => s.key === 'p15')) return tpl;
  return Template.findOne({ 'stages.key': { $all: ['p13', 'p15'] } }).sort({ updatedAt: -1 }).lean();
}

/**
 * Open the game's purchasing: a host project, one approved Purchase line per
 * BOQ item, and the Purchase FMS's own four tasks. Runs once — the game is
 * claimed atomically first, so two approvals landing together cannot open it
 * twice. Best effort: a failure releases the claim and is logged, and the
 * next approval (or a manager's "Send to Purchase") tries again.
 */
async function openPurchase(gameId, user) {
  const claimed = await NewGame.findOneAndUpdate(
    { _id: gameId, purchaseProject: null, purchaseOpening: { $ne: true } },
    { $set: { purchaseOpening: true } },
    { new: true },
  );
  if (!claimed) return false;

  try {
    const plain = claimed.toObject();
    const current = shape(plain, await context([plain]));
    if (current.steps.check.state !== 'done') return false;
    const approved = current.boqs.filter((b) => b.status === 'approved');
    if (!approved.length) return false;

    const tpl = await purchaseTemplate();
    if (!tpl) throw new Error('No project template with the BOQ (p13) and purchase (p15) phases');
    const pick = (key) => {
      const { tasks, masterDataSchema, assessmentTypes, _id, ...rest } = tpl.stages.find((s) => s.key === key);
      return rest;
    };
    const p15 = tpl.stages.find((s) => s.key === 'p15');

    /* The host project. Its code is the game's own (NG-001), so the Purchase
       FMS's centre dropdown names the game; a clash takes the next suffix. */
    let project = null;
    for (let i = 0; i < 5 && !project; i += 1) {
      const code = i === 0 ? claimed.code : `${claimed.code}-${i + 1}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        project = await Project.create({
          name: `${claimed.name} · new game`,
          code,
          description: `Purchasing for the new game “${claimed.name}” (${claimed.code}), opened by the New Games Creation FMS when its BOQs were approved.`,
          kind: 'new_game',
          status: PROJECT_STATUS.ACTIVE,
          city: claimed.location || 'Central',
          template: { ref: tpl._id, name: tpl.name, version: tpl.version },
          stages: [pick('p13'), pick('p15')],
          priority: PRIORITY_VALUES.includes(claimed.priority) ? claimed.priority : undefined,
          owner: claimed.createdBy,
          createdBy: claimed.createdBy,
          plannedStartDate: new Date(),
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
    if (!project) throw new Error(`No free project code for ${claimed.code}`);

    /* One line per BOQ item, approved — the check already happened here. */
    const { recordService } = await import('../pms/records/record.service.js');
    for (const boq of approved) {
      const items = parseItems(boq.items);
      const rows = items.length ? items : [{ item: boq.name, quantity: 1, unit: 'lot', rate: undefined }];
      for (const it of rows) {
        // eslint-disable-next-line no-await-in-loop
        await recordService.create({
          projectId: String(project._id),
          stageKey: 'p13',
          status: 'approved',
          values: {
            boq_type: boq.name,
            item: it.item,
            category: boq.category || 'Other',
            quantity: it.quantity,
            unit: it.unit,
            ...(it.rate ? { rate: it.rate, amount: Math.round(it.rate * it.quantity) } : {}),
            source_of_supply: 'Outside procurement',
            remarks: `From the New Games Creation FMS — ${claimed.code} ${claimed.name}, BOQ “${boq.name}”.`,
          },
        }, user._id);
      }
    }

    /* The Purchase FMS's four tasks, owned as they are on every centre:
       FMS · Assign Work if it names someone, else whoever did the job last. */
    const longest = Math.max(0, ...approved.map((b) => b.leadTimeDays || 0)) || 7;
    let start = new Date();
    for (const [i, t] of PURCHASE_TASKS.entries()) {
      const def = p15?.tasks?.find((x) => x.key === t.key) || {};
      let doers = (await fmsService.forTask('p15', t.key))?.doers ?? [];
      if (!doers.length) {
        // eslint-disable-next-line no-await-in-loop
        const last = await Task.findOne({ templateTaskKey: t.key, assignee: { $ne: null }, project: { $ne: project._id } })
          .sort({ createdAt: -1 }).select('assignee').lean();
        if (last?.assignee) doers = [String(last.assignee)];
      }
      const end = addWorkDays(start, t.days ?? longest);
      const code = `${project.code}-T${String(i + 1).padStart(3, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      await Task.create({
        project: project._id,
        code,
        templateTaskKey: t.key,
        stageKey: 'p15',
        stageName: p15?.name,
        title: def.title || def.name || t.step,
        department: def.department,
        priority: 'high',
        status: 'pending',
        approvalState: 'none',
        approval: false,
        formKey: t.formKey,
        appPath: `/purchase/orders?project=${project._id}&stage=${t.step}&task=${code}`,
        plannedStart: start,
        plannedEnd: end,
        assignee: doers[0] || null,
        assigneeRefs: doers,
        createdBy: claimed.createdBy,
      });
      start = end;
    }

    await NewGame.updateOne(
      { _id: claimed._id },
      { $set: { purchaseProject: project._id, 'steps.order.assignedAt': new Date() }, $unset: { purchaseOpening: 1 } },
    );
    logger.info(`New game ${claimed.code}: ${approved.length} BOQ(s) sent to the Purchase FMS on ${project.code}`);
    return true;
  } catch (err) {
    await NewGame.updateOne({ _id: claimed._id }, { $unset: { purchaseOpening: 1 } });
    logger.warn(`Could not open purchasing for ${claimed.code}: ${err.message}`);
    return false;
  } finally {
    /* A no-op return above still has to let the claim go. */
    await NewGame.updateOne({ _id: claimed._id, purchaseProject: null }, { $unset: { purchaseOpening: 1 } });
  }
}

/**
 * The finished game joins the Games master, so any franchise — new or
 * existing — can pick it. Matched by name first: a game somebody already put
 * in the master by hand is linked, not duplicated.
 */
async function addToMaster(game, user) {
  const esc = String(game.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let master = await Game.findOne({ name: new RegExp(`^${esc}$`, 'i') });
  if (!master) {
    const base = String(game.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `game-${game.seq}`;
    let code = base;
    // eslint-disable-next-line no-await-in-loop
    for (let i = 2; await Game.exists({ code }); i += 1) code = `${base}-${i}`;
    master = await Game.create({
      code,
      name: game.name,
      durationMinutes: game.durationMinutes ?? undefined,
      playersMin: game.playersMin ?? undefined,
      playersMax: game.playersMax ?? undefined,
      notes: [`Built through the New Games Creation FMS (${game.code}).`, game.concept].filter(Boolean).join('\n\n'),
      active: true,
      createdBy: user._id,
    });
  }
  return master;
}

/* ── the service ────────────────────────────────────────────────────────── */

export const newGameService = {
  steps: NG_STEPS,

  /** The FMS page: one page of games, plus the rail's and tiles' counts over every game. */
  async list({
    status = 'active', q = '', page = 1, limit = 25, location = 'all',
    step, priority, state, person, game,
  } = {}, user) {
    /* WHERE THE GAME IS FOR. 'hq' is a game with no location on its indent —
       built at the Head Office for every franchise; anything else is one
       franchise's own. The figures and the rail follow the same choice. */
    const scope = location === 'hq'
      ? { $or: [{ location: null }, { location: '' }] }
      : location && location !== 'all' ? { location } : {};
    const filter = { ...scope };
    if (status === 'active') filter.status = 'active';
    else if (status === 'complete') filter.status = 'complete';
    else filter.status = { $ne: 'cancelled' };
    if (priority) filter.priority = priority;
    /* One game — the view a task opens ("Create BOQ", "Check BOQs"). */
    if (game && mongoose.isValidObjectId(game)) filter._id = new mongoose.Types.ObjectId(game);
    const needle = String(q || '').trim();
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      /* $and, because the Head Office scope is itself an $or. */
      filter.$and = [{ $or: [{ name: rx }, { code: rx }, { location: rx }] }];
    }

    const [matching, activeDocs, completeCount, locations] = await Promise.all([
      NewGame.find(filter).sort({ indentDate: -1, seq: -1 }).lean(),
      NewGame.find({ ...scope, status: 'active' }).lean(),
      NewGame.countDocuments({ ...scope, status: 'complete' }),
      NewGame.distinct('location', { location: { $nin: [null, ''] }, status: { $ne: 'cancelled' } }),
    ]);

    const ctx = await context([...matching, ...activeDocs]);
    const active = activeDocs.map((g) => shape(g, ctx));

    /* STATE AND PERSON ARE READ OFF THE STEP ON SCREEN — "Late" on Step 2 is
       games whose watching is late, "Pooja" on Step 3 is the BOQs she owns.
       Both are derived (plan dates and doers are worked out, not stored), so
       they are filtered after shaping, and the page is cut after that: a
       filter applied to one page of rows would page through the unfiltered
       set. The game count is small enough that shaping all of it is cheap. */
    const on = NG_STEPS.some((x) => x.key === step) ? step : 'indent';
    let shaped = matching.map((g) => shape(g, ctx));
    if (on === 'check') shaped = shaped.filter((g) => g.boqs.length);
    const peopleOptions = [...new Map(shaped.flatMap((g) => stepDoerIds(g, on))
      .map((pid) => [pid, ctx.people.get(pid)]).filter(([, u]) => u)).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    if (state) shaped = shaped.filter((g) => stateOn(g, on) === state);
    if (person) shaped = shaped.filter((g) => stepDoerIds(g, on).includes(String(person)));
    const total = shaped.length;
    const games = shaped.slice((page - 1) * limit, page * limit);

    /* The rail counts games STANDING at each step — the work waiting there. */
    const atStep = Object.fromEntries(NG_STEPS.map((s) => [s.key, 0]));
    for (const g of active) if (g.currentStep) atStep[g.currentStep] += 1;
    atStep.indent = active.length + completeCount;

    return {
      steps: await railFor(user, game),
      games,
      total,
      page,
      limit,
      locations: locations.filter(Boolean).sort((a, b) => a.localeCompare(b)),
      stepPeople: stepPeopleOf(ctx),
      peopleOptions,
      counts: {
        atStep,
        active: active.length,
        late: active.filter((g) => g.currentStep && g.steps[g.currentStep].state === 'late').length,
        boqsToCheck: active.reduce((n, g) => n + g.boqs.filter((b) => b.status === 'submitted').length, 0),
        complete: completeCount,
      },
    };
  },

  /** One game, with the flow's own words for every step — the task page reads both. */
  async get(id, user) {
    const game = await load(id);
    const plain = game.toObject();
    const ctx = await context([plain]);
    return { ...shape(plain, ctx), flow: await railFor(user, id), stepPeople: stepPeopleOf(ctx) };
  },

  /** The directory the pickers choose from. */
  async people() {
    const users = await User.find({ isActive: { $ne: false } })
      .select('name email title avatarColor').sort({ name: 1 }).lean();
    return users.map((u) => ({
      id: String(u._id), name: u.name, email: u.email, title: u.title || '', avatarColor: u.avatarColor,
    }));
  },

  /** Step 1 — the indent form. Filing it starts the flow. */
  async create(body, user) {
    const watchers = await validPeople(body.watchers);
    const now = new Date();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const last = await NewGame.findOne({}).sort({ seq: -1 }).select('seq').lean();
      const seq = (last?.seq || 0) + 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const game = await NewGame.create({
          ...pick(body),
          seq,
          code: `NG-${String(seq).padStart(3, '0')}`,
          indentDate: now,
          watchBy: body.watchBy ? new Date(body.watchBy) : addWorkDays(now, STEP.get('video').tat),
          watchers,
          steps: { video: { assignedAt: now } },
          createdBy: user._id,
          updatedBy: user._id,
        });
        logger.info(`New game indent ${game.code} “${game.name}” filed by ${user._id}`);
        const v = await view(game);
        await notifyStep(v, 'video', v.steps.video.doers, user._id);
        return v;
      } catch (err) {
        if (err?.code !== 11000) throw err; // two indents at once: take the next number
      }
    }
    throw ApiError.conflict('Could not number the indent — please try again.');
  },

  /** Correct the indent (its filer or a manager). */
  async update(id, body, user) {
    const game = await load(id);
    if (String(game.createdBy) !== String(user._id) && !(await canManage(user))) {
      throw ApiError.forbidden('Only whoever filed this indent, or a manager, can change it.');
    }
    Object.assign(game, pick(body), { updatedBy: user._id });
    if (body.watchBy) game.watchBy = new Date(body.watchBy);
    await game.save();
    return view(game);
  },

  /** Step 2 — "I have watched it". Only for oneself. */
  async watch(id, user) {
    const game = await load(id);
    const fmsMap = await fmsService.resolve();
    const me = String(user._id);
    if (!doersOf(game, 'video', fmsMap).includes(me)) {
      throw ApiError.forbidden('You are not one of the people asked to watch this video.');
    }
    if (!(game.watched || []).some((w) => String(w.user) === me)) {
      game.watched.push({ user: user._id, at: new Date() });
      await game.save();
      const v = await view(game);
      if (v.steps.video.state === 'done') await notifyStep(v, 'boq', v.steps.boq.doers, user._id);
      return v;
    }
    return view(game);
  },

  /** Step 3 — a BOQ. Several per game; the step ends when its maker says so. */
  async addBoq(id, body, user) {
    const game = await load(id);
    const fmsMap = await fmsService.resolve();
    await mustBeDoer(user, game, 'boq', fmsMap);
    if (game.status !== 'active') throw ApiError.badRequest('This game is finished.');
    if (game.steps?.boq?.doneAt) throw ApiError.badRequest('The BOQ step is marked done. Reopen it by rejecting a BOQ, or ask a manager.');
    const seq = Math.max(0, ...(game.boqs || []).map((b) => b.seq || 0)) + 1;
    game.boqs.push({ ...pickBoq(body), seq, status: 'submitted', createdBy: user._id });
    await game.save();
    return view(game);
  },

  /** Correct a BOQ. A rejected one goes back to the checker as it is saved. */
  async updateBoq(id, boqId, body, user) {
    const game = await load(id);
    const fmsMap = await fmsService.resolve();
    await mustBeDoer(user, game, 'boq', fmsMap);
    const boq = game.boqs.id(boqId);
    if (!boq) throw ApiError.notFound('BOQ not found');
    if (boq.status === 'approved') throw ApiError.badRequest('An approved BOQ is locked — it is what gets ordered.');
    Object.assign(boq, pickBoq(body));
    if (boq.status === 'rejected') {
      boq.status = 'submitted';
      boq.decidedBy = undefined;
      boq.decidedAt = undefined;
    }
    await game.save();
    return view(game);
  },

  async removeBoq(id, boqId, user) {
    const game = await load(id);
    const fmsMap = await fmsService.resolve();
    await mustBeDoer(user, game, 'boq', fmsMap);
    const boq = game.boqs.id(boqId);
    if (!boq) throw ApiError.notFound('BOQ not found');
    if (boq.status === 'approved') throw ApiError.badRequest('An approved BOQ cannot be removed.');
    boq.deleteOne();
    await game.save();
    return view(game);
  },

  /**
   * Step 4 — approve or reject one BOQ. A rejection reopens Step 3, so the BOQ
   * maker's task comes back to them with the reason on it. Approving the last
   * one does not close the step: the checker completes it (completeStep),
   * and that is what hands the BOQs to the Purchase FMS.
   */
  async decideBoq(id, boqId, { decision, reason }, user) {
    const game = await load(id);
    const fmsMap = await fmsService.resolve();
    await mustBeDoer(user, game, 'check', fmsMap);
    const boq = game.boqs.id(boqId);
    if (!boq) throw ApiError.notFound('BOQ not found');
    if (boq.status !== 'submitted') throw ApiError.badRequest(`This BOQ is already ${boq.status}.`);
    if (decision === 'reject') {
      if (!String(reason || '').trim()) throw ApiError.badRequest('Say why it is rejected — the BOQ maker needs the reason.');
      boq.status = 'rejected';
      boq.reason = String(reason).trim();
      game.steps.boq.doneAt = undefined;
      game.steps.boq.doneBy = undefined;
    } else {
      boq.status = 'approved';
      boq.reason = reason ? String(reason).trim() : undefined;
    }
    boq.decidedBy = user._id;
    boq.decidedAt = new Date();
    game.markModified('steps');
    await game.save();
    const v = await view(await load(id));
    /* A rejection puts Step 3 back on the BOQ maker's desk — say so. */
    if (decision === 'reject') await notifyStep(v, 'boq', v.steps.boq.doers, user._id, `Rejected: ${boq.name} — ${boq.reason}`);
    return v;
  },

  /** Complete a step by hand — Step 3, Assemble, and the last step, which finishes the game. */
  async completeStep(id, key, { note } = {}, user) {
    if (!DONE_STEPS.includes(key)) throw ApiError.badRequest('That step is not finished by hand.');
    const game = await load(id);
    const plain = game.toObject();
    const ctx = await context([plain]);
    await mustBeDoer(user, game, key, ctx.fmsMap);
    const current = shape(plain, ctx);
    const step = current.steps[key];
    if (step.state === 'done') return current;
    if (step.state === 'waiting') {
      const before = NG_STEPS[STEP.get(key).n - 2];
      throw ApiError.badRequest(`“${before.label}” has to be finished first.`);
    }
    if (key === 'boq') {
      if (!current.boqs.length) throw ApiError.badRequest('Add at least one BOQ first.');
      if (current.boqs.some((b) => b.status === 'rejected')) {
        throw ApiError.badRequest('A BOQ was rejected — correct it and resubmit it first.');
      }
    }
    if (key === 'check') {
      if (!current.boqs.length) throw ApiError.badRequest('There is no BOQ to check yet.');
      const open = current.boqs.filter((b) => b.status !== 'approved');
      if (open.length) {
        throw ApiError.badRequest(`${open.length} BOQ${open.length === 1 ? ' is' : 's are'} not approved yet — approve every BOQ first (a rejected one goes back to the BOQ maker).`);
      }
    }
    game.steps[key].doneAt = new Date();
    game.steps[key].doneBy = user._id;
    if (note) game.steps[key].note = String(note).slice(0, 2000);

    if (key === 'testing') {
      game.status = 'complete';
      game.completedAt = new Date();
      try {
        const master = await addToMaster(game, user);
        game.masterGame = master._id;
      } catch (err) {
        /* The game is finished either way; the master can take it by hand. */
        logger.warn(`Could not add ${game.code} to the Games master: ${err.message}`);
      }
    }
    game.markModified('steps');
    await game.save();
    /* The checker completing Step 4 is the hand-off: every approved BOQ goes
       to the Purchase FMS at Vendor finalisation. */
    if (key === 'check') await openPurchase(game._id, user);

    /* Tell whoever the next step belongs to that it is theirs now. Step 5's
       people are the Purchase FMS's, who get their own project tasks. */
    const v = await view(await load(id));
    if (key === 'boq') await notifyStep(v, 'check', v.steps.check.doers, user._id);
    if (key === 'assemble') await notifyStep(v, 'testing', v.steps.testing.doers, user._id);
    if (key === 'testing' && v.createdBy?.id) {
      await notifyPeople([v.createdBy.id], user._id, {
        title: `Game finished · ${v.name}`,
        message: `${v.name} (${v.code}) passed testing and quality — it is in the Games master now.`,
        link: `/new-games?status=complete`,
      });
    }
    return v;
  },

  /** A manager's retry, should the automatic hand-off have failed. */
  async sendToPurchase(id, user) {
    if (!(await canManage(user))) throw ApiError.forbidden('Only a manager can do this.');
    const game = await load(id);
    if (game.purchaseProject) return view(game);
    const opened = await openPurchase(game._id, user);
    if (!opened) throw ApiError.badRequest('Step 4 has to be completed — every BOQ approved — before the BOQs can go to the Purchase FMS.');
    return view(await load(id));
  },

  /** A manager names the people for one step of one game. */
  async assign(id, key, doers, user) {
    if (!ASSIGNABLE_STEPS.includes(key)) throw ApiError.badRequest('That step is not assigned here.');
    if (!(await canManage(user))) throw ApiError.forbidden('Only a manager can assign the steps.');
    const game = await load(id);
    const people = await validPeople(doers);
    const before = new Set(doersOf(game, key, await fmsService.resolve()));
    if (key === 'video') game.watchers = people;
    else game.steps[key].doers = people;
    game.steps[key].assignedAt = new Date();
    game.markModified('steps');
    game.updatedBy = user._id;
    await game.save();
    const v = await view(game);
    /* Only the people who were not on it already — re-saving the same list
       must not ring everybody's bell again. */
    await notifyStep(v, key, people.filter((pid) => !before.has(pid)), user._id);
    return v;
  },

  /**
   * MY TASKS — the steps waiting on one person, in the Task shape My Tasks
   * already draws. Merged into /pms/tasks/mine (task.service#myTasks). A step
   * appears once the step before it is finished, and leaves when it is done.
   * Step 5 is not here: its tasks are the Purchase FMS's own, on the game's
   * host project, and reach My Tasks as ordinary project tasks.
   */
  async tasksFor(userId, { doneWithinDays = 7 } = {}) {
    const me = String(userId);
    const games = await NewGame.find({ status: { $ne: 'cancelled' } }).lean();
    if (!games.length) return { open: [], done: [] };
    const ctx = await context(games);
    const since = Date.now() - doneWithinDays * 86_400_000;
    const open = [];
    const done = [];

    for (const raw of games) {
      const g = shape(raw, ctx);
      const base = {
        priority: g.priority,
        approvalState: 'none',
        createdBy: g.createdBy ? { _id: g.createdBy.id, name: g.createdBy.name } : null,
        project: { _id: `ng-${g.id}`, name: `New game · ${g.name}`, code: g.code, city: g.location || '' },
        source: 'new-game',
      };
      for (const def of NG_STEPS.slice(1)) {
        if (def.key === 'order') continue;
        const s = g.steps[def.key];
        /* When it landed on this desk: the step before it finishing (the
           indent, for the video) — so "Newest first" on My Tasks puts a step
           that has just opened at the top. */
        const prevKey = NG_STEPS[def.n - 2]?.key;
        const landedAt = (prevKey && g.steps[prevKey]?.doneAt) || s.assignedAt || g.createdAt;
        const item = {
          ...base,
          createdAt: landedAt,
          _id: `ng-${g.id}-${def.key}`,
          code: `${g.code}-S${def.n}`,
          title: `${def.what} — ${g.name}`,
          stageName: `New Games FMS · Step ${def.n} · ${def.label}`,
          plannedEnd: s.plan,
          link: `/new-games/tasks/${g.id}/${def.key}`,
        };
        if (def.key === 'video') {
          const row = s.rows.find((r) => r.person?.id === me);
          if (!row) continue;
          if (row.doneAt) {
            if (new Date(row.doneAt).getTime() >= since) {
              done.push({ ...item, status: 'complete', completedAt: row.doneAt, actualEnd: row.doneAt, plannedEnd: row.plan });
            }
          } else if (row.stillAssigned && g.status === 'active') {
            open.push({ ...item, status: 'pending', plannedEnd: row.plan });
          }
          continue;
        }
        const mine = s.doers.some((p) => p?.id === me);
        if (s.state === 'done') {
          if (s.doneBy?.id === me && new Date(s.doneAt).getTime() >= since) {
            done.push({ ...item, status: 'complete', completedAt: s.doneAt, actualEnd: s.doneAt });
          }
        } else if (mine && s.state !== 'waiting' && g.status === 'active') {
          open.push({ ...item, status: 'pending' });
        }
      }
    }
    return { open, done };
  },
};

/* ── input whitelists ───────────────────────────────────────────────────── */

function pick(body = {}) {
  const out = {};
  for (const k of ['name', 'concept', 'location', 'priority']) {
    if (body[k] !== undefined) out[k] = body[k] === null ? undefined : String(body[k]).trim();
  }
  for (const k of ['playersMin', 'playersMax', 'durationMinutes']) {
    if (body[k] !== undefined) out[k] = body[k] === null || body[k] === '' ? undefined : Number(body[k]);
  }
  if (Array.isArray(body.videoLinks)) out.videoLinks = body.videoLinks.map((u) => String(u).trim()).filter(Boolean);
  if (Array.isArray(body.videoFiles)) out.videoFiles = body.videoFiles.filter((f) => f?.url);
  return out;
}

function pickBoq(body = {}) {
  const out = {};
  for (const k of ['name', 'category', 'items', 'notes']) {
    if (body[k] !== undefined) out[k] = body[k] === null ? undefined : String(body[k]).trim();
  }
  for (const k of ['leadTimeDays', 'estimatedCost']) {
    if (body[k] !== undefined) out[k] = body[k] === null || body[k] === '' ? undefined : Number(body[k]);
  }
  if (body.deadline !== undefined) out.deadline = body.deadline ? new Date(body.deadline) : undefined;
  if (Array.isArray(body.files)) out.files = body.files.filter((f) => f?.url);
  return out;
}

export default newGameService;
