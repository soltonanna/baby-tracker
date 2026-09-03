import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, resetSession, setAccessToken } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import {
  fetchCurrentUser,
  loginAccount,
  logoutAccount,
  registerAccount,
  restoreSession,
} from './api.js';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const noContent = (): Response => new Response(null, { status: 204 });

const errorBody = (code: string) => ({ error: { code, message: code } });

const USER = { id: 'u1', email: 'anahit@example.com', displayName: 'Anahit' };

let fetchMock: ReturnType<typeof vi.fn>;
const requestedPaths = (): string[] => fetchMock.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  resetSession();
  resetRefreshState();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerAccount / loginAccount', () => {
  it('keeps the access token in memory and returns the user', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { user: USER, accessToken: 'a1', expiresIn: 900 }));

    await expect(registerAccount({} as never)).resolves.toEqual(USER);
    expect(getAccessToken()).toBe('a1');
  });

  it('signs in and stores the token', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER, accessToken: 'a2', expiresIn: 900 }));

    await expect(loginAccount({} as never)).resolves.toEqual(USER);
    expect(getAccessToken()).toBe('a2');
  });

  it('leaves no token behind when the credentials are rejected', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody('INVALID_CREDENTIALS')));

    await expect(loginAccount({} as never)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(getAccessToken()).toBeNull();
  });

  it('rejects an unusable success body rather than pretending to be signed in', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { nonsense: true }));

    await expect(loginAccount({} as never)).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
    expect(getAccessToken()).toBeNull();
  });
});

describe('fetchCurrentUser', () => {
  it('rejects a /auth/me body without a usable user', async () => {
    setAccessToken('a1');
    fetchMock.mockResolvedValueOnce(json(200, { user: null }));

    await expect(fetchCurrentUser()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it('reads the user out of the /auth/me envelope', async () => {
    setAccessToken('a1');
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }));

    await expect(fetchCurrentUser()).resolves.toEqual(USER);
    expect(requestedPaths()).toEqual(['/api/v1/auth/me']);
  });
});

describe('restoreSession', () => {
  it('exchanges the refresh cookie first, then loads the user', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { accessToken: 'fresh', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { user: USER }));

    await expect(restoreSession()).resolves.toEqual(USER);

    // Refresh before /auth/me: after a reload there is no access token, and
    // /auth/me would answer UNAUTHORIZED, which is not refreshable.
    expect(requestedPaths()).toEqual(['/api/v1/auth/refresh', '/api/v1/auth/me']);
    expect(getAccessToken()).toBe('fresh');
  });

  it('returns null and stays signed out when there is no valid cookie', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody('UNAUTHORIZED')));

    await expect(restoreSession()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(requestedPaths()).toEqual(['/api/v1/auth/refresh']);
  });
});

describe('logoutAccount', () => {
  it('calls the API and clears the token', async () => {
    setAccessToken('a1');
    fetchMock.mockResolvedValueOnce(noContent());

    await logoutAccount();

    expect(requestedPaths()).toEqual(['/api/v1/auth/logout']);
    expect(getAccessToken()).toBeNull();
  });

  it('still clears the token when the request fails', async () => {
    setAccessToken('a1');
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(logoutAccount()).rejects.toThrow('network down');
    expect(getAccessToken()).toBeNull();
  });
});
