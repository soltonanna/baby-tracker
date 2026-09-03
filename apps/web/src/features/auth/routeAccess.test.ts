import { describe, expect, it } from 'vitest';
import { protectedRouteAccess, publicOnlyRouteAccess } from './routeAccess.js';

describe('protected routes', () => {
  it('waits while the session is still being restored', () => {
    expect(protectedRouteAccess('restoring')).toEqual({ kind: 'loading' });
  });

  it('sends a signed-out visitor to the login page', () => {
    expect(protectedRouteAccess('anonymous')).toEqual({ kind: 'redirect', to: '/login' });
  });

  it('lets a signed-in user through', () => {
    expect(protectedRouteAccess('authenticated')).toEqual({ kind: 'allow' });
  });
});

describe('public-only routes', () => {
  it('waits while the session is still being restored', () => {
    expect(publicOnlyRouteAccess('restoring')).toEqual({ kind: 'loading' });
  });

  it('lets a signed-out visitor see sign-in and sign-up', () => {
    expect(publicOnlyRouteAccess('anonymous')).toEqual({ kind: 'allow' });
  });

  it('sends a signed-in user into the application', () => {
    expect(publicOnlyRouteAccess('authenticated')).toEqual({ kind: 'redirect', to: '/' });
  });
});
