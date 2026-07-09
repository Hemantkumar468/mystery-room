import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { calendarService } from './calendar.service.js';

export const calendarController = {
  events: asyncHandler(async (req, res) => {
    const { from, to, project } = req.validatedQuery || {};
    const data = await calendarService.events({ from, to, projectId: project });
    return ApiResponse.ok(res, data, 'Calendar events');
  }),
};

export default calendarController;
