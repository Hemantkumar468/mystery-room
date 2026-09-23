import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_VALUES, ROLES, DEPARTMENT_VALUES } from '../../core/constants/index.js';
import { JOB_ROLE_KEYS } from '../../core/constants/jobRoles.js';
import { attachTenancy } from '../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLE_VALUES, default: ROLES.EMPLOYEE, index: true },
    department: { type: String, enum: DEPARTMENT_VALUES },
    // Links this login account to a roster member (client/src/lib/employees.js),
    // so a user can be authorized as a task's primary/backup "doer".
    employeeId: { type: String, trim: true, index: true },

    /**
     * THE COMPANY'S OWN ROLES — the seats in SHEET/USERROLE.xlsx.
     *
     * `role` above is the security TIER the software enforces (md, manager,
     * employee...). This is who the person actually is in this company:
     * Feasibility Expert, Civil Head, Cluster / Branch Manager. It is what
     * the Employees page shows, what work is handed out by name against, and
     * what Settings -> Access Control writes its policy for.
     *
     * AN ARRAY, because the org chart is one. The sheet names Prateek three
     * times (Managing Director, Financial Expert, Feasibility Expert) and
     * Siddharth twice; a single-valued field would have to throw two of
     * Prateek's three seats away, and the work addressed to those seats would
     * then reach nobody. A person holds the UNION of what their seats grant,
     * and their security tier is the strongest of them
     * (core/constants/jobRoles.js#systemRoleFor).
     *
     * Empty is a legitimate state, not a broken one: the demo and QA accounts
     * that predate the sheet have no seat in it, and they keep working on
     * their system role until somebody assigns one.
     */
    jobRoles: {
      type: [{ type: String, enum: JOB_ROLE_KEYS }],
      default: [],
      index: true,
    },

    /* Free text, and now secondary to `jobRoles` above. Kept because it is
       what several screens and the flow template still read, and because a
       person's printed designation is not always one of the 20 seats. The
       migration sets it to the primary seat's exact wording from the sheet
       where there is one. */
    title: { type: String, trim: true }, // e.g. "Expansion Lead"
    avatarColor: { type: String, default: '#6E45FF' }, // seeded UI avatar tint
    phone: { type: String, trim: true },
    /* ── WhatsApp notifications ─────────────────────────────────
       Opting out is a field on the person, not a setting somewhere else:
       whoever is being messaged has to be able to stop it, and the send path
       reads this on every message. Adding it later would mean a migration
       across every existing user, so it ships with the channel.

       `phone` above is the number used — it is normalised at send time
       (core/services/whatsapp.service.js), so a row stored as "+91 98765
       43210" still works. */
    whatsappOptOut: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, select: false },
    lastLoginAt: { type: Date },

    /* ── CRM lead rotation ──────────────────────────────────────
       Only the routing engine reads these (modules/crm/routing). They live on
       the user rather than in a CRM-side table because they answer "can work
       be given to this person right now", which is a fact about the person. */

    /**
     * Out of the rotation — leave, training, sick.
     *
     * Opt-OUT: undefined means available, so adding this field did not empty
     * every rotation the moment it shipped. Only an explicit `false` removes
     * someone.
     */
    crmAvailable: { type: Boolean },
    /** Stop assigning once this many of their leads are still open. 0 or unset
     *  means no cap. A smoothing device during campaign spikes, not a limit —
     *  if everyone is at cap the lead is still assigned to someone. */
    crmOpenLeadCap: { type: Number, min: 0 },

    /**
     * When NOT to be notified, as local hours (22 → 7 means 10pm to 7am).
     *
     * A reminder at eleven at night does not get the task done — it gets
     * notifications turned off permanently, and every reminder after it is
     * lost too. Held per user because "late" is a fact about the person, not
     * about the company.
     *
     * Both unset means no quiet hours. The reminder is not dropped when it
     * lands inside the window, it is HELD until the window ends.
     */
    quietHoursStart: { type: Number, min: 0, max: 23 },
    quietHoursEnd: { type: Number, min: 0, max: 23 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.virtual('initials').get(function () {
  return this.name
    ?.split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
});

// Hash password whenever it is set/changed.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

attachTenancy(userSchema, { modelName: 'User' });

export const User = model('User', userSchema);
export default User;
