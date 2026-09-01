import type { Locale, UnitPreferences } from '../constants.js';
import type { Id, IsoDateTime } from './common.js';

/**
 * The only shape of a user that ever crosses the wire.
 * `passwordHash` is absent by construction, not by omission.
 */
export interface PublicUser {
  id: Id;
  email: string;
  displayName: string;
  locale: Locale;
  timezone: string;
  units: UnitPreferences;
  createdAt: IsoDateTime;
  lastLoginAt?: IsoDateTime;
}

/** Returned by POST /auth/register and POST /auth/login. */
export interface AuthResponse {
  user: PublicUser;
  /** Short-lived JWT. Keep it in memory only — never in localStorage (decision D6). */
  accessToken: string;
  /** Seconds until `accessToken` expires, so the client can refresh ahead of time. */
  expiresIn: number;
}

/** Returned by POST /auth/refresh. The refresh token itself stays in the cookie. */
export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/** Returned by GET /auth/me. Grows with families and babies in Phases 1B and 1C. */
export interface MeResponse {
  user: PublicUser;
}
