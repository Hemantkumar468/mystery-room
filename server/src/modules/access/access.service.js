import { AccessPolicy } from './access.model.js';
import {
  ACCESS_CATALOG, ALL_SURFACES, defaultGrantsFor, defaultLevel, isKnownSurface, surfaceFor,
} from './access.catalog.js';
import {
  ACCESS, ACCESS_VALUES, ACCESS_RANK, INHERIT, atLeast, weakest,
} from '../../core/constants/access.js';
import { ROLE_VALUES, ROLE_LABELS } from '../../core/constants/index.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { currentTenant } from '../../core/tenancy/tenantContext.js';
import { User } from '../auth/auth.model.js';

/**
 * The resolver: three layers collapsed into one answer per surface.
 *
 *   1. THE CATALOGUE DEFAULT for the person's role. Reproduces exactly what
 *      the hard-coded nav policy did before this module existed, so an ERP
 *      with no saved policy behaves as it always has.
 *   2. THE ROLE POLICY, if somebody has saved one. Only the keys they changed.
 *   3. THE PERSON'S OWN OVERRIDE, if they have one. Only the keys somebody
 *      decided for them by name; `inherit` means "no decision here".
 *
 * Then, and only then, THE CASCADE: a step is clamped to its module. This is
 * applied last rather than being enforced at save time on purpose. An admin
 * who hides the whole Purchase module for a role, thinks better of it and
 * turns it back on should find the three steps underneath exactly as they
 * left them - clamping at save would have quietly destroyed those rows and
 * there would be no way to tell afterwards that they ever existed.
 *
 * WHY THE CACHE IS A PLAIN MAP AND NOT A TTL. Permission answers are needed
 * on every guarded request, and they change only when somebody presses Save
 * on one screen. A time-based cache would be wrong in both directions at
 * once: still stale a minute after a deliberate change, and still re-reading
 * for an hour of nothing happening. `bump()` on every write is exact.
 */

/** tenant:subjectKey -> resolved map. Cleared whole on any policy write. */
const cache = new Map();
const cacheKey = (kind, id) => `${currentTenant() ?? '-'}:${kind}:${id}`;
const bump = () => cache.clear();

const isLevel = (v) => ACCESS_VALUES.includes(v);

/** A stored Map, a plain object, or nothing -> a plain object. */
function toGrantObject(grants) {
  if (!grants) return {};
  if (grants instanceof Map) return Object.fromEntries(grants);
  if (typeof grants.toObject === 'function') return grants.toObject();
  return { ...grants };
}

/**
 * Drop anything the catalogue does not recognise, and anything that is not a
 * level.
 *
 * Unknown keys are dropped rather than rejected: a module removed from the
 * app leaves rows behind in policies saved while it existed, and refusing to
 * load them would make every one of those policies unopenable. They are
 * simply not part of the answer any more.
 */
function sanitise(grants, { allowInherit }) {
  const out = {};
  for (const [key, value] of Object.entries(toGrantObject(grants))) {
    if (!isKnownSurface(key)) continue;
    if (value === INHERIT) {
      if (allowInherit) out[key] = INHERIT;
      continue;
    }
    if (isLevel(value)) out[key] = value;
  }
  return out;
}

async function loadPolicy(subjectType, subjectId) {
  const doc = await AccessPolicy.findOne({ subjectType, subjectId: String(subjectId) }).lean();
  return doc ?? null;
}

/** The saved role layer, sanitised. `{}` when nobody has saved one. */
async function roleGrants(role) {
  const doc = await loadPolicy('role', role);
  return sanitise(doc?.grants, { allowInherit: false });
}

/** The saved person layer, sanitised. `inherit` survives here and only here. */
async function userGrants(userId) {
  const doc = await loadPolicy('user', userId);
  return sanitise(doc?.grants, { allowInherit: true });
}

/**
 * Clamp every child to its parent, once the three layers are merged.
 *
 * Single pass, because the catalogue is two deep by construction - modules
 * have no parents and steps have no children. If that ever stops being true
 * this becomes a walk down the tree, and the catalogue's `parent` field is
 * already the edge it would walk.
 */
function applyCascade(levels) {
  const out = { ...levels };
  for (const surface of ALL_SURFACES) {
    if (!surface.parent) continue;
    const parentLevel = out[surface.parent] ?? ACCESS.NONE;
    out[surface.key] = weakest(out[surface.key] ?? ACCESS.NONE, parentLevel);
  }
  return out;
}

export const accessService = {
  /** The registry the Settings screen draws, with each role's defaults. */
  catalog() {
    return {
      sections: ACCESS_CATALOG,
      surfaces: ALL_SURFACES,
      levels: ACCESS_VALUES,
      roles: ROLE_VALUES.map((role) => ({
        value: role, label: ROLE_LABELS[role], defaults: defaultGrantsFor(role),
      })),
    };
  },

  /**
   * What one role may reach, before anybody's personal override.
   *
   * Also the answer for "what does this role look like now" on the Settings
   * screen, which is why it returns the saved layer separately: the screen
   * has to show which cells are a decision somebody took and which are still
   * the default, and a merged map cannot tell them apart.
   */
  async forRole(role) {
    if (!ROLE_VALUES.includes(role)) throw ApiError.badRequest(`Unknown role: ${role}`);
    const hit = cache.get(cacheKey('role', role));
    if (hit) return hit;

    const saved = await roleGrants(role);
    const merged = applyCascade({ ...defaultGrantsFor(role), ...saved });
    const result = { role, levels: merged, saved };
    cache.set(cacheKey('role', role), result);
    return result;
  },

  /**
   * The effective answer for one person - the map every gate reads.
   *
   * Takes the user document rather than an id wherever the caller already has
   * one (every authenticated request does), because this runs on the request
   * path and a second read of a document already in hand is pure cost.
   */
  async forUser(user) {
    const id = String(user?._id ?? user?.id ?? user);
    const hit = cache.get(cacheKey('user', id));
    if (hit) return hit;

    const doc = (user && user.role) ? user : await User.findById(id).lean();
    if (!doc) throw ApiError.notFound('No such user');

    const base = await this.forRole(doc.role);
    const overrides = await userGrants(id);

    const levels = { ...base.levels };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === INHERIT) continue;
      levels[key] = value;
    }

    const result = {
      userId: id,
      name: doc.name,
      role: doc.role,
      levels: applyCascade(levels),
      overrides,
      /* True when somebody has decided something for this person by name.
         The Settings screen badges them, because a person whose access no
         longer follows their role is the one thing a reader of a role matrix
         cannot otherwise see. */
      hasOverrides: Object.keys(overrides).length > 0,
    };
    cache.set(cacheKey('user', id), result);
    return result;
  },

  /**
   * The subset of `keys` this person holds at least `level` on.
   *
   * What a list endpoint filters ITS ROWS by. Hiding the Offer stage from a
   * hiring coordinator has to mean the candidates standing in it never reach
   * their browser - a client-side filter over a full payload is a screen that
   * looks right and an API response that is not.
   */
  async filter(user, keys, level = ACCESS.VIEW) {
    const { levels } = await this.forUser(user);
    return keys.filter((key) => atLeast(levels[key] ?? ACCESS.NONE, level));
  },

  /** `true` if this person has at least `level` on this surface. */
  async allows(user, key, level = ACCESS.VIEW) {
    if (!isKnownSurface(key)) return true; // not gated - see requireAccess
    const { levels } = await this.forUser(user);
    return atLeast(levels[key] ?? ACCESS.NONE, level);
  },

  /**
   * Everything the Settings screen needs in one read: the five role layers,
   * and every person who has an override.
   *
   * The people list is deliberately NOT every user in the company - it is the
   * ones somebody has singled out. The screen's person picker searches the
   * directory separately, because a company of 150 does not belong in a
   * config payload.
   */
  async policies() {
    const roles = {};
    for (const role of ROLE_VALUES) {
      // eslint-disable-next-line no-await-in-loop -- five roles, all cached after the first pass
      const { saved, levels } = await this.forRole(role);
      roles[role] = { label: ROLE_LABELS[role], saved, levels, defaults: defaultGrantsFor(role) };
    }

    const docs = await AccessPolicy.find({ subjectType: 'user' }).lean();
    const ids = docs.map((d) => d.subjectId);
    const users = ids.length
      ? await User.find({ _id: { $in: ids } }).select('name email role employeeId title').lean()
      : [];
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const people = docs
      .map((doc) => {
        const user = byId.get(String(doc.subjectId));
        /* An override whose account was deleted. Kept visible rather than
           hidden, so somebody can clear it - an invisible row is how a
           policy collection turns into a graveyard nobody dares touch. */
        return {
          userId: doc.subjectId,
          name: user?.name ?? 'Deleted user',
          email: user?.email ?? '',
          role: user?.role ?? null,
          title: user?.title ?? '',
          missing: !user,
          note: doc.note ?? '',
          grants: sanitise(doc.grants, { allowInherit: true }),
          updatedAt: doc.updatedAt,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { roles, people };
  },

  /**
   * Save a role layer. Replaces it wholesale - the screen always sends the
   * full set of decisions it is showing, so a partial merge would make a
   * cleared cell impossible to express.
   */
  async saveRole(role, grants, actor) {
    if (!ROLE_VALUES.includes(role)) throw ApiError.badRequest(`Unknown role: ${role}`);
    const clean = sanitise(grants, { allowInherit: false });

    /* The MD cannot lock themselves out of this screen. Not paternalism: the
       only way back from an empty Access Control policy is a database edit,
       and the person who would have to make it is the one who just lost the
       ability to ask for it. */
    if (role === 'md' && clean['module:access'] && !atLeast(clean['module:access'], ACCESS.MANAGE)) {
      throw ApiError.badRequest(
        'The Managing Director must keep full control of Access Control - otherwise nobody can undo this.',
      );
    }

    await AccessPolicy.findOneAndUpdate(
      { subjectType: 'role', subjectId: role },
      { $set: { grants: clean, updatedBy: actor?._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    bump();
    return this.forRole(role);
  },

  /** Put a role back to the catalogue defaults by deleting its saved layer. */
  async resetRole(role) {
    if (!ROLE_VALUES.includes(role)) throw ApiError.badRequest(`Unknown role: ${role}`);
    await AccessPolicy.deleteOne({ subjectType: 'role', subjectId: role });
    bump();
    return this.forRole(role);
  },

  /**
   * Save one person's override.
   *
   * `inherit` is accepted and stored if a caller sends it, so the API can
   * express "explicitly no decision here". The Settings screen does not use
   * it that way - setting a cell back to "Same as role" removes the key
   * entirely, because a person's override list is read as "the ways this
   * person differs from their role" and a row that differs in no way makes
   * that list longer without making it say more.
   */
  async saveUser(userId, grants, actor, note) {
    const user = await User.findById(userId).select('name role').lean();
    if (!user) throw ApiError.notFound('No such user');

    const clean = sanitise(grants, { allowInherit: true });

    await AccessPolicy.findOneAndUpdate(
      { subjectType: 'user', subjectId: String(userId) },
      {
        $set: {
          grants: clean,
          note: typeof note === 'string' ? note.slice(0, 400) : undefined,
          updatedBy: actor?._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    bump();
    return this.forUser({ _id: userId, role: user.role, name: user.name });
  },

  /** Drop an override entirely - the person goes back to following their role. */
  async clearUser(userId) {
    await AccessPolicy.deleteOne({ subjectType: 'user', subjectId: String(userId) });
    bump();
    return this.forUser(userId);
  },

  /**
   * The preview the Settings screen shows: what this person would actually
   * see, with the reason for each answer.
   *
   * The reason is the half that makes the screen usable. "Hidden" on its own
   * invites the next question immediately - is that their role, something
   * somebody set for them, or the module above it being off? - and answering
   * it by hand means reading three tables at once.
   */
  async explain(userId) {
    const user = await User.findById(userId).select('name email role title employeeId').lean();
    if (!user) throw ApiError.notFound('No such user');

    const roleLayer = await this.forRole(user.role);
    const overrides = await userGrants(userId);
    const effective = await this.forUser({ _id: userId, role: user.role, name: user.name });

    const rows = ALL_SURFACES.map((surface) => {
      const fallback = defaultLevel(surface, user.role);
      const fromRole = roleLayer.saved[surface.key];
      const own = overrides[surface.key];
      const level = effective.levels[surface.key] ?? ACCESS.NONE;

      let source = 'default';
      if (fromRole !== undefined) source = 'role';
      if (own !== undefined && own !== INHERIT) source = 'person';
      /* Stated last because it outranks the other three: whatever the row
         itself says, a child of a hidden module is hidden. */
      const parentLevel = surface.parent ? (effective.levels[surface.parent] ?? ACCESS.NONE) : null;
      if (surface.parent && ACCESS_RANK[parentLevel] < ACCESS_RANK[own ?? fromRole ?? fallback]) {
        source = 'module';
      }

      return {
        key: surface.key,
        kind: surface.kind,
        label: surface.label,
        section: surface.section,
        level,
        source,
        roleDefault: fallback,
        roleLevel: roleLayer.levels[surface.key] ?? ACCESS.NONE,
      };
    });

    return {
      user: {
        id: String(user._id), name: user.name, email: user.email, role: user.role, title: user.title ?? '',
      },
      levels: effective.levels,
      hasOverrides: effective.hasOverrides,
      rows,
    };
  },

  /** For tests and for the routes that need to know a key is real. */
  isKnownSurface,
  surfaceFor,
  /** Exposed so a write path elsewhere can drop the cache after a role change. */
  invalidate: bump,
};

export default accessService;
