import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { TEAM_ROLES, TEAM_ROLE_VALUES } from '../../../core/constants/ops.js';

const { Schema, model } = mongoose;

const teamMemberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Role inside this team — a team manager sees and scores the whole team.
    role: { type: String, enum: TEAM_ROLE_VALUES, default: TEAM_ROLES.MEMBER },
    reportsTo: { type: Schema.Types.ObjectId, ref: 'User' },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A standing team (Ops crew, Game Masters, Expansion desk…). Drives "team-wise"
 * filters on delegation, checklist and performance, and widens a manager's view
 * to everyone on the teams they manage.
 */
const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    color: { type: String, default: '#6E45FF' },
    members: [teamMemberSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

teamSchema.index({ 'members.user': 1 });
teamSchema.index({ name: 1 });

attachTenancy(teamSchema, { modelName: 'Team' });
export const Team = model('Team', teamSchema, 'org_teams');
export default Team;
