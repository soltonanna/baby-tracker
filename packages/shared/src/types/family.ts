import type { FamilyRole } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

/** A family, as it crosses the wire. */
export interface Family {
  id: Id;
  name: string;
  /** The user who created it. Not an authorization field — membership decides access. */
  createdBy: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * A family together with the caller's own role in it.
 *
 * Every family endpoint returns this shape: a family is only ever visible to
 * someone who is a member, so the role is always known and always relevant.
 */
export interface FamilyWithRole extends Family {
  role: FamilyRole;
}

/** Returned by POST /families and GET /families/:familyId. */
export interface FamilyResponse {
  family: FamilyWithRole;
}

/** Returned by GET /families. */
export interface FamilyListResponse {
  families: FamilyWithRole[];
}
