import { User } from '../../auth/auth.model.js';
import { Team } from '../teams/team.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { containsRegex } from '../../../core/utils/regex.js';
import { scopeService } from '../scope.service.js';

/**
 * The organisation directory as the ops modules need it: who works where,
 * who they report to, which teams they're on. Read by pickers and the
 * Teams page; admins maintain the ops fields here.
 */
export const peopleService = {
  async list(query = {}) {
    const filter = {};
    if (query.role) filter.role = query.role;
    if (query.department) filter.department = query.department;
    if (query.branch) filter.branch = query.branch;
    if (query.search) {
      const rx = containsRegex(query.search);
      filter.$or = [{ name: rx }, { email: rx }, { title: rx }];
    }
    if (query.team) filter._id = { $in: await scopeService.teamMemberIds(query.team) };
    if (query.group) {
      const ids = await scopeService.groupMemberIds(query.group);
      filter._id = filter._id ? { $in: filter._id.$in.filter((id) => ids.includes(String(id))) } : { $in: ids };
    }

    const [people, teams] = await Promise.all([
      User.find(filter)
        .select('+isActive')
        .sort({ name: 1 })
        .populate('branch', 'name code')
        .populate('reportingManager', 'name avatarColor'),
      Team.find().select('name color members.user members.role').lean(),
    ]);

    const teamsByUser = new Map();
    for (const t of teams) {
      for (const m of t.members) {
        const key = String(m.user);
        if (!teamsByUser.has(key)) teamsByUser.set(key, []);
        teamsByUser.get(key).push({ _id: t._id, name: t.name, color: t.color, role: m.role });
      }
    }

    return people
      .filter((p) => query.includeInactive === 'true' || p.isActive !== false)
      .map((p) => ({
        ...p.toJSON(),
        isActive: p.isActive !== false,
        teams: teamsByUser.get(String(p._id)) || [],
      }));
  },

  /** Admin: maintain a person's branch, reporting line and ops flags. */
  async updateOpsProfile(id, data) {
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound('Person not found');
    if (data.reportingManager && String(data.reportingManager) === String(id)) {
      throw ApiError.badRequest('A person cannot report to themselves');
    }
    if (data.branch !== undefined) user.branch = data.branch || undefined;
    if (data.reportingManager !== undefined) user.reportingManager = data.reportingManager || undefined;
    if (data.department !== undefined) user.department = data.department || undefined;
    if (data.title !== undefined) user.title = data.title;
    if (data.opsFlags) {
      if (data.opsFlags.coordinator !== undefined) user.set('opsFlags.coordinator', data.opsFlags.coordinator);
      if (data.opsFlags.director !== undefined) user.set('opsFlags.director', data.opsFlags.director);
    }
    await user.save();
    return User.findById(id).populate('branch', 'name code').populate('reportingManager', 'name avatarColor');
  },
};

export default peopleService;
