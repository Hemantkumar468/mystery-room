import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { ganttService } from './gantt.service.js';

export const ganttController = {
  timeline: asyncHandler(async (req, res) => {
    const q = req.validatedQuery || {};
    const timeline = await ganttService.timeline({
      project: q.project,
      level: q.level,
      filters: {
        city: q.city,
        status: q.status,
        health: q.health,
        department: q.department,
        owner: q.owner,
        priority: q.priority,
        stageKey: q.stageKey,
        taskStatus: q.taskStatus,
        search: q.search,
      },
    });
    return ApiResponse.ok(res, timeline, 'Gantt timeline');
  }),
};

export default ganttController;
