import type { ApiErrorBody, RefreshResponse } from '@baby-tracker/shared';
import { clearAccessToken, getAccessToken, notifySessionEnded, setAccessToken } from './session.js';

/**
 * Thin typed wrapper over `fetch`, plus the two pieces of transport policy the
 * app needs: attach the access token, and recover from an expired one.
 *
 * No HTTP client dependency — the browser's fetch covers everything.
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
 * the `Authorization` header additive rather than destructive.
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

  // Centralised, so no individual call ever hand-writes an Authorization
  // header, and requests made while signed out simply carry none.
  const token = getAccessToken();
  if (token !== null && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

interface Outcome {
  response: Response;
  payload: unknown;
}

async function send(path: string, init: RequestInit): Promise<Outcome> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // After the spread, deliberately: both are ours to decide. `credentials`
    // must always be 'include' so the httpOnly refresh cookie is sent
    // (decision D6), and the headers are merged with the caller's rather than
    // replaced by them.
    credentials: 'include',
    headers: buildHeaders(init),
  });

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = isJson ? await response.json() : null;

  return { response, payload };
}

function toApiError({ response, payload }: Outcome): ApiError {
  if (isApiErrorBody(payload)) {
    return new ApiError(
      response.status,
      payload.error.code,
      payload.error.message,
      payload.error.details,
    );
  }
  return new ApiError(response.status, 'UNEXPECTED_ERROR', response.statusText);
}

const isExpiredAccessToken = ({ response, payload }: Outcome): boolean =>
  response.status === 401 && isApiErrorBody(payload) && payload.error.code === 'TOKEN_EXPIRED';

let inFlightRefresh: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  // Deliberately a raw fetch rather than `apiFetch`: refreshing must never be
  // able to trigger another refresh.
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    // The refresh cookie is gone, rotated away or revoked. There is no way back
    // to an authenticated state from here.
    clearAccessToken();
    notifySessionEnded();
    throw toApiError({ response, payload });
  }

  const token = (payload as Partial<RefreshResponse> | null)?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    // A 200 without a usable token is not a session; treat it like a failure
    // rather than storing `undefined` and looping on it.
    clearAccessToken();
    notifySessionEnded();
    throw new ApiError(
      response.status,
      'UNEXPECTED_RESPONSE',
      'The refresh response did not contain an access token',
    );
  }

  setAccessToken(token);
  return token;
}

/**
 * Exchanges the refresh cookie for a new access token, at most once at a time.
 *
 * The single in-flight promise is not an optimisation. The API revokes an
 * entire login when an already-rotated refresh token is presented again, so two
 * concurrent refreshes would log the user out. Every caller waits on the same
 * request.
 */
export function refreshAccessToken(): Promise<string> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const run = performRefresh();
  inFlightRefresh = run;
  run.then(
    () => {
      inFlightRefresh = null;
    },
    () => {
      inFlightRefresh = null;
    },
  );

  return run;
}

/** Test helper: forget any refresh that is in flight. */
export function resetRefreshState(): void {
  inFlightRefresh = null;
}

export async function apiFetch<TResponse>(
  path: string,
  init: RequestInit = {},
): Promise<TResponse> {
  let outcome = await send(path, init);

  if (isExpiredAccessToken(outcome)) {
    try {
      await refreshAccessToken();
    } catch {
      // Refreshing failed; the original expiry is the useful error.
      throw toApiError(outcome);
    }
    // Exactly one retry. The replayed request is never retried again, so an
    // endlessly expiring token cannot become an endless loop.
    outcome = await send(path, init);
  }

  if (!outcome.response.ok) {
    throw toApiError(outcome);
  }

  return outcome.payload as TResponse;
}
