import express, { Router } from 'express';
import { familyDataSchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import { requireFamilyRole } from '../../middleware/familyAccess.js';
import * as controller from './controller.js';

/**
 * Mounted by the family router at /:familyId/data, behind
 * `requireFamilyMembership`.
 *
 * Any member may export — it is a copy of what they can already read. Import
 * and clear replace or remove the children's whole record, so they are the
 * owner's alone.
 */
export const familyDataRouter: Router = Router();

/**
 * A data file is far larger than any ordinary request: six months of twins is
 * a couple of megabytes. The app-wide parser stops at 1 MB, so the import route
 * is exempted from it in `app.ts` and parses its own body here, for this route
 * only and only once the caller is known to be the owner.
 */
export const IMPORT_BODY_LIMIT = '25mb';

familyDataRouter.get('/export', controller.exportData);
familyDataRouter.post(
  '/import',
  requireFamilyRole('OWNER'),
  express.json({ limit: IMPORT_BODY_LIMIT }),
  validate({ body: familyDataSchema }),
  controller.importData,
);
familyDataRouter.delete('/', requireFamilyRole('OWNER'), controller.clearData);
