import { Router } from 'express';
import { loginSchema, registerSchema } from '@baby-tracker/shared';
import { validate } from '../../middleware/validate.js';
import { loginLimiter, refreshLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import * as controller from './controller.js';

/**
 * Mounted at /api/v1/auth. Paths and middleware order only — no logic here.
 * GET /me is added with the authenticate middleware in 1A.3.
 */
export const authRouter: Router = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  controller.register,
);
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', refreshLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
