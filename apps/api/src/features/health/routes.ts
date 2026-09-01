import { Router } from 'express';
import { databaseStatus } from '../../db/connect.js';

export const healthRouter: Router = Router();

/**
 * Liveness probe. Reports the database separately, so the API can start and be
 * inspected even when MongoDB is not running yet.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    database: databaseStatus(),
    timestamp: new Date().toISOString(),
  });
});
