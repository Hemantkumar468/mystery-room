import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { ApiError } from '../../core/utils/ApiError.js';
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

export const authService = {
  async register(input) {
    const exists = await User.findOne({ email: input.email });
    if (exists) throw ApiError.conflict('Email already registered');
    const user = await User.create(input);
    return { user, tokens: signTokens(user) };
  },

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

  /** Directory of assignable users (managers/executors) for pickers in the UI. */
  async listUsers(filter = {}) {
    const query = {};
    if (filter.role) query.role = filter.role;
    if (filter.department) query.department = filter.department;
    return User.find(query).sort({ name: 1 });
  },
};

export default authService;
