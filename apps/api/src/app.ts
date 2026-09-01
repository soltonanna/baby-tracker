import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiRouter } from './routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';

export const API_PREFIX = '/api/v1';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  // `credentials: true` is required by decision D6 — the refresh token travels
  // in an httpOnly cookie, so the browser must be allowed to send it.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  // Unsigned on purpose: the refresh token is already 256 bits of randomness
  // checked against a server-side hash, so a signature adds a second secret
  // and no security (decision D19).
  app.use(cookieParser());

  app.use(API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
