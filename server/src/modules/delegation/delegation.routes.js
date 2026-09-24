import { Router } from 'express';
import { delegationController as c } from './delegation.controller.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import * as v from './delegation.validation.js';
import './delegation.hooks.js';

/**
 * Delegation module — assign work, follow it through acceptance, progress,
 * verification and closure, with sub-tasks, loops, groups, repeat rules,
 * reminders and escalations. Permission checks live in the services (they
 * depend on the caller's relation to each task, not just their role).
 */
const router = Router();
router.use(authenticate);

/* Tasks */
router.get('/tasks', validate(v.listSchema), c.list);
router.post('/tasks', validate(v.createSchema), c.create);
router.get('/tasks/summary', validate(v.summarySchema), c.summary);
router.get('/tasks/deleted', validate(v.deletedListSchema), c.deleted);
router.get('/tasks/collaborators', c.collaborators);
router.get('/tasks/:id', validate(v.idSchema), c.get);
router.patch('/tasks/:id', validate(v.updateSchema), c.update);
router.delete('/tasks/:id', validate(v.idSchema), c.remove);
router.post('/tasks/:id/restore', validate(v.idSchema), c.restore);

/* Lifecycle */
router.post('/tasks/:id/status', validate(v.statusSchema), c.setStatus);
router.post('/tasks/:id/complete', validate(v.completeSchema), c.complete);
router.post('/tasks/:id/approve', validate(v.remarkOptionalSchema), c.approve);
router.post('/tasks/:id/send-back', validate(v.reasonSchema), c.sendBack);
router.post('/tasks/:id/reopen', validate(v.reasonSchema), c.reopen);
router.post('/tasks/:id/due-date', validate(v.reviseSchema), c.revise);
router.post('/tasks/:id/dependent', validate(v.dependentSchema), c.dependent);
router.post('/tasks/:id/blocked', validate(v.blockedSchema), c.blocked);
router.post('/tasks/:id/reassign', validate(v.reassignSchema), c.reassign);

/* Conversation & follow-up */
router.post('/tasks/:id/comments', validate(v.commentSchema), c.comment);
router.post('/tasks/:id/management-remark', validate(v.channelRemarkSchema), c.managementRemark);
router.post('/tasks/:id/coordinator-note', validate(v.channelRemarkSchema), c.coordinatorRemark);
router.post('/tasks/:id/followups', validate(v.followupSchema), c.followup);
router.put('/tasks/:id/reminders', validate(v.remindersSchema), c.reminders);

/* Templates */
router.get('/templates', c.listTemplates);
router.post('/templates', validate(v.templateCreateSchema), c.createTemplate);
router.patch('/templates/:id', validate(v.templateUpdateSchema), c.updateTemplate);
router.delete('/templates/:id', validate(v.idSchema), c.removeTemplate);

/* Repeat rules */
router.get('/recurrences', validate(v.recurrenceListSchema), c.listRecurrences);
router.post('/recurrences/preview', validate(v.recurrencePreviewSchema), c.previewRecurrence);
router.get('/recurrences/:id', validate(v.idSchema), c.getRecurrence);
router.patch('/recurrences/:id', validate(v.recurrenceUpdateSchema), c.updateRecurrence);

export default router;
