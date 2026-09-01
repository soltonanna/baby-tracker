import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Refresh tokens (decision D6).
 *
 * Deliberately opaque rather than a JWT: a refresh token must be revocable, so
 * it is looked up server-side anyway. Being opaque means a leaked token reveals
 * nothing, and it cannot be forged even if the JWT secret leaks.
 *
 * SHA-256 — not a slow key-derivation function — is the right hash here: the
 * token is already 256 bits of cryptographic randomness, so there is no
 * dictionary to attack and nothing for a work factor to defend against.
 */
const TOKEN_BYTES = 32;

export const refreshTokenTtlMs: number = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export function generateRefreshToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + refreshTokenTtlMs);
}
