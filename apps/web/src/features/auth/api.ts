import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  PublicUser,
  RegisterInput,
} from '@baby-tracker/shared';
import { ApiError, apiFetch, refreshAccessToken } from '../../services/apiClient.js';
import { clearAccessToken, setAccessToken } from '../../services/session.js';

/**
 * The auth endpoints, as thin functions with no React in them, so the flows can
 * be tested without a DOM.
 */
const post = <T>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const unusableResponse = (what: string): ApiError =>
  new ApiError(500, 'UNEXPECTED_RESPONSE', `The server returned an unusable ${what} response`);

const isUser = (value: unknown): value is PublicUser =>
  typeof value === 'object' && value !== null && typeof (value as PublicUser).id === 'string';

/**
 * Accepts a sign-in only when the response actually carries a token and a user.
 *
 * Without this, a malformed 200 would store `undefined` as the access token and
 * leave the app in a confidently broken "signed in" state — far worse than a
 * clean failure.
 */
function acceptAuthResponse(response: AuthResponse): PublicUser {
  const { accessToken, user } = response;
  if (typeof accessToken !== 'string' || accessToken.length === 0 || !isUser(user)) {
    throw unusableResponse('authentication');
  }
  setAccessToken(accessToken);
  return user;
}

export async function registerAccount(input: RegisterInput): Promise<PublicUser> {
  return acceptAuthResponse(await post<AuthResponse>('/auth/register', input));
}

export async function loginAccount(input: LoginInput): Promise<PublicUser> {
  return acceptAuthResponse(await post<AuthResponse>('/auth/login', input));
}

export async function fetchCurrentUser(): Promise<PublicUser> {
  const { user } = await apiFetch<MeResponse>('/auth/me');
  if (!isUser(user)) {
    throw unusableResponse('user');
  }
  return user;
}

/**
 * Restores a session after a page reload.
 *
 * A reload leaves no access token, so `/auth/me` alone would just answer 401
 * UNAUTHORIZED — which is not a refreshable condition. The refresh cookie is
 * the only thing that survives, so the exchange has to come first.
 *
 * Returns null when there is no session to restore, which is the ordinary case
 * for a visitor who has never signed in.
 */
export async function restoreSession(): Promise<PublicUser | null> {
  try {
    await refreshAccessToken();
    return await fetchCurrentUser();
  } catch {
    clearAccessToken();
    return null;
  }
}

/**
 * Ends the session server-side, then locally.
 *
 * The local state is cleared even when the request fails: a user who pressed
 * "sign out" must end up signed out of this browser regardless of what the
 * network did.
 */
export async function logoutAccount(): Promise<void> {
  try {
    await post<null>('/auth/logout');
  } finally {
    clearAccessToken();
  }
}
