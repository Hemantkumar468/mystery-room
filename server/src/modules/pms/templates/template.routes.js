import { Router } from 'express';
import { templateController } from './template.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_ADMINISTER, CAN_MANAGE } from '../../../core/constants/index.js';
import {
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesSchema,
  idParamSchema,
} from './template.validation.js';

const router = Router();
const canDesign = authorize(...CAN_MANAGE);

router.use(authenticate);

router.get('/', validate(listTemplatesSchema), templateController.list);
// Must precede `/:id` — that route validates a 24-char ObjectId and would reject "default".
router.get('/default', templateController.getDefault);
router.get('/:id', validate(idParamSchema), templateController.get);

router.post('/', canDesign, validate(createTemplateSchema), templateController.create);
router.patch('/:id', canDesign, validate(updateTemplateSchema), templateController.update);
router.post('/:id/default', canDesign, validate(idParamSchema), templateController.setDefault);
router.post('/:id/publish', canDesign, validate(idParamSchema), templateController.publish);
router.post('/:id/archive', canDesign, validate(idParamSchema), templateController.archive);
router.post('/:id/clone', canDesign, validate(idParamSchema), templateController.clone);
router.delete('/:id', authorize(...CAN_ADMINISTER), validate(idParamSchema), templateController.remove);

export default router;
