import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@baby-tracker/shared';
import { HttpError } from '../lib/httpError.js';
import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';

interface NormalisedError {
  status: number;
  body: ApiErrorBody;
}

function normalise(error: unknown): NormalisedError {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request did not pass validation',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    };
  }

  if (error instanceof mongoose.Error.CastError) {
    return {
      status: 400,
      body: { error: { code: 'INVALID_ID', message: `Invalid value for "${error.path}"` } },
    };
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request did not pass validation',
          details: Object.values(error.errors).map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      },
    };
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  ) {
    return {
      status: 409,
      body: { error: { code: 'DUPLICATE', message: 'That record already exists' } },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        // Never leak an internal message to a client in production.
        message: isProduction
          ? 'Something went wrong'
          : error instanceof Error
            ? error.message
            : 'Unknown error',
      },
    },
  };
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { status, body } = normalise(error);

  if (status >= 500) {
    logger.error({ err: error, method: req.method, url: req.originalUrl }, 'Unhandled error');
  } else {
    logger.debug(
      { method: req.method, url: req.originalUrl, status, code: body.error.code },
      'Request failed',
    );
  }

  res.status(status).json(body);
};
