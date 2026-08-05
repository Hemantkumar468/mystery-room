import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { misService } from './mis.service.js';

/**
 * `range`/`dept` are validated to known values upstream (mis.routes.js), so by
 * the time they land here `range` is either a day count or `all`. Both filters
 * use `all` for "no filter", which the service represents as null.
 */
const readScope = (req) => {
  const { range, dept } = req.validatedQuery || {};
  return {
    days: !range || range === 'all' ? null : Number(range),
    department: dept && dept !== 'all' ? dept : null,
  };
};

export const misController = {
  portfolio: asyncHandler(async (req, res) => {
    const report = await misService.report(readScope(req));
    return ApiResponse.ok(res, report, 'MIS portfolio report');
  }),

  project: asyncHandler(async (req, res) => {
    const report = await misService.report({ ...readScope(req), projectId: req.params.id });
    return ApiResponse.ok(res, report, 'MIS project report');
  }),
};

export default misController;
