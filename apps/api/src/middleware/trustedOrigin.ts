import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';

/**
 * CSRF guard for the cookie-bearing auth routes (docs/phase-1a-auth.md §8,
 * rule 12).
 *
 * When the web app and the API are on different sites the refresh cookie must
 * be `SameSite=None`, so the browser attaches it to a request started by any
 * site. Browsers always send `Origin` on a cross-origin POST, so rejecting a
 * POST whose `Origin` is not the web app's closes that hole. `Sec-Fetch-Site`
 * covers the rare browser that omits `Origin`.
 *
 * A request with neither header is not from a browser page, so it cannot be a
 * forged cross-site request and is allowed (curl, tests, health checks).
 * Applied in every environment, not only when SameSite=None — it costs nothing
 * and keeps development and production behaving the same.
 */
export function createTrustedOriginGuard(allowedOrigin: string): RequestHandler {
  const forbidden = (): HttpError =>
    new HttpError(403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed');

  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin !== undefined) {
      next(origin === allowedOrigin ? undefined : forbidden());
      return;
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
      next(forbidden());
      return;
    }
    next();
  };
}

export const requireTrustedOrigin: RequestHandler = createTrustedOriginGuard(env.CORS_ORIGIN);
