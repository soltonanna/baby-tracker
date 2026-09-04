import type { FamilyRole } from '@baby-tracker/shared';

/**
 * `req.auth` is set by the `authenticate` middleware and by nothing else.
 * `req.familyScope` is set by `requireFamilyMembership` and by nothing else.
 *
 * Both are optional here so that routes which do not use them type-check;
 * handlers read them through `getAuth(req)` / `getFamilyScope(req)`, which
 * throw if the middleware did not run.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
      };
      familyScope?: {
        familyId: string;
        userId: string;
        role: FamilyRole;
        membershipId: string;
      };
    }
  }
}

export {};
