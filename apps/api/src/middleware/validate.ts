import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/**
 * Validates the request against Zod schemas from `@baby-tracker/shared`.
 *
 * Parsed `body` replaces `req.body`. Express 5 exposes `req.query` and
 * `req.params` through getters, so their parsed forms are placed on
 * `res.locals` instead; read them with `validatedQuery` / `validatedParams`.
 */
export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        res.locals.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        res.locals.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const validatedQuery = <T>(res: { locals: Record<string, unknown> }): T =>
  res.locals.query as T;

export const validatedParams = <T>(res: { locals: Record<string, unknown> }): T =>
  res.locals.params as T;
