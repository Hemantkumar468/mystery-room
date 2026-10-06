import { AccessPolicy } from './access.model.js';
import {
  ACCESS_CATALOG, ALL_SURFACES, SEAT_DEFAULTS, defaultGrantsForJobRole,
  defaultLevel, isKnownSurface, jobRoleSummaries, surfaceFor, tierGrantsFor, tierNote,
} from './access.catalog.js';
import { JOB_ROLES, isJobRole, jobRole } from '../../core/constants/jobRoles.js';
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
 *   1. THE CATALOGUE DEFAULT for whichever role answers for this person -
 *      their job role's tier, or their bare security tier when they hold no
 *      job role. Reproduces exactly what the hard-coded nav policy did before
 *      this module existed, so an ERP with no saved policy behaves as it
 *      always has.
 *   2. THE ROLE POLICY, if somebody has saved one. Only the keys they changed.
 *   3. THE PERSON'S OWN OVERRIDE, if they have one. Only the keys somebody
 *      decided for them by name; `inherit` means "no decision here".
 *
 * WHICH ROLE ANSWERS, when a person holds several. The sheet names Prateek as
 * Managing Director, Financial Expert AND Feasibility Expert; he does not
 * stop being the MD while filing a feasibility score. So a person holding
 * several seats gets the STRONGEST answer any of them gives, per surface -
 * the union of the seats, not their intersection. Narrowing one seat
 * therefore does not narrow a person who also holds a wider one, which is
 * the only reading that does not silently demote people.
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

/**
 * tenant:subjectKey -> resolved map. Cleared whole on any policy write.
 *
 * AND ALSO AGED OUT, which `bump()` alone does not do. The clear only reaches
 * the process that handled the save. One API process is the whole story in
 * development; a deployment running two (or restarting one behind the other)
 * is not, and there the second process would go on answering from a cache
 * nothing ever invalidated — permissions changed on screen, saved to the
 * database, and simply not applied, with no error anywhere to explain it.
 * That is the single worst failure this module can have, because it looks
 * exactly like the feature not working.
 *
 * Thirty seconds: long enough that a burst of guarded requests costs one
 * resolve, short enough that nobody demonstrating a change waits on it.
 * `bump()` still runs and is still what makes a save feel instant — this is
 * the backstop under it, not a replacement for it.
 */
const TTL_MS = 30_000;
const cache = new Map();
const cacheKey = (kind, id) => `${currentTenant() ?? '-'}:${kind}:${id}`;
const bump = () => cache.clear();

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  return hit.value;
};

const cacheSet = (key, value) => { cache.set(key, { at: Date.now(), value }); return value; };

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

/** The saved layer for one of the company's own roles. */
async function jobRoleGrants(key) {
  const doc = await loadPolicy('jobRole', key);
  return sanitise(doc?.grants, { allowInherit: false });
}

/** The saved person layer, sanitised. `inherit` survives here and only here. */
async function userGrants(userId) {
  const doc = await loadPolicy('user', userId);
  return sanitise(doc?.grants, { allowInherit: true });
}

/** The stronger of two levels - how two seats held by one person combine. */
const strongest = (a, b) => ((ACCESS_RANK[a] ?? 0) >= (ACCESS_RANK[b] ?? 0) ? a : b);

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
      /* THE roles, as far as this screen is concerned - the company's own,
         from SHEET/USERROLE.xlsx. */
      jobRoles: jobRoleSummaries().map((r) => ({ ...r, defaults: defaultGrantsForJobRole(r.key) })),
      /* The five security tiers, still served because accounts that hold no
         seat in the sheet fall back to them and somebody has to be able to
         see what that fallback grants. */
      tiers: ROLE_VALUES.map((role) => ({
        value: role, label: ROLE_LABELS[role], defaults: tierGrantsFor(role), defaultsNote: tierNote(role),
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
    const hit = cacheGet(cacheKey('role', role));
    if (hit) return hit;

    const saved = await roleGrants(role);
    const merged = applyCascade({ ...tierGrantsFor(role), ...saved });
    const result = { role, levels: merged, saved };
    return cacheSet(cacheKey('role', role), result);
  },

  /**
   * What one of the company's own roles may reach, before anybody's personal
   * override.
   *
   * `saved` comes back separately from `levels` for the same reason it does
   * on forRole: the Settings screen has to show which cells are a decision
   * somebody took and which are still the shipped default, and a merged map
   * cannot tell them apart.
   */
  async forJobRole(key) {
    if (!isJobRole(key)) throw ApiError.badRequest(`Unknown job role: ${key}`);
    const hit = cacheGet(cacheKey('jobRole', key));
    if (hit) return hit;

    const saved = await jobRoleGrants(key);
    const seat = jobRole(key);
    const merged = applyCascade({ ...defaultGrantsForJobRole(key), ...saved });
    const result = {
      key, title: seat.title, systemRole: seat.systemRole, levels: merged, saved,
    };
    return cacheSet(cacheKey('jobRole', key), result);
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
    const hit = cacheGet(cacheKey('user', id));
    if (hit) return hit;

    /* `jobRoles` decides the answer now, so a caller passing a user object
       that predates the field would silently resolve as seatless. Re-read
       unless the object actually carries it. */
    const doc = (user && user.role && Array.isArray(user.jobRoles)) ? user : await User.findById(id).lean();
    if (!doc) throw ApiError.notFound('No such user');

    /* The seats this person holds, and what each of them grants. A seat the
       registry no longer knows (a role deleted from the sheet) is skipped
       rather than throwing - the account keeps its other seats and shows up
       on the Employees screen as needing attention. */
    const seats = (doc.jobRoles ?? []).filter(isJobRole);

    let base;
    if (seats.length) {
      const layers = [];
      for (const key of seats) {
        // eslint-disable-next-line no-await-in-loop -- at most a handful, all cached after the first pass
        layers.push(await this.forJobRole(key));
      }
      /* The union: the strongest answer any seat gives. See the note at the
         top of this file for why it is not the intersection. */
      const merged = {};
      for (const surface of ALL_SURFACES) {
        merged[surface.key] = layers.reduce(
          (lvl, layer) => strongest(lvl, layer.levels[surface.key] ?? ACCESS.NONE),
          ACCESS.NONE,
        );
      }
      base = { levels: merged };
    } else {
      /* No seat in the sheet - the demo and QA logins. They fall back to the
         bare security tier, which is exactly how the whole app worked before
         job roles existed. */
      base = await this.forRole(doc.role);
    }

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
      jobRoles: seats,
      levels: applyCascade(levels),
      overrides,
      /* True when somebody has decided something for this person by name.
         The Settings screen badges them, because a person whose access no
         longer follows their role is the one thing a reader of a role matrix
         cannot otherwise see. */
      hasOverrides: Object.keys(overrides).length > 0,
    };
    return cacheSet(cacheKey('user', id), result);
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
    /* Who actually sits in each seat. The screen shows it beside the role
       name, because "Civil Head" means nothing to somebody deciding a policy
       until they can see it is Ram Singh - and because a seat with nobody in
       it is worth noticing before its permissions are tuned for an hour. */
    const holders = await User.find({ jobRoles: { $exists: true, $ne: [] } })
      .select('name email jobRoles isActive avatarColor')
      .lean();

    /**
     * WHO A TIER ACTUALLY REACHES, and why this is the most important number
     * on the screen.
     *
     * A tier only answers for somebody who holds NO seat in the org sheet -
     * forRole() is the `else` branch of forUser(). Most of the company is in
     * that branch: the sheet names about twenty people and the ERP has fifty
     * accounts. So an admin can spend twenty minutes narrowing "Feasibility
     * Expert", sign in as the person they had in mind, and find nothing has
     * changed - because that person holds no seat and was never reading the
     * role layer at all.
     *
     * Nothing on the screen said so. The seat list showed its holders, the
     * tiers said "access tier" and stopped, and the difference between the
     * two - which is the difference between a policy that lands and one that
     * does not - was invisible. It is counted here and shown there.
     */
    const seatless = await User.find({
      isActive: { $ne: false },
      $or: [{ jobRoles: { $exists: false } }, { jobRoles: { $size: 0 } }],
    }).select('name email role').lean();

    const tiers = {};
    for (const role of ROLE_VALUES) {
      // eslint-disable-next-line no-await-in-loop -- five tiers, all cached after the first pass
      const { saved, levels } = await this.forRole(role);
      tiers[role] = {
        label: ROLE_LABELS[role],
        saved,
        levels,
        defaults: tierGrantsFor(role),
        defaultsNote: tierNote(role),
        holders: seatless
          .filter((u) => u.role === role)
          .map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
      };
    }

    const roles = {};
    for (const seat of JOB_ROLES) {
      // eslint-disable-next-line no-await-in-loop -- twenty seats, all cached after the first pass
      const { saved, levels } = await this.forJobRole(seat.key);
      roles[seat.key] = {
        key: seat.key,
        title: seat.title,
        short: seat.short,
        systemRole: seat.systemRole,
        department: seat.department,
        seats: seat.seats,
        sheetRows: seat.sheetRows,
        color: seat.color,
        saved,
        levels,
        defaults: defaultGrantsForJobRole(seat.key),
        /* The sheet's own sentence for this seat, where it has one. The
           screen prints it above the rows, so a role that ships narrowed
           to its own queue reads as a decision the company stated rather
           than as a role somebody broke. */
        defaultsNote: SEAT_DEFAULTS[seat.key]?.why ?? null,
        /* Live accounts only. The deactivated stand-ins the migration
           switched off still carry their seat - on purpose, so the history
           of who held what survives - but listing them beside the real
           holder would make every seat look doubly staffed, which is the
           confusion this whole exercise started from. */
        holders: holders
          .filter((u) => (u.jobRoles ?? []).includes(seat.key) && u.isActive !== false)
          .map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
        retired: holders.filter((u) => (u.jobRoles ?? []).includes(seat.key) && u.isActive === false).length,
      };
    }

    const docs = await AccessPolicy.find({ subjectType: 'user' }).lean();
    const ids = docs.map((d) => d.subjectId);
    const users = ids.length
      ? await User.find({ _id: { $in: ids } }).select('name email role employeeId title jobRoles').lean()
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
          jobRoles: user?.jobRoles ?? [],
          title: user?.title ?? '',
          missing: !user,
          note: doc.note ?? '',
          grants: sanitise(doc.grants, { allowInherit: true }),
          updatedAt: doc.updatedAt,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { roles, tiers, people };
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

  /**
   * Save one of the company's own roles. Replaces its layer wholesale - the
   * screen always sends the full set of decisions it is showing, so a partial
   * merge would make a cleared cell impossible to express.
   */
  async saveJobRole(key, grants, actor) {
    if (!isJobRole(key)) throw ApiError.badRequest(`Unknown job role: ${key}`);
    const clean = sanitise(grants, { allowInherit: false });

    /* Same guard as the MD tier, for the same reason: the Managing Director
       seat is the way back from any policy mistake, and there is no way back
       from closing it. */
    if (key === 'managing-director' && clean['module:access'] && !atLeast(clean['module:access'], ACCESS.MANAGE)) {
      throw ApiError.badRequest(
        'The Managing Director must keep full control of Access Control - otherwise nobody can undo this.',
      );
    }

    await AccessPolicy.findOneAndUpdate(
      { subjectType: 'jobRole', subjectId: key },
      { $set: { grants: clean, updatedBy: actor?._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    bump();
    return this.forJobRole(key);
  },

  /** Put one of the company's roles back to what its tier grants. */
  async resetJobRole(key) {
    if (!isJobRole(key)) throw ApiError.badRequest(`Unknown job role: ${key}`);
    await AccessPolicy.deleteOne({ subjectType: 'jobRole', subjectId: key });
    bump();
    return this.forJobRole(key);
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
    const user = await User.findById(userId).select('name email role title employeeId jobRoles').lean();
    if (!user) throw ApiError.notFound('No such user');

    const seats = (user.jobRoles ?? []).filter(isJobRole);
    const effective = await this.forUser(user);

    /*
     * The role half of the answer, whichever kind of role answers for this
     * person: the union of their seats, or the bare tier when the sheet gives
     * them none. Both `saved` (what somebody decided) and `levels` (what it
     * adds up to) are needed - the screen distinguishes a decision from a
     * default, and with several seats the decision may be on any one of them.
     */
    const layers = [];
    for (const key of seats) {
      // eslint-disable-next-line no-await-in-loop -- a handful, all cached
      layers.push(await this.forJobRole(key));
    }
    if (!layers.length) layers.push(await this.forRole(user.role));

    const roleLayer = {
      saved: Object.fromEntries(ALL_SURFACES
        .map((sf) => {
          const decided = layers.map((l) => l.saved[sf.key]).filter((v) => v !== undefined);
          return decided.length ? [sf.key, decided.reduce(strongest)] : null;
        })
        .filter(Boolean)),
      levels: Object.fromEntries(ALL_SURFACES.map((sf) => [
        sf.key,
        layers.reduce((lvl, l) => strongest(lvl, l.levels[sf.key] ?? ACCESS.NONE), ACCESS.NONE),
      ])),
    };

    const overrides = await userGrants(userId);

    const rows = ALL_SURFACES.map((surface) => {
      /* What this person would get with nothing decided anywhere - the
         strongest of their seats' tiers, or their own tier when seatless. */
      const fallback = (seats.length ? seats : [null]).reduce((lvl, key) => {
        const tier = key ? jobRole(key).systemRole : user.role;
        return strongest(lvl, defaultLevel(surface, tier));
      }, ACCESS.NONE);
      const fromRole = roleLayer.saved[surface.key];
      const own = overrides[surface.key];
      const level = effective.levels[surface.key] ?? ACCESS.NONE;

      let source = 'default';
      if (fromRole !== undefined) source = seats.length ? 'jobRole' : 'role';
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
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        jobRoles: seats,
        jobRoleTitles: seats.map((k) => jobRole(k).title),
        title: user.title ?? '',
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
