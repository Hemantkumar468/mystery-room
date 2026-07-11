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
  /**
   * Admin creates an employee account. This must NOT issue tokens or touch the
   * refresh cookie: doing so would overwrite the acting admin's own session
   * with the freshly created employee's.
   */
  createUser: asyncHandler(async (req, res) => {
    const user = await authService.createUser(req.body);
    return ApiResponse.created(res, user, 'Employee created');
  }),

  updateUser: asyncHandler(async (req, res) => {
    const user = await authService.updateUser(req.params.id, req.body);
    return ApiResponse.ok(res, user, 'Employee updated');
  }),

  resetPassword: asyncHandler(async (req, res) => {
    const user = await authService.resetPassword(req.params.id, req.body.password);
    return ApiResponse.ok(res, user, 'Password reset');
  }),

  setUserStatus: asyncHandler(async (req, res) => {
    const user = await authService.setUserActive(req.params.id, req.body.isActive, req.user.id);
    return ApiResponse.ok(res, user, user.isActive ? 'Employee reactivated' : 'Employee deactivated');
  }),

  removeUser: asyncHandler(async (req, res) => {
    await authService.removeUser(req.params.id, req.user.id);
    return ApiResponse.ok(res, null, 'Employee deleted');
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
