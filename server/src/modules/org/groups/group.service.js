import { WorkGroup } from './group.model.js';
import { User } from '../../auth/auth.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { ROLES } from '../../../core/constants/index.js';
import { emitGroupDeleted } from './group.events.js';

const populate = (q) =>
  q.populate('members', 'name email title department avatarColor').populate('createdBy', 'name avatarColor').populate('branch', 'name code');

const isOwnerOrAdmin = (group, user) => user.role === ROLES.ADMIN || String(group.createdBy) === String(user.id);

async function assertUsersExist(ids = []) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return;
  const found = await User.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) throw ApiError.badRequest('One or more selected people no longer exist');
}

export const groupService = {
  /** Admins and managers see every group; everyone else sees groups they belong to or created. */
  async list(user) {
    const filter = [ROLES.ADMIN, ROLES.MANAGER].includes(user.role)
      ? {}
      : { $or: [{ members: user.id }, { createdBy: user.id }] };
    return populate(WorkGroup.find(filter).sort({ name: 1 }));
  },

  async getById(id) {
    const group = await populate(WorkGroup.findById(id));
    if (!group) throw ApiError.notFound('Group not found');
    return group;
  },

  async create({ members = [], ...data }, user) {
    await assertUsersExist(members);
    // The creator is always part of their own group.
    const all = [...new Set([...members.map(String), String(user.id)])];
    const group = await WorkGroup.create({ ...data, members: all, createdBy: user.id });
    return this.getById(group._id);
  },

  async update(id, { members, ...data }, user) {
    const group = await WorkGroup.findById(id);
    if (!group) throw ApiError.notFound('Group not found');
    if (!isOwnerOrAdmin(group, user)) throw ApiError.forbidden('Only the group creator or an admin can edit this group');
    if (members) {
      await assertUsersExist(members);
      group.members = [...new Set([...members.map(String), String(group.createdBy)])];
    }
    Object.assign(group, data);
    await group.save();
    return this.getById(id);
  },

  /** Deleting a group never deletes its tasks — they're simply un-grouped. */
  async remove(id, user) {
    const group = await WorkGroup.findById(id);
    if (!group) throw ApiError.notFound('Group not found');
    if (!isOwnerOrAdmin(group, user)) throw ApiError.forbidden('Only the group creator or an admin can delete this group');
    await emitGroupDeleted(group._id);
    await group.deleteOne();
    return group;
  },

  /** Ids of groups a user belongs to — drives "group members see group tasks". */
  async idsForUser(userId) {
    const rows = await WorkGroup.find({ members: userId }).select('_id').lean();
    return rows.map((r) => r._id);
  },

  async memberIds(groupId) {
    const g = await WorkGroup.findById(groupId).select('members').lean();
    if (!g) throw ApiError.notFound('Group not found');
    return g.members.map(String);
  },
};

export default groupService;
