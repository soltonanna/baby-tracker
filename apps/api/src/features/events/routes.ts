import { Router } from 'express';
import {
  createBabyEventSchema,
  createBothBabiesEventSchema,
  listBabyEventsQuerySchema,
  updateBabyEventSchema,
} from '@baby-tracker/shared';
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
babyEventRouter.patch('/:eventId', validate({ body: updateBabyEventSchema }), controller.update);
babyEventRouter.delete('/:eventId', controller.remove);

/**
 * Mounted by the family router at /:familyId/event-groups, behind
 * `requireFamilyMembership`.
 *
 * A *group* is the resource, not a baby: one action recorded for both babies
 * writes two ordinary events sharing a `groupId` (decision D2), and this is the
 * endpoint that creates one. Family-scoped rather than baby-scoped for the same
 * reason — “both” is not a third baby, and there is no baby in this path to
 * pretend otherwise. It also leaves room for the grouped edit and delete
 * `ARCHITECTURE_PROPOSAL.md` §5.5 sketches, which would address a group by its
 * id here; neither is part of this stage.
 *
 * The body is `createBothBabiesEventSchema`: the event's own fields and nothing
 * else, under the same cross-field rules as a single create.
 * No `familyId`, no `babyId`, and no `groupId` — unknown keys are stripped, so a
 * client that sends one is not refused, it simply does not decide anything. The
 * two babies come from the resolved family scope and the grouping id from the
 * server.
 *
 * Deliberately without `mergeParams`, like every other router here.
 */
export const eventGroupRouter: Router = Router();

eventGroupRouter.post('/', validate({ body: createBothBabiesEventSchema }), controller.createGroup);
