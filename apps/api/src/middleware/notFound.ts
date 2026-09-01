import type { RequestHandler } from 'express';
import { notFound } from '../lib/httpError.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
};
