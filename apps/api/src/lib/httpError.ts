/**
 * The only error type route and service code should throw deliberately.
 * The error middleware turns it into `{ error: { code, message, details } }`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required'): HttpError =>
  new HttpError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource'): HttpError =>
  new HttpError(403, 'FORBIDDEN', message);

/**
 * Also used deliberately instead of 403 when hiding the existence of another
 * family's resource (see the authorization model in ARCHITECTURE_PROPOSAL.md §4.3).
 */
export const notFound = (message = 'Not found'): HttpError =>
  new HttpError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown): HttpError =>
  new HttpError(409, 'CONFLICT', message, details);

export const unprocessable = (message: string, details?: unknown): HttpError =>
  new HttpError(422, 'VALIDATION_FAILED', message, details);
