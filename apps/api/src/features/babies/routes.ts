import express, { Router } from 'express';
import {
  BABY_PHOTO_CONTENT_TYPES,
  BABY_PHOTO_MAX_BYTES,
  createBabySchema,
  updateBabySchema,
} from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import { requireBabyInFamily } from '../../middleware/babyAccess.js';
import { requireFamilyRole } from '../../middleware/familyAccess.js';
import { babyEventRouter } from '../events/routes.js';
import { growthRouter } from '../growth/routes.js';
import { healthRecordRouter } from '../health-records/routes.js';
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
babyRouter.patch('/:babyId', validate({ body: updateBabySchema }), controller.update);

// Removing a child erases their events and growth records with them, so — like
// the family-wide reset — it is the owner's alone.
babyRouter.delete('/:babyId', requireFamilyRole('OWNER'), controller.remove);

// The profile photo. The baby is resolved first, so the body is only read for
// a baby the caller may edit; the raw parser accepts the three image types and
// stops at the size cap, and the service re-checks the bytes themselves.
babyRouter.put(
  '/:babyId/photo',
  requireBabyInFamily,
  express.raw({ type: [...BABY_PHOTO_CONTENT_TYPES], limit: BABY_PHOTO_MAX_BYTES }),
  controller.putPhoto,
);
babyRouter.get('/:babyId/photo', controller.getPhoto);
babyRouter.delete('/:babyId/photo', controller.deletePhoto);

// Tracker events live inside a baby, in the URL and in the code. The baby is
// resolved once here, so nothing under /events can be reached for a baby that
// does not belong to the caller's family.
babyRouter.use('/:babyId/events', requireBabyInFamily, babyEventRouter);
babyRouter.use('/:babyId/growth', requireBabyInFamily, growthRouter);
babyRouter.use('/:babyId/health', requireBabyInFamily, healthRecordRouter);
