import { FmsAssignment } from './fmsAssignment.model.js';
import {
  FMS_CATALOG, ALL_ITEMS, isKnownItem, itemKeyOf,
} from './fms.catalog.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { currentTenant } from '../../core/tenancy/tenantContext.js';
import { User } from '../auth/auth.model.js';
import {
  FORM_OWNER, ITEM_OWNER, SHEET_OWNED_ROLES, jobRoleTitle, sheetEmailsFor,
} from '../../core/constants/jobRoles.js';

/**
 * Who each recurring job belongs to.
 *
 * THREE ANSWERS, IN ORDER, and the screen shows which one is in force:
 *
 *   1. WHAT SOMEBODY CHOSE HERE. A saved row wins outright.
 *   2. THE ORG SHEET, for the four assessments. It names a Feasibility
 *      Expert and a Technical Expert, and those people fill those forms —
 *      so a company that never opens this screen still has its assessments
 *      addressed correctly (see core/constants/jobRoles.js#FORM_OWNER).
 *   3. THE TEMPLATE's own assignee list, which is where every job came from
 *      before any of this existed.
 *
 * Stating the fallback rather than writing it into the database on first
 * load is what keeps the screen honest: a row somebody actually decided
 * looks different from one that has simply never been touched, and the
 * second keeps tracking the sheet as people join and leave.
 */

/** Resolved answers, cleared whenever anything is saved. */
const cache = new Map();
const cacheKey = () => `${currentTenant() ?? '-'}`;
const bump = () => cache.clear();

const ids = (list) => (list ?? []).map(String);

/** The job role the sheet names for one catalogue item, or null. */
export const ownerRoleForItem = (item) => (
  FORM_OWNER[item?.formKey] ?? ITEM_OWNER[item?.key] ?? null
);

/**
 * The people the org sheet puts on a job, where it has an opinion.
 *
 * TWO WAYS IN, AND THE SECOND IS THE ONE THAT USUALLY ANSWERS. The seat
 * first: every account carrying that `jobRole`, oldest first. Then, for any
 * seat still empty, the person the sheet names by email.
 *
 * The email pass is not a nicety. Most live accounts hold no job role — they
 * were created before the Employees page could record one — so the seat
 * lookup comes back empty for seats that are, in reality, filled. Without
 * the second pass the four assessments and the property hunt fall through to
 * whatever placeholder the project template shipped with, which is precisely
 * the complaint: the sheet names the Technical Expert, and the work goes
 * somewhere else.
 *
 * Matched case-insensitively, because an address typed into a sheet and one
 * typed into a sign-up form differ by capitals more often than by anything
 * else.
 */
async function sheetOwners() {
  const roles = SHEET_OWNED_ROLES;
  const holders = await User.find({ jobRoles: { $in: roles }, isActive: { $ne: false } })
    .select('jobRoles name title')
    .sort({ createdAt: 1 })
    .lean();

  const byRole = new Map();
  for (const u of holders) {
    for (const role of u.jobRoles ?? []) {
      if (roles.includes(role) && !byRole.has(role)) byRole.set(role, { ...u, via: 'seat' });
    }
  }

  const unfilled = roles.filter((r) => !byRole.has(r));
  if (!unfilled.length) return byRole;

  const wanted = [...new Set(unfilled.flatMap((r) => sheetEmailsFor(r)))]
    .map((e) => e.toLowerCase());
  if (!wanted.length) return byRole;

  const named = await User.find({ isActive: { $ne: false } })
    .select('email name title')
    .lean();
  const byEmail = new Map(named
    .filter((u) => u.email)
    .map((u) => [u.email.toLowerCase(), u]));

  for (const role of unfilled) {
    for (const email of sheetEmailsFor(role)) {
      const u = byEmail.get(email.toLowerCase());
      if (u) { byRole.set(role, { ...u, via: 'email' }); break; }
    }
  }
  return byRole;
}

export const fmsService = {
  /** The registry the Settings screen draws. */
  catalog() {
    return { fms: FMS_CATALOG, items: ALL_ITEMS };
  },

  /**
   * Every job with who is on it, why, and the people picker's directory.
   *
   * One payload rather than three: the screen is a single table and every
   * row needs the same list of names, so fetching them per row would be a
   * request per assessment.
   */
  async board() {
    const [saved, owners, people] = await Promise.all([
      FmsAssignment.find({}).lean(),
      sheetOwners(),
      User.find({ isActive: { $ne: false } })
        .select('name email role title jobRoles avatarColor')
        .sort({ name: 1 })
        .lean(),
    ]);

    const byItem = new Map(saved.map((d) => [d.item, d]));
    const byId = new Map(people.map((u) => [String(u._id), u]));
    const named = (list) => ids(list).map((id) => byId.get(id)).filter(Boolean).map((u) => ({
      id: String(u._id), name: u.name, title: u.title ?? '', avatarColor: u.avatarColor,
    }));

    const rows = ALL_ITEMS.map((item) => {
      const doc = byItem.get(item.key);
      if (doc && (doc.doers?.length || doc.buddies?.length)) {
        return {
          ...item,
          source: 'chosen',
          doers: named(doc.doers),
          buddies: named(doc.buddies),
          note: doc.note ?? '',
          updatedAt: doc.updatedAt,
        };
      }

      /* Nobody has decided this one. Say what happens today, and why. */
      const role = ownerRoleForItem(item);
      const owner = role ? owners.get(role) : null;
      return {
        ...item,
        source: owner ? 'sheet' : 'template',
        fallbackSays: owner
          ? `${owner.name} — the ${jobRoleTitle(role)} named in the org sheet`
          : item.fms === 'new-games'
            ? 'Nobody yet — name someone here, or per game on the New Games page'
            : 'Whoever the project template names for this job',
        doers: owner ? named([owner._id]) : [],
        buddies: [],
        note: '',
      };
    });

    return {
      fms: FMS_CATALOG,
      rows,
      people: people.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        title: u.title ?? '',
        role: u.role,
        avatarColor: u.avatarColor,
      })),
    };
  },

  /**
   * Who a task being created right now should go to.
   *
   * Returns only jobs somebody has actually chosen — the caller keeps its
   * own fallbacks for the rest, so an empty map here means "nothing has been
   * decided", not "assign nobody".
   */
  async resolve() {
    const hit = cache.get(cacheKey());
    if (hit) return hit;

    const saved = await FmsAssignment.find({}).lean();
    const map = new Map();
    for (const doc of saved) {
      if (!doc.doers?.length && !doc.buddies?.length) continue;
      map.set(doc.item, { doers: ids(doc.doers), buddies: ids(doc.buddies) });
    }
    cache.set(cacheKey(), map);
    return map;
  },

  /**
   * WHO THE ORG SHEET WOULD PUT ON EACH JOB — the layer under `resolve()`.
   *
   * Kept apart from it because the two answer different questions and
   * callers need to tell them apart: `resolve()` is "what did somebody
   * DECIDE", this is "what does the sheet SAY". A caller that wants the
   * effective answer asks for the first and falls back to the second, which
   * is the order the Assign Work screen already displays them in.
   *
   * Not cached. It reads who holds a seat, and that changes on the Employees
   * page — a cache here would keep addressing new work to somebody who has
   * left, which is the one failure that must not be silent.
   */
  async sheetDefaults() {
    const owners = await sheetOwners();
    const out = new Map();
    for (const item of ALL_ITEMS) {
      const role = ownerRoleForItem(item);
      const u = role ? owners.get(role) : null;
      if (u) {
        out.set(item.key, {
          id: String(u._id), name: u.name, title: u.title ?? '', role, via: u.via,
        });
      }
    }
    return out;
  },

  /**
   * One job's effective default doer, for pre-filling a picker.
   *
   * Decided-here first, then the sheet. Returns null rather than throwing on
   * an unknown job: this only ever suggests a name, and a form that cannot
   * suggest one should still open.
   */
  async defaultDoerFor(itemKey) {
    if (!isKnownItem(itemKey)) return null;
    const chosen = (await this.resolve()).get(itemKey);
    if (chosen?.doers?.length) {
      const u = await User.findById(chosen.doers[0]).select('name title').lean();
      if (u) {
        return {
          id: String(u._id),
          name: u.name,
          title: u.title ?? '',
          source: 'chosen',
          says: `${u.name} — chosen on Settings → FMS · Assign Work`,
        };
      }
    }
    const fromSheet = (await this.sheetDefaults()).get(itemKey);
    if (!fromSheet) return null;
    return {
      ...fromSheet,
      source: 'sheet',
      says: `${fromSheet.name} — the ${jobRoleTitle(fromSheet.role)} named in the org sheet`,
    };
  },

  /** The same lookup a task can do with what it already carries. */
  async forTask(stageKey, taskKey) {
    const map = await this.resolve();
    return map.get(itemKeyOf(stageKey, taskKey)) ?? null;
  },

  async save(item, { doers = [], buddies = [], note } = {}, actor) {
    if (!isKnownItem(item)) throw ApiError.badRequest(`Unknown job: ${item}`);

    const wanted = [...new Set([...ids(doers), ...ids(buddies)])];
    if (wanted.length) {
      const found = await User.find({ _id: { $in: wanted } }).select('_id').lean();
      if (found.length !== wanted.length) throw ApiError.badRequest('One of those people no longer has an account.');
    }

    /* Somebody on both lists is a contradiction the screen should not be able
       to save: a buddy covers for a doer, and being your own cover means the
       job has no cover at all. The doer wins. */
    const doerIds = ids(doers);
    const buddyIds = ids(buddies).filter((id) => !doerIds.includes(id));

    await FmsAssignment.findOneAndUpdate(
      { item },
      {
        $set: {
          fms: (ALL_ITEMS.find((i) => i.key === item)?.fms) ?? 'property',
          doers: doerIds,
          buddies: buddyIds,
          note: typeof note === 'string' ? note.slice(0, 300) : undefined,
          updatedBy: actor?._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    bump();
    return this.board();
  },

  /** Back to the fallback — the org sheet, then the template. */
  async clear(item) {
    if (!isKnownItem(item)) throw ApiError.badRequest(`Unknown job: ${item}`);
    await FmsAssignment.deleteOne({ item });
    bump();
    return this.board();
  },

  /** Exposed so a write elsewhere can drop the cache. */
  invalidate: bump,
};

export default fmsService;
