import type { Response } from 'express';
import { cookieSecure, env } from '../config/env.js';
import { refreshTokenTtlMs } from './refreshToken.js';

/**
 * The refresh cookie, defined in exactly one place.
 *
 * Path is scoped to the auth routes so the browser does not attach the refresh
 * token to ordinary API calls. With SameSite=Lax a cross-site POST does not
 * carry it either, which is what makes a separate CSRF token unnecessary — see
 * `docs/phase-1a-auth.md` §8 for the condition under which that stops being true.
 */
export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const baseOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: env.COOKIE_SAMESITE,
  path: REFRESH_COOKIE_PATH,
} as const;

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, { ...baseOptions, maxAge: refreshTokenTtlMs });
}

/** Must repeat the same attributes, or the browser will not match the cookie. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions);
}

export function readRefreshCookie(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }
  const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
