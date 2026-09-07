import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { Baby } from '../models/Baby.js';
import { notFound, unauthorized } from '../lib/httpError.js';
import { getFamilyScope } from './familyAccess.js';

/**
 * The second link in the chain: user → FamilyMember → Family → **Baby** → event.
 *
 * Not a new authorization mechanism — it runs after `requireFamilyMembership`
 * and only answers one question: does this baby belong to the family whose
 * membership was already resolved? Everything nested under a baby mounts behind
 * it, so no route repeats the check.
 */
export interface BabyScope {
  babyId: string;
}

export const requireBabyInFamily: RequestHandler = async (req, _res, next) => {
  const { familyId } = getFamilyScope(req);
  const { babyId } = req.params;

  // A malformed id is answered like a missing one, so probing distinguishes
  // nothing — the same convention the family and baby routes use.
  if (typeof babyId !== 'string' || !Types.ObjectId.isValid(babyId)) {
    throw notFound('Baby not found');
  }

  const belongsToFamily = await Baby.exists({ _id: babyId, familyId });
  if (!belongsToFamily) {
    throw notFound('Baby not found');
  }

  req.babyScope = { babyId };
  next();
};

/** Reads the resolved baby, and fails loudly if the middleware did not run. */
export function getBabyScope(req: Request): BabyScope {
  if (!req.babyScope) {
    throw unauthorized('Baby access has not been resolved for this request');
  }
  return req.babyScope;
}
