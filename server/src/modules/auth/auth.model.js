import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_VALUES, ROLES, DEPARTMENT_VALUES } from '../../core/constants/index.js';

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
    role: { type: String, enum: ROLE_VALUES, default: ROLES.EXECUTOR, index: true },
    department: { type: String, enum: DEPARTMENT_VALUES },
    // Links this login account to a roster member (client/src/lib/employees.js),
    // so a user can be authorized as a task's primary/backup "doer".
    employeeId: { type: String, trim: true, index: true },
    title: { type: String, trim: true }, // e.g. "Expansion Lead"
    avatarColor: { type: String, default: '#6E45FF' }, // seeded UI avatar tint
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true, select: false },
    lastLoginAt: { type: Date },
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

export const User = model('User', userSchema);
export default User;
