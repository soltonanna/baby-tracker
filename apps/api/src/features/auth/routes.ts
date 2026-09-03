import { Router } from 'express';
import { loginSchema, registerSchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loginLimiter, refreshLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import * as controller from './controller.js';

/**
 * Mounted at /api/v1/auth. Paths and middleware order only — no logic here.
 */
export const authRouter: Router = Router();

/**
 * Authentication state must never come from a cache.
 *
 * Express sets a weak ETag on every JSON response, and `GET /auth/me` returns
 * the same body each time, so its ETag is stable. A browser that cached it will
 * revalidate on the next load and can be answered `304 Not Modified` — a reply
 * with no body, which is useless when the question is "who am I". `no-store`
 * stops the browser storing the response at all, so it never revalidates, and
 * it keeps the user's identity out of the on-disk HTTP cache, which is the
 * right posture for these routes regardless.
 *
 * `no-store` stops the browser caching and therefore revalidating. Dropping the
 * conditional request headers closes the other half: Express's own freshness
 * check would answer a matching `If-None-Match` with a bodyless 304 no matter
 * what the response's Cache-Control says. These routes simply do not take part
 * in conditional requests — "who am I" is always answered in full.
 *
 * Scoped to the auth router on purpose: this is not a reason to disable caching
 * or ETags for the whole API.
 */
authRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  next();
});

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  controller.register,
);
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', refreshLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', authenticate, controller.me);
