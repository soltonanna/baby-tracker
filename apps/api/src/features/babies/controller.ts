import type { RequestHandler } from 'express';
import type {
  BabyListResponse,
  BabyResponse,
  CreateBabyInput,
  UpdateBabyInput,
} from '@baby-tracker/shared';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import * as babyService from './service.js';

export const create: RequestHandler = async (req, res) => {
  const baby = await babyService.createBaby(getFamilyScope(req), req.body as CreateBabyInput);

  res.status(201).json({ baby } satisfies BabyResponse);
};

export const list: RequestHandler = async (req, res) => {
  const babies = await babyService.listBabies(getFamilyScope(req));

  res.status(200).json({ babies } satisfies BabyListResponse);
};

export const getOne: RequestHandler = async (req, res) => {
  // Express 5 types a route parameter as string | string[]; anything that is
  // not a plain string is not an id, and the service answers 404 for it.
  const { babyId } = req.params;
  const baby = await babyService.getBaby(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
  );

  res.status(200).json({ baby } satisfies BabyResponse);
};

export const update: RequestHandler = async (req, res) => {
  const { babyId } = req.params;
  const baby = await babyService.updateBaby(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
    req.body as UpdateBabyInput,
  );

  res.status(200).json({ baby } satisfies BabyResponse);
};
