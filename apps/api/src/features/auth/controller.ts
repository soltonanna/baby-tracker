import type { RequestHandler } from 'express';
import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  RefreshResponse,
  RegisterInput,
} from '@baby-tracker/shared';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../../lib/cookies.js';
import { unauthorized } from '../../lib/httpError.js';
import { getAuth } from '../../middleware/authenticate.js';
import * as authService from './service.js';

/**
 * Controllers translate HTTP to the service and back. They hold no rules: no
 * hashing, no database, no decisions about validity.
 */
const contextFrom = (userAgent: string | undefined): authService.RequestContext => ({ userAgent });

export const register: RequestHandler = async (req, res) => {
  const { user, accessToken, refreshToken, expiresIn } = await authService.registerUser(
    req.body as RegisterInput,
    contextFrom(req.get('user-agent')),
  );

  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user, accessToken, expiresIn } satisfies AuthResponse);
};

export const login: RequestHandler = async (req, res) => {
  const { user, accessToken, refreshToken, expiresIn } = await authService.loginUser(
    req.body as LoginInput,
    contextFrom(req.get('user-agent')),
  );

  setRefreshCookie(res, refreshToken);
  res.status(200).json({ user, accessToken, expiresIn } satisfies AuthResponse);
};

export const refresh: RequestHandler = async (req, res) => {
  const presented = readRefreshCookie(req.cookies);
  if (!presented) {
    throw unauthorized('No refresh token supplied');
  }

  let issued;
  try {
    issued = await authService.refreshSession(presented, contextFrom(req.get('user-agent')));
  } catch (error) {
    // The cookie is useless now; do not leave the browser retrying with it.
    clearRefreshCookie(res);
    throw error;
  }

  setRefreshCookie(res, issued.refreshToken);
  res.status(200).json({
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
  } satisfies RefreshResponse);
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logoutSession(readRefreshCookie(req.cookies));
  clearRefreshCookie(res);
  res.status(204).send();
};

export const me: RequestHandler = async (req, res) => {
  const { userId } = getAuth(req);
  const user = await authService.getPublicUser(userId);

  res.status(200).json({ user } satisfies MeResponse);
};
