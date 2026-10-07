import { Router } from 'express';
import { createGrowthMeasurementSchema, updateGrowthMeasurementSchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';

/**
 * Mounted by the baby router at /:babyId/growth, behind `requireBabyInFamily`
 * (and so behind `requireFamilyMembership`). Without `mergeParams`, like every
 * router here: the family and baby come only from the resolved scopes.
 *
 * No "both babies" endpoint, deliberately: twins measured at the same visit
 * have different numbers, so there is nothing to record once for both.
 */
export const growthRouter: Router = Router();

growthRouter.post('/', validate({ body: createGrowthMeasurementSchema }), controller.create);
growthRouter.get('/', controller.list);
growthRouter.patch(
  '/:measurementId',
  validate({ body: updateGrowthMeasurementSchema }),
  controller.update,
);
growthRouter.delete('/:measurementId', controller.remove);
