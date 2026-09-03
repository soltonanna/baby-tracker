import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, refreshAccessToken, resetRefreshState } from './apiClient.js';
import { getAccessToken, onSessionEnded, resetSession, setAccessToken } from './session.js';

/** A JSON response, as the API would send it. */
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errorBody = (code: string, message = code, details?: unknown) => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

const expired = () => json(401, errorBody('TOKEN_EXPIRED', 'Access token has expired'));

let fetchMock: ReturnType<typeof vi.fn>;

const requestedPaths = (): string[] =>
  fetchMock.mock.calls.map((call) => String(call[0] as string));

const headersOfCall = (index: number): Headers =>
  new Headers((fetchMock.mock.calls[index]?.[1] as RequestInit).headers);

beforeEach(() => {
  resetSession();
  resetRefreshState();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authorization header', () => {
  it('is omitted while signed out', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));

    await apiFetch('/auth/me');

    expect(headersOfCall(0).has('Authorization')).toBe(false);
  });

  it('is attached from the in-memory token, alongside the defaults', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));

    await apiFetch('/auth/me', { method: 'POST', body: '{}' });

    const headers = headersOfCall(0);
    expect(headers.get('Authorization')).toBe('Bearer token-abc');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('sends the refresh cookie on every request', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));

    await apiFetch('/auth/me');

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
  });
});

describe('errors', () => {
  it('surfaces the API code, status and details', async () => {
    fetchMock.mockResolvedValueOnce(
      json(422, errorBody('VALIDATION_FAILED', 'nope', [{ path: 'email', message: 'bad' }])),
    );

    const error = await apiFetch('/auth/register', { method: 'POST', body: '{}' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).code).toBe('VALIDATION_FAILED');
    expect((error as ApiError).details).toEqual([{ path: 'email', message: 'bad' }]);
  });

  it('names a 304 rather than reporting a bodyless "unexpected error"', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const error = await apiFetch('/auth/me').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_MODIFIED');
    expect((error as ApiError).status).toBe(304);
    // Never retried: a conditional response cannot become a body by asking again.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for a 401 that is not an expiry', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(json(401, errorBody('INVALID_CREDENTIALS')));

    await expect(apiFetch('/auth/login', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(requestedPaths()).toEqual(['/api/v1/auth/login']);
  });
});

describe('refresh on an expired access token', () => {
  it('refreshes once, then replays the original request with the new token', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(200, { accessToken: 'fresh', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { user: { id: 'u1' } }));

    await expect(apiFetch<{ user: { id: string } }>('/auth/me')).resolves.toEqual({
      user: { id: 'u1' },
    });

    expect(requestedPaths()).toEqual([
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
    ]);
    expect(headersOfCall(2).get('Authorization')).toBe('Bearer fresh');
    expect(getAccessToken()).toBe('fresh');
  });

  it('retries at most once, so a token that keeps expiring cannot loop', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(200, { accessToken: 'fresh', expiresIn: 900 }))
      .mockResolvedValueOnce(expired());

    await expect(apiFetch('/auth/me')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares one refresh between concurrent expired requests', async () => {
    setAccessToken('stale');

    let releaseRefresh: (() => void) | undefined;
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    fetchMock.mockImplementation(async (input: string) => {
      if (input.endsWith('/auth/refresh')) {
        // Stay in flight until both callers have had a chance to ask.
        await refreshHeld;
        return json(200, { accessToken: 'fresh', expiresIn: 900 });
      }
      return getAccessToken() === 'fresh' ? json(200, { ok: true }) : expired();
    });

    const both = Promise.all([apiFetch('/a'), apiFetch('/b')]);
    await Promise.resolve();
    releaseRefresh?.();
    await both;

    const refreshCalls = requestedPaths().filter((path) => path.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('ends the session when the refresh fails, and reports the original expiry', async () => {
    setAccessToken('stale');
    const ended = vi.fn();
    onSessionEnded(ended);

    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(401, errorBody('UNAUTHORIZED', 'Invalid refresh token')));

    await expect(apiFetch('/auth/me')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });

    expect(getAccessToken()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('refreshAccessToken', () => {
  it('stores the new token and never carries an Authorization header', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'fresh', expiresIn: 900 }));

    await expect(refreshAccessToken()).resolves.toBe('fresh');

    expect(getAccessToken()).toBe('fresh');
    expect(headersOfCall(0).has('Authorization')).toBe(false);
  });

  it('treats a 200 without a token as a failed refresh', async () => {
    setAccessToken('stale');
    const ended = vi.fn();
    onSessionEnded(ended);
    fetchMock.mockResolvedValueOnce(json(200, { expiresIn: 900 }));

    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    expect(getAccessToken()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('starts a new request once the previous one has settled', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { accessToken: 'one', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { accessToken: 'two', expiresIn: 900 }));

    await expect(refreshAccessToken()).resolves.toBe('one');
    await expect(refreshAccessToken()).resolves.toBe('two');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
