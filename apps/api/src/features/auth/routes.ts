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
