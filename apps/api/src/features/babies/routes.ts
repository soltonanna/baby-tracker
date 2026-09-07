import { Router } from 'express';
import { createBabySchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import { requireBabyInFamily } from '../../middleware/babyAccess.js';
import { babyEventRouter } from '../events/routes.js';
import * as controller from './controller.js';

/**
 * Mounted by the family router at /:familyId/babies, behind
 * `requireFamilyMembership`, so every route here already has a resolved
 * membership and none of them repeats the check.
 *
 * Deliberately without `mergeParams`: `familyId` is not visible in here, so the
 * family a baby belongs to can only come from the resolved scope, never from
 * the URL or the body.
 */
export const babyRouter: Router = Router();

babyRouter.post('/', validate({ body: createBabySchema }), controller.create);
babyRouter.get('/', controller.list);
babyRouter.get('/:babyId', controller.getOne);

// Tracker events live inside a baby, in the URL and in the code. The baby is
// resolved once here, so nothing under /events can be reached for a baby that
// does not belong to the caller's family.
babyRouter.use('/:babyId/events', requireBabyInFamily, babyEventRouter);
