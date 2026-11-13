import { Router } from 'express';
import {
  createHealthRecordSchema,
  listHealthRecordsQuerySchema,
  updateHealthRecordSchema,
} from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';

/**
 * Mounted by the baby router at /:babyId/health, behind `requireBabyInFamily`
 * (and so behind `requireFamilyMembership`). Without `mergeParams`, like every
 * router here: family and baby come only from the resolved scopes.
 *
 * Per baby only, as growth is: twins have separate medical histories.
 */
export const healthRecordRouter: Router = Router();

healthRecordRouter.post('/', validate({ body: createHealthRecordSchema }), controller.create);
healthRecordRouter.get('/', validate({ query: listHealthRecordsQuerySchema }), controller.list);
healthRecordRouter.patch(
  '/:recordId',
  validate({ body: updateHealthRecordSchema }),
  controller.update,
);
healthRecordRouter.delete('/:recordId', controller.remove);
