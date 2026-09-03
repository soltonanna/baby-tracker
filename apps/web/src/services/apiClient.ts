import type { ApiErrorBody } from '@baby-tracker/shared';

/**
 * Thin typed wrapper over `fetch`.
 *
 * No HTTP client dependency: the browser's fetch covers everything, and the
 * access-token refresh retry of decision D6 will be added here in Phase 1.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}

/**
 * Builds the outgoing headers.
 *
 * Uses `Headers` rather than a plain object so that all three shapes
 * `RequestInit.headers` accepts (a `Headers`, an entry array, a record) merge
 * correctly, and so a caller can deliberately override a default. Defaults are
 * only applied when the caller has not set that header — which is what makes
 * an `Authorization` header additive rather than destructive.
 */
function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // Only for a string body. A FormData or Blob body must keep the browser's
  // own Content-Type, which carries the multipart boundary.
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

export async function apiFetch<TResponse>(
  path: string,
  init: RequestInit = {},
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // After the spread, deliberately: both are ours to decide. `credentials`
    // must always be 'include' so the httpOnly refresh cookie is sent
    // (decision D6), and the headers are merged from the caller's rather than
    // replaced by them.
    credentials: 'include',
    headers: buildHeaders(init),
  });

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError(
        response.status,
        payload.error.code,
        payload.error.message,
        payload.error.details,
      );
    }
    throw new ApiError(response.status, 'UNEXPECTED_ERROR', response.statusText);
  }

  return payload as TResponse;
}
