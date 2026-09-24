import mongoose from 'mongoose';
import { User } from '../auth/auth.model.js';
import { Team } from './teams/team.model.js';
import { branchService } from './branches/branch.service.js';
import { groupService } from './groups/group.service.js';
import { teamService } from './teams/team.service.js';
import { ROLES, LEADERSHIP } from '../../core/constants/index.js';
import { ACCESS, TEAM_ROLES } from '../../core/constants/ops.js';

const { isValidObjectId } = mongoose;

/**
 * Who can see what, and in which branch — the single place the delegation,
 * checklist and performance modules ask.
 *
 *   admin    (MD, EA) everything, any branch (or all branches at once)
 *   lead     (Manager) own work + direct reports + members of the teams
 *            they manage + their own department
 *   member   (Employee) own work only
 *   viewer   read-only, own work only
 */
export const scopeService = {
  accessLevel(user) {
    switch (user?.role) {
      // The MD and the EA (the MD's proxy) run delegation & checklist company-wide.
      case ROLES.MD:
      case ROLES.EA:
        return ACCESS.ADMIN;
      case ROLES.MANAGER:
        return ACCESS.LEAD;
      case ROLES.VIEWER:
        return ACCESS.VIEWER;
      default:
        return ACCESS.MEMBER;
    }
  },

  isAdmin(user) {
    return LEADERSHIP.includes(user?.role);
  },

  /**
   * The branch a request operates on. An explicit, valid `requested` wins;
   * "all" (admins and leads only) means no branch filter; otherwise the
   * caller's home branch, then the organisation default.
   *
   * @returns {Promise<string|null>} branch id, or null for "all branches"
   */
  async resolveBranch(requested, user) {
    const level = this.accessLevel(user);
    if (requested === 'all' && (level === ACCESS.ADMIN || level === ACCESS.LEAD)) return null;
    if (requested && requested !== 'all' && isValidObjectId(requested) && (await branchService.exists(requested))) {
      return String(requested);
    }
    if (user?.branch && (await branchService.exists(user.branch))) return String(user.branch);
    return branchService.defaultBranchId();
  },

  /** Direct reports of a user. */
  async directReportIds(userId) {
    const rows = await User.find({ reportingManager: userId }).select('_id').lean();
    return rows.map((r) => String(r._id));
  },

  /** Members of every team where the user is a team manager/admin. */
  async managedTeamMemberIds(userId) {
    const teams = await Team.find({
      members: { $elemMatch: { user: userId, role: { $in: [TEAM_ROLES.MANAGER, TEAM_ROLES.ADMIN] } } },
    })
      .select('members.user')
      .lean();
    return teams.flatMap((t) => t.members.map((m) => String(m.user)));
  },

  /**
   * People a lead oversees (always including themselves). Department peers are
   * returned separately because checklist rows carry their own department.
   */
  async leadScope(user) {
    const [reports, teamMembers] = await Promise.all([
      this.directReportIds(user.id),
      this.managedTeamMemberIds(user.id),
    ]);
    return {
      userIds: [...new Set([String(user.id), ...reports, ...teamMembers])],
      department: user.department || null,
    };
  },

  /**
   * The people whose work the caller may view in aggregate (performance
   * reports). null = unrestricted.
   */
  async visibleUserIds(user) {
    const level = this.accessLevel(user);
    if (level === ACCESS.ADMIN) return null;
    if (level === ACCESS.LEAD) {
      const { userIds, department } = await this.leadScope(user);
      if (!department) return userIds;
      const peers = await User.find({ department }).select('_id').lean();
      return [...new Set([...userIds, ...peers.map((p) => String(p._id))])];
    }
    return [String(user.id)];
  },

  /**
   * "Assigned by" / "created by" switch → user ids: 'me' is the caller,
   * 'admins' is every leadership account (MD and EA). Returns null when not filtering.
   */
  async byWhomIds(value, user) {
    if (value === 'me') return [String(user.id)];
    if (value === 'admins') {
      const admins = await User.find({ role: { $in: LEADERSHIP } }).select('_id').lean();
      return admins.map((a) => String(a._id));
    }
    return null;
  },

  branchExists: (id) => branchService.exists(id),
  defaultBranchId: () => branchService.defaultBranchId(),
  teamMemberIds: (teamId) => teamService.memberIds(teamId),
  groupMemberIds: (groupId) => groupService.memberIds(groupId),
  groupIdsForUser: (userId) => groupService.idsForUser(userId),
};

export default scopeService;
