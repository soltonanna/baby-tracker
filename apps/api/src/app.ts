import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiRouter } from './routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';

export const API_PREFIX = '/api/v1';

/** The one route allowed a body above the app-wide limit; see `familyData/routes.ts`. */
const FAMILY_DATA_IMPORT_PATH = /^\/api\/v1\/families\/[^/]+\/data\/import\/?$/;

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }
  app.use(helmet());
  // `credentials: true` is required by decision D6 — the refresh token travels
  // in an httpOnly cookie, so the browser must be allowed to send it.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  // 1 MB for every request except a family data import, whose route parses its
  // own, larger body — after authentication and the owner check, so nobody
  // can make the server parse megabytes without being allowed to import.
  const jsonBody = express.json({ limit: '1mb' });
  app.use((req, res, next) => {
    if (FAMILY_DATA_IMPORT_PATH.test(req.path)) {
      next();
      return;
    }
    jsonBody(req, res, next);
  });
  // Unsigned on purpose: the refresh token is already 256 bits of randomness
  // checked against a server-side hash, so a signature adds a second secret
  // and no security (decision D19).
  app.use(cookieParser());

  app.use(API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
