import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { config } from '../../config/index.js';
import { authService } from './auth.service.js';

const refreshCookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

export const authController = {
  register: asyncHandler(async (req, res) => {
    const { user, tokens } = await authService.register(req.body);
    res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions);
    return ApiResponse.created(res, { user, accessToken: tokens.accessToken }, 'Account created');
  }),

  login: asyncHandler(async (req, res) => {
    const { user, tokens } = await authService.login(req.body);
    res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions);
    return ApiResponse.ok(res, { user, accessToken: tokens.accessToken }, 'Logged in');
  }),

  refresh: asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    const { user, tokens } = await authService.refresh(token);
    res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions);
    return ApiResponse.ok(res, { user, accessToken: tokens.accessToken }, 'Token refreshed');
  }),

  logout: asyncHandler(async (_req, res) => {
    res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
    return ApiResponse.ok(res, null, 'Logged out');
  }),

  me: asyncHandler(async (req, res) => {
    const user = await authService.me(req.user.id);
    return ApiResponse.ok(res, user);
  }),

  listUsers: asyncHandler(async (req, res) => {
    const users = await authService.listUsers(req.validatedQuery || {});
    return ApiResponse.ok(res, users);
  }),
};

export default authController;
