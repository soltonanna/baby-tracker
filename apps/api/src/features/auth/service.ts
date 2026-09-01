import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import type { LoginInput, PublicUser, RegisterInput } from '@baby-tracker/shared';
import { RefreshToken, type RevokedReason } from '../../models/RefreshToken.js';
import { User, type UserDocument } from '../../models/User.js';
import { HttpError, unauthorized } from '../../lib/httpError.js';
import { accessTokenTtlSeconds, signAccessToken } from '../../lib/accessToken.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryFrom,
} from '../../lib/refreshToken.js';
import {
  hashPassword,
  needsRehash,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../lib/password.js';
import { logger } from '../../lib/logger.js';
import { toPublicUser } from './mappers.js';

const USER_AGENT_MAX_LENGTH = 512;

export interface RequestContext {
  userAgent?: string | undefined;
}

export interface IssuedSession {
  accessToken: string;
  /** The raw refresh token. Only the controller sees it, only to set the cookie. */
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult extends IssuedSession {
  user: PublicUser;
}

const emailTaken = (): HttpError =>
  new HttpError(409, 'EMAIL_TAKEN', 'That email address is already registered');

/** One message for both an unknown email and a wrong password: no enumeration. */
const invalidCredentials = (): HttpError =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

const refreshExpired = (): HttpError =>
  new HttpError(401, 'TOKEN_EXPIRED', 'Session has expired. Please sign in again.');

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

function trimUserAgent(userAgent: string | undefined): string | undefined {
  return userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : undefined;
}

/** Creates the first refresh token of a new login and its access token. */
async function startSession(user: UserDocument, context: RequestContext): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();

  await RefreshToken.create({
    userId: user._id,
    sessionId: randomUUID(),
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiryFrom(),
    userAgent: trimUserAgent(context.userAgent),
  });

  return {
    accessToken: await signAccessToken(user._id.toString()),
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
  };
}

/** Revokes every live token of one login. Used by logout and by reuse detection. */
async function revokeSession(
  userId: Types.ObjectId,
  sessionId: string,
  reason: RevokedReason,
): Promise<void> {
  await RefreshToken.updateMany(
    { userId, sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

export async function registerUser(
  input: RegisterInput,
  context: RequestContext,
): Promise<AuthResult> {
  // Cheap pre-check so a duplicate does not pay the cost of hashing…
  if (await User.exists({ email: input.email })) {
    throw emailTaken();
  }

  const passwordHash = await hashPassword(input.password);

  let user: UserDocument;
  try {
    user = await User.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      locale: input.locale,
      timezone: input.timezone,
    });
  } catch (error) {
    // …and the unique index catches the race the pre-check cannot.
    if (isDuplicateKeyError(error)) {
      throw emailTaken();
    }
    throw error;
  }

  return { user: toPublicUser(user), ...(await startSession(user, context)) };
}

export async function loginUser(input: LoginInput, context: RequestContext): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  if (!user) {
    // Do the same work as a real verification, so response time does not reveal
    // whether the address has an account.
    await verifyAgainstDummyHash(input.password);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw invalidCredentials();
  }

  // Transparently upgrade a hash written with weaker parameters.
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(input.password);
  }
  user.lastLoginAt = new Date();
  await user.save();

  return { user: toPublicUser(user), ...(await startSession(user, context)) };
}

/**
 * Exchanges a refresh token for a new pair, rotating it.
 *
 * The rotation is claimed with a single atomic update, so two concurrent
 * requests cannot both succeed. A token that is presented after it has already
 * been rotated is treated as reuse: the whole login is revoked. That is
 * deliberately strict — a client that fires two refreshes at once will be
 * logged out, so the web client must serialise refreshes through one in-flight
 * request.
 */
export async function refreshSession(
  presentedToken: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const tokenHash = hashRefreshToken(presentedToken);
  const now = new Date();

  const nextToken = generateRefreshToken();
  const nextHash = hashRefreshToken(nextToken);

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    {
      $set: {
        revokedAt: now,
        rotatedAt: now,
        revokedReason: 'rotated' satisfies RevokedReason,
        replacedByHash: nextHash,
      },
    },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    const existing = await RefreshToken.findOne({ tokenHash });

    if (!existing) {
      throw unauthorized('Invalid refresh token');
    }
    if (existing.revokedAt) {
      logger.warn(
        { userId: String(existing.userId), sessionId: existing.sessionId },
        'Refresh token reuse detected — revoking the whole session',
      );
      await revokeSession(existing.userId, existing.sessionId, 'reuse_detected');
      throw unauthorized('Refresh token has already been used');
    }
    throw refreshExpired();
  }

  const user = await User.findById(claimed.userId);
  if (!user) {
    await revokeSession(claimed.userId, claimed.sessionId, 'logout');
    throw unauthorized('Invalid refresh token');
  }

  await RefreshToken.create({
    userId: claimed.userId,
    sessionId: claimed.sessionId,
    tokenHash: nextHash,
    expiresAt: refreshTokenExpiryFrom(now),
    userAgent: trimUserAgent(context.userAgent),
  });

  return {
    accessToken: await signAccessToken(user._id.toString()),
    refreshToken: nextToken,
    expiresIn: accessTokenTtlSeconds,
  };
}

/**
 * Revokes the login the token belongs to. Always succeeds: logging out is
 * idempotent and must never reveal whether a token was real.
 */
export async function logoutSession(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) {
    return;
  }

  const stored = await RefreshToken.findOne({ tokenHash: hashRefreshToken(presentedToken) });
  if (!stored) {
    return;
  }

  await revokeSession(stored.userId, stored.sessionId, 'logout');
}

export async function getPublicUser(userId: string): Promise<PublicUser> {
  const user = await User.findById(userId);
  if (!user) {
    throw unauthorized('Account no longer exists');
  }
  return toPublicUser(user);
}
