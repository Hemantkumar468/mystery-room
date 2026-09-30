import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { requireStep } from '../../../core/middleware/access.js';
import { ACCESS } from '../../../core/constants/access.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';
import { TaskCategory, TaskTag } from './catalog.model.js';
import { ORG_EVENTS, emitOrgEvent } from '../org.events.js';

/**
 * Categories and tags — two small managed lists. Delegations store the NAME
 * (so historical rows read naturally), which is why a category rename is
 * cascaded onto existing tasks.
 */
const router = Router();
const objectId = z.string().length(24);
/**
 * Curating these two lists is an Ops-settings write. Both guards run — the
 * role rule, then the decision taken on Settings → Access Control — passed as
 * an array, which Express expands in order. Reading stays open: every task
 * form and filter in Delegation and Checklist picks from these, and a picker
 * that 403s reads as a broken page rather than a permission.
 */
const canCurate = [authorize(...CAN_MANAGE), requireStep('org-settings', ACCESS.EDIT)];

const body = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().max(20).optional(),
});
const createSchema = z.object({ body });
const updateSchema = z.object({ params: z.object({ id: objectId }), body });
const idParam = z.object({ params: z.object({ id: objectId }) });

function mount(path, Model, { label, onRename }) {
  router.get(
    `/${path}`,
    asyncHandler(async (_req, res) => ApiResponse.ok(res, await Model.find().sort({ name: 1 }).collation({ locale: 'en' }))),
  );

  router.post(
    `/${path}`,
    canCurate,
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const doc = await Model.create({ ...req.body, createdBy: req.user.id });
      return ApiResponse.created(res, doc, `${label} created`);
    }),
  );

  router.patch(
    `/${path}/:id`,
    canCurate,
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const doc = await Model.findById(req.params.id);
      if (!doc) throw ApiError.notFound(`${label} not found`);
      const oldName = doc.name;
      doc.name = req.body.name;
      if (req.body.color) doc.color = req.body.color;
      await doc.save();
      let cascaded = 0;
      if (onRename && oldName !== doc.name) {
        const results = await onRename(oldName, doc.name);
        cascaded = results.reduce((s, r) => s + (Number(r) || 0), 0);
      }
      return ApiResponse.ok(res, doc, cascaded ? `${label} renamed — ${cascaded} task(s) updated` : `${label} updated`, {
        cascaded,
      });
    }),
  );

  router.delete(
    `/${path}/:id`,
    canCurate,
    validate(idParam),
    asyncHandler(async (req, res) => {
      const doc = await Model.findByIdAndDelete(req.params.id);
      if (!doc) throw ApiError.notFound(`${label} not found`);
      // Existing tasks keep the name they were filed with.
      return ApiResponse.ok(res, null, `${label} removed from the list`);
    }),
  );
}

mount('categories', TaskCategory, {
  label: 'Category',
  onRename: (oldName, newName) => emitOrgEvent(ORG_EVENTS.CATEGORY_RENAMED, oldName, newName),
});
mount('tags', TaskTag, { label: 'Tag' });

export default router;
