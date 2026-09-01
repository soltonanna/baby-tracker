import { SignJWT, jwtVerify, errors } from 'jose';
import { env } from '../config/env.js';
import { HttpError, unauthorized } from './httpError.js';

/**
 * Access tokens (decision D6 and D18).
 *
 * Short-lived, stateless, and verified with an explicit algorithm allowlist so
 * that `alg: none` and algorithm-confusion attacks cannot get past us.
 *
 * The payload carries `tokenType: 'access'`. It is deliberately not called
 * `typ`, which is already a registered JWT *header* parameter; keeping the
 * names apart avoids a confusing collision. The check exists so that a refresh
 * credential can never be replayed as an access credential.
 */
const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TYPE = 'access';
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

const secret = new TextEncoder().encode(env.JWT_SECRET);

export const accessTokenTtlSeconds: number = env.ACCESS_TOKEN_TTL_SECONDS;

export interface AccessTokenClaims {
  userId: string;
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ tokenType: ACCESS_TOKEN_TYPE })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${accessTokenTtlSeconds}s`)
    .sign(secret);
}

export const tokenExpired = (): HttpError =>
  new HttpError(401, 'TOKEN_EXPIRED', 'Access token has expired');

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM] }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw tokenExpired();
    }
    throw unauthorized('Invalid access token');
  }

  if (payload.tokenType !== ACCESS_TOKEN_TYPE) {
    throw unauthorized('Invalid access token');
  }
  if (typeof payload.sub !== 'string' || !OBJECT_ID_PATTERN.test(payload.sub)) {
    throw unauthorized('Invalid access token');
  }

  return { userId: payload.sub };
}
