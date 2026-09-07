import { Router } from 'express';
import { createFamilySchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFamilyMembership } from '../../middleware/familyAccess.js';
import { babyRouter } from '../babies/routes.js';
import * as controller from './controller.js';

/**
 * Mounted at /api/v1/families. Paths and middleware order only — no logic here.
 */
export const familyRouter: Router = Router();

// Applied to the whole router rather than per route: a family endpoint that is
// reachable without authentication should not be one line away.
familyRouter.use(authenticate);

familyRouter.post('/', validate({ body: createFamilySchema }), controller.create);
familyRouter.get('/', controller.list);
familyRouter.get('/:familyId', requireFamilyMembership, controller.getOne);

// Babies live inside a family, in the URL and in the code. Membership is
// resolved once here, so nothing under /babies can be reached without it.
familyRouter.use('/:familyId/babies', requireFamilyMembership, babyRouter);
