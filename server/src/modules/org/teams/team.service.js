import { Team } from './team.model.js';
import { User } from '../../auth/auth.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { LEADERSHIP } from '../../../core/constants/index.js';
import { TEAM_ROLES } from '../../../core/constants/ops.js';

const MEMBER_FIELDS = 'name email title department avatarColor role branch';

const populateTeam = (q) =>
  q
    .populate('members.user', MEMBER_FIELDS)
    .populate('members.reportsTo', 'name avatarColor')
    .populate('branch', 'name code')
    .populate('createdBy', 'name');

/** Admins manage every team; a team's own admin/manager manages that team. */
function canManageTeam(team, user) {
  if (LEADERSHIP.includes(user.role)) return true;
  return team.members.some(
    (m) => String(m.user?._id || m.user) === String(user.id) && [TEAM_ROLES.ADMIN, TEAM_ROLES.MANAGER].includes(m.role),
  );
}

async function assertUsersExist(ids) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return;
  const found = await User.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) throw ApiError.badRequest('One or more selected people no longer exist');
}

export const teamService = {
  async list({ branch, mine, userId } = {}) {
    const filter = {};
    if (branch) filter.branch = branch;
    if (mine) filter['members.user'] = userId;
    return populateTeam(Team.find(filter).sort({ name: 1 }));
  },

  async getById(id) {
    const team = await populateTeam(Team.findById(id));
    if (!team) throw ApiError.notFound('Team not found');
    return team;
  },

  async create({ members = [], ...data }, actor) {
    await assertUsersExist([...members.map((m) => m.user), ...members.map((m) => m.reportsTo).filter(Boolean)]);
    const rows = members.map((m) => ({ ...m, addedBy: actor.id }));
    // The creator administers the team unless they placed themselves explicitly.
    if (!rows.some((m) => String(m.user) === String(actor.id))) {
      rows.push({ user: actor.id, role: TEAM_ROLES.ADMIN, addedBy: actor.id });
    }
    const team = await Team.create({ ...data, members: dedupeMembers(rows), createdBy: actor.id });
    return this.getById(team._id);
  },

  async update(id, data, actor) {
    const team = await Team.findById(id);
    if (!team) throw ApiError.notFound('Team not found');
    if (!canManageTeam(team, actor)) throw ApiError.forbidden('Only an admin or this team\'s manager can edit it');
    Object.assign(team, data);
    await team.save();
    return this.getById(id);
  },

  /** Add a member, or update their team role / reporting line if already present. */
  async upsertMember(id, { user, role, reportsTo }, actor) {
    const team = await Team.findById(id);
    if (!team) throw ApiError.notFound('Team not found');
    if (!canManageTeam(team, actor)) throw ApiError.forbidden('Only an admin or this team\'s manager can change members');
    await assertUsersExist([user, reportsTo].filter(Boolean));

    const existing = team.members.find((m) => String(m.user) === String(user));
    if (existing) {
      if (role) existing.role = role;
      if (reportsTo !== undefined) existing.reportsTo = reportsTo || undefined;
    } else {
      team.members.push({ user, role: role || TEAM_ROLES.MEMBER, reportsTo: reportsTo || undefined, addedBy: actor.id });
    }
    await team.save();
    return this.getById(id);
  },

  async removeMember(id, userId, actor) {
    const team = await Team.findById(id);
    if (!team) throw ApiError.notFound('Team not found');
    if (!canManageTeam(team, actor)) throw ApiError.forbidden('Only an admin or this team\'s manager can change members');
    const before = team.members.length;
    team.members = team.members.filter((m) => String(m.user) !== String(userId));
    if (team.members.length === before) throw ApiError.notFound('That person is not on this team');
    await team.save();
    return this.getById(id);
  },

  async remove(id) {
    const team = await Team.findByIdAndDelete(id);
    if (!team) throw ApiError.notFound('Team not found');
    return team;
  },

  /** User ids on a team — used by team-wise filters. */
  async memberIds(teamId) {
    const team = await Team.findById(teamId).select('members.user').lean();
    if (!team) throw ApiError.notFound('Team not found');
    return team.members.map((m) => String(m.user));
  },
};

function dedupeMembers(rows) {
  const seen = new Map();
  for (const r of rows) seen.set(String(r.user), r);
  return [...seen.values()];
}

export default teamService;
