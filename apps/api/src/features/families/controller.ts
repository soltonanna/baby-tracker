import type { RequestHandler } from 'express';
import type { CreateFamilyInput, FamilyListResponse, FamilyResponse } from '@baby-tracker/shared';
import { getAuth } from '../../middleware/authenticate.js';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import * as familyService from './service.js';

export const create: RequestHandler = async (req, res) => {
  const { userId } = getAuth(req);
  const family = await familyService.createFamily(userId, req.body as CreateFamilyInput);

  res.status(201).json({ family } satisfies FamilyResponse);
};

export const list: RequestHandler = async (req, res) => {
  const { userId } = getAuth(req);
  const families = await familyService.listFamiliesForUser(userId);

  res.status(200).json({ families } satisfies FamilyListResponse);
};

export const getOne: RequestHandler = async (req, res) => {
  const family = await familyService.getFamily(getFamilyScope(req));

  res.status(200).json({ family } satisfies FamilyResponse);
};
