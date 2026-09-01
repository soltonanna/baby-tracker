import type { Request, RequestHandler } from 'express';
import { verifyAccessToken } from '../lib/accessToken.js';
import { unauthorized } from '../lib/httpError.js';

/**
 * Establishes who is making the request, and nothing more.
 *
 * Identity comes only from a verified access token: no endpoint anywhere may
 * take a user id from a body, query or path. Authorization — what this user may
 * touch — is a separate concern that arrives with family membership in 1B.
 *
 * Deliberately performs no database read. That is the point of a stateless
 * access token, and it is what keeps every authenticated request cheap. The
 * price is that a token stays valid until it expires; fifteen minutes is the
 * mitigation.
 *
 * Throwing from an async handler is enough — Express 5 forwards the rejection
 * to the error middleware.
 */
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  const token = header ? BEARER_PATTERN.exec(header)?.[1]?.trim() : undefined;

  if (!token) {
    throw unauthorized('Authentication required');
  }

  const { userId } = await verifyAccessToken(token);
  req.auth = { userId };
  next();
};

/** Reads the authenticated user, and fails loudly if `authenticate` did not run. */
export function getAuth(req: Request): { userId: string } {
  if (!req.auth) {
    throw unauthorized('Authentication required');
  }
  return req.auth;
}
