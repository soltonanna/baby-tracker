import { Router } from 'express';
import { healthRouter } from './features/health/routes.js';
import { authRouter } from './features/auth/routes.js';
import { familyRouter } from './features/families/routes.js';

/** Everything under /api/v1. Feature routers are mounted here as they land. */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/families', familyRouter);
