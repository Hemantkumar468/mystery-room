import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { accessService } from '../access/access.service.js';
import { systemRoleFor } from '../../core/constants/jobRoles.js';
import { ROLES } from '../../core/constants/index.js';
import { Project } from '../pms/projects/project.model.js';
import { Task } from '../pms/tasks/task.model.js';
import { User } from './auth.model.js';
import { withoutTenant } from '../../core/tenancy/tenantContext.js';

function signTokens(user) {
  const payload = { sub: user.id, role: user.role };
  const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
  const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
  return { accessToken, refreshToken };
}

/**
 * Refuse to strand the ERP without an MD who can still sign in.
 *
 * Scoped to MD specifically, not all of LEADERSHIP: an EA cannot create users
 * or restore an account, so a company left with only an EA has locked itself
 * out of user management just as surely as one with nobody.
 */
async function assertNotLastActiveAdmin(user, action) {
  if (user.role !== ROLES.MD) return;
  const others = await User.countDocuments({
    _id: { $ne: user._id },
    role: ROLES.MD,
    isActive: true,
  });
  if (others === 0) {
    throw ApiError.badRequest(
      `"${user.name}" is the only active MD — promote another MD before you ${action}.`,
    );
  }
}

export const authService = {
  async login({ email, password }) {
    /* Unscoped: authentication is what DETERMINES the company, so it cannot
     already be filtered by one. Kept as narrow as possible — a single user
     lookup, and nothing else inside the exemption. */
    const user = await withoutTenant(
      'authentication resolves which company a user belongs to',
      () => User.findOne({ email }).select('+password +isActive +tenant'),
    );
    if (!user || !(await user.comparePassword(password))) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    if (!user.isActive) throw ApiError.forbidden('Account is deactivated');

    user.lastLoginAt = new Date();
    await user.save();
    return { user, tokens: signTokens(user) };
  },

  async refresh(refreshToken) {
    if (!refreshToken) throw ApiError.unauthorized('Refresh token required');
    const payload = jwt.verify(refreshToken, config.jwt.refreshSecret);
    const user = await withoutTenant(
      'authentication resolves which company a user belongs to',
      () => User.findById(payload.sub).select('+isActive +tenant'),
    );
    if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive or missing');
    return { user, tokens: signTokens(user) };
  },

  async me(userId) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    return user;
  },

  /**
   * The employee directory. `isActive` is `select: false` on the schema, so it
   * has to be asked for explicitly or the UI can never show who is deactivated.
   */
  async listUsers(filter = {}) {
    const query = {};
    if (filter.role) query.role = filter.role;
    if (filter.jobRole === 'none') query.$or = [{ jobRoles: { $size: 0 } }, { jobRoles: { $exists: false } }];
    else if (filter.jobRole) query.jobRoles = filter.jobRole;
    if (filter.department) query.department = filter.department;
    if (filter.status === 'active') query.isActive = true;
    if (filter.status === 'inactive') query.isActive = false;
    if (filter.search) {
      const rx = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      /* `$and` rather than a second `$or`, because the no-seat filter above
         may already own that key and the last one written would silently
         win - turning "unassigned, called Ram" into "unassigned OR Ram". */
      const text = [{ name: rx }, { email: rx }, { title: rx }];
      if (query.$or) { query.$and = [{ $or: query.$or }, { $or: text }]; delete query.$or; } else query.$or = text;
    }
    return User.find(query).select('+isActive').sort({ name: 1 });
  },

  async getUser(id) {
    const user = await User.findById(id).select('+isActive');
    if (!user) throw ApiError.notFound('Employee not found');
    return user;
  },

  /**
   * Create an employee account. Unlike a self-service signup this issues no
   * tokens and touches no cookies — the admin stays signed in as themselves.
   */
  async createUser(input) {
    const email = input.email.toLowerCase().trim();
    if (await User.exists({ email })) throw ApiError.conflict('Email already registered');
    const user = await User.create({ ...input, email });
    return this.getUser(user._id);
  },

  async updateUser(id, data) {
    const user = await this.getUser(id);

    if (data.email && data.email.toLowerCase() !== user.email) {
      const email = data.email.toLowerCase().trim();
      if (await User.exists({ email, _id: { $ne: user._id } })) {
        throw ApiError.conflict('Email already registered');
      }
      user.email = email;
    }

    // Demoting the last admin would lock everyone out of user management.
    if (data.role && data.role !== user.role) {
      await assertNotLastActiveAdmin(user, 'change their role');
    }

    for (const key of ['name', 'role', 'department', 'employeeId', 'title', 'phone', 'avatarColor']) {
      if (data[key] !== undefined) user[key] = data[key];
    }

    /* The company's own roles. Assigning a seat does NOT change the security
       tier by itself - handing somebody the MD's tier is a decision, and the
       Employees screen makes it explicitly with the Role field beside this
       one. What it does do is fill in a tier for an account that has none
       yet, so a new hire given "Civil Head" is not left as a Viewer who
       cannot open the work their seat is supposed to own. */
    if (data.jobRoles !== undefined) {
      user.jobRoles = data.jobRoles;
      const implied = systemRoleFor(data.jobRoles);
      if (implied && data.role === undefined && !user.role) user.role = implied;
    }
    // Password is only set when a value is supplied; the pre-save hook hashes it.
    if (data.password) user.password = data.password;

    await user.save();
    /* A role change rewrites what this person can reach, and the access
       resolver caches its answers until something tells it not to. Without
       this line a demotion would take effect everywhere except the one place
       that matters - the permission check - until the process restarted. */
    accessService.invalidate();
    return this.getUser(user._id);
  },

  /** Admin-set password. Kept separate from updateUser so it can be audited/rate-limited. */
  async resetPassword(id, password) {
    const user = await this.getUser(id);
    user.password = password;
    await user.save();
    return this.getUser(user._id);
  },

  async setUserActive(id, isActive, actorId) {
    const user = await this.getUser(id);
    if (String(user._id) === String(actorId)) {
      throw ApiError.badRequest('You cannot deactivate your own account.');
    }
    if (!isActive) await assertNotLastActiveAdmin(user, 'deactivate them');
    user.isActive = isActive;
    await user.save();
    return this.getUser(user._id);
  },

  /**
   * Hard-delete an employee. Refused when the account is still referenced by a
   * project or task, because those documents populate `owner`/`assignee` and
   * would silently render blank. Deactivation is the answer in that case.
   */
  async removeUser(id, actorId) {
    const user = await this.getUser(id);
    if (String(user._id) === String(actorId)) {
      throw ApiError.badRequest('You cannot delete your own account.');
    }
    await assertNotLastActiveAdmin(user, 'delete them');

    const [ownedProjects, memberProjects, assignedTasks] = await Promise.all([
      Project.countDocuments({ owner: user._id }),
      Project.countDocuments({ members: user._id }),
      Task.countDocuments({ assignee: user._id }),
    ]);
    const refs = ownedProjects + memberProjects + assignedTasks;
    if (refs > 0) {
      const parts = [
        ownedProjects && `owns ${ownedProjects} project${ownedProjects > 1 ? 's' : ''}`,
        memberProjects && `is a member of ${memberProjects} project${memberProjects > 1 ? 's' : ''}`,
        assignedTasks && `is assigned ${assignedTasks} task${assignedTasks > 1 ? 's' : ''}`,
      ].filter(Boolean);
      throw ApiError.badRequest(
        `"${user.name}" ${parts.join(' and ')}. Deactivate the account instead of deleting it.`,
      );
    }

    await User.deleteOne({ _id: user._id });
    return user;
  },
};

export default authService;
