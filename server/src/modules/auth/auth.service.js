import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { ROLES } from '../../core/constants/index.js';
import { Project } from '../pms/projects/project.model.js';
import { Task } from '../pms/tasks/task.model.js';
import { User } from './auth.model.js';

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
    const user = await User.findOne({ email }).select('+password +isActive');
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
    const user = await User.findById(payload.sub).select('+isActive');
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
    if (filter.department) query.department = filter.department;
    if (filter.status === 'active') query.isActive = true;
    if (filter.status === 'inactive') query.isActive = false;
    if (filter.search) {
      const rx = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: rx }, { email: rx }, { title: rx }];
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
    // Password is only set when a value is supplied; the pre-save hook hashes it.
    if (data.password) user.password = data.password;

    await user.save();
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
