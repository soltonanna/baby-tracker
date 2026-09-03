/**
 * The route-guard decision, as a pure function.
 *
 * Keeping it out of the components means the redirect rules can be tested
 * without a DOM, and both guards read from one description of the rules.
 */
export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

export type RouteAccess =
  { kind: 'loading' } | { kind: 'allow' } | { kind: 'redirect'; to: string };

export const LOGIN_PATH = '/login';
export const AFTER_LOGIN_PATH = '/';

/** Application pages: signed in only. */
export function protectedRouteAccess(status: AuthStatus): RouteAccess {
  if (status === 'restoring') {
    return { kind: 'loading' };
  }
  return status === 'authenticated' ? { kind: 'allow' } : { kind: 'redirect', to: LOGIN_PATH };
}

/** Sign-in and sign-up: signed out only, so an authenticated user is sent on. */
export function publicOnlyRouteAccess(status: AuthStatus): RouteAccess {
  if (status === 'restoring') {
    return { kind: 'loading' };
  }
  return status === 'authenticated'
    ? { kind: 'redirect', to: AFTER_LOGIN_PATH }
    : { kind: 'allow' };
}
