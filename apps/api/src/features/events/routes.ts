import { Router } from 'express';
import { createBabyEventSchema, listBabyEventsQuerySchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';

/**
 * Mounted by the baby router at /:babyId/events, behind `requireBabyInFamily`,
 * which itself sits behind `requireFamilyMembership`. Every route here
 * therefore has both a resolved membership and a baby proven to belong to it.
 *
 * Deliberately without `mergeParams`, like the baby router: `familyId` and
 * `babyId` are not visible in here, so an event's family and baby can only come
 * from the resolved scopes.
 */
export const babyEventRouter: Router = Router();

babyEventRouter.post('/', validate({ body: createBabyEventSchema }), controller.create);
babyEventRouter.get('/', validate({ query: listBabyEventsQuerySchema }), controller.list);
babyEventRouter.get('/:eventId', controller.getOne);
