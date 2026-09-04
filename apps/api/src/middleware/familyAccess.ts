import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import type { FamilyRole } from '@baby-tracker/shared';
import { FamilyMember } from '../models/FamilyMember.js';
import { forbidden, notFound, unauthorized } from '../lib/httpError.js';
import { getAuth } from './authenticate.js';

/**
 * The family authorization boundary. Every family-scoped resource — babies,
 * events, growth, medical records — goes through here, so it is written once
 * and composed rather than repeated in controllers.
 *
 * What the caller may touch is resolved from their membership, never from
 * anything the client sent. The route parameter names a family; it does not
 * grant access to it.
 */
export interface FamilyScope {
  familyId: string;
  userId: string;
  role: FamilyRole;
  membershipId: string;
}

/**
 * Resolves the caller's membership of `:familyId` and puts it on the request.
 *
 * Returns **404** for every failure that is not the caller's fault: a malformed
 * id, a family that does not exist, and a family belonging to someone else are
 * deliberately indistinguishable. Answering 403 for the last of those would
 * confirm the family exists, which is exactly the enumeration this avoids
 * (ARCHITECTURE_PROPOSAL.md §4.3).
 */
export const requireFamilyMembership: RequestHandler = async (req, _res, next) => {
  const { userId } = getAuth(req);
  const familyId = req.params.familyId;

  if (typeof familyId !== 'string' || !Types.ObjectId.isValid(familyId)) {
    throw notFound('Family not found');
  }

  const membership = await FamilyMember.findOne({ familyId, userId }).lean();
  if (!membership) {
    throw notFound('Family not found');
  }

  req.familyScope = {
    familyId,
    userId,
    role: membership.role,
    membershipId: membership._id.toString(),
  };
  next();
};

/**
 * Narrows an already-resolved membership to particular roles. Must run after
 * `requireFamilyMembership`.
 *
 * Answers **403**, not 404: the caller is a member, so the family's existence is
 * not a secret from them — only this particular action is refused.
 */
export function requireFamilyRole(...allowed: readonly FamilyRole[]): RequestHandler {
  return (req, _res, next) => {
    const scope = getFamilyScope(req);
    if (!allowed.includes(scope.role)) {
      throw forbidden('Your role in this family does not allow that');
    }
    next();
  };
}

/** Reads the resolved membership, and fails loudly if the middleware did not run. */
export function getFamilyScope(req: Request): FamilyScope {
  if (!req.familyScope) {
    // A programming error rather than a client one: a handler asked for a scope
    // on a route that never resolved one.
    throw unauthorized('Family membership has not been resolved for this request');
  }
  return req.familyScope;
}
