import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput, PublicUser, RegisterInput } from '@baby-tracker/shared';
import { onSessionEnded } from '../../services/session.js';
import { AuthContext, type AuthContextValue } from './AuthContext.js';
import type { AuthStatus } from './routeAccess.js';
import { loginAccount, logoutAccount, registerAccount, restoreSession } from './api.js';

/**
 * Owns the signed-in state. The access token itself lives in
 * `services/session`, in memory only; this holds the user and the status the
 * router guards read.
 *
 * Starts in `restoring` so the guards can show a loader rather than briefly
 * redirecting a signed-in user to the login page on every reload.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<PublicUser | null>(null);
  const queryClient = useQueryClient();

  const forgetUser = useCallback(() => {
    setUser(null);
    setStatus('anonymous');
    // Nothing cached for the previous session may survive into the next one.
    queryClient.clear();
  }, [queryClient]);

  const acceptUser = useCallback((nextUser: PublicUser) => {
    setUser(nextUser);
    setStatus('authenticated');
  }, []);

  // A refresh that fails anywhere in the app ends the session; react once, here,
  // instead of at every call site.
  useEffect(() => onSessionEnded(forgetUser), [forgetUser]);

  const restoreStarted = useRef(false);
  useEffect(() => {
    // React 18+ StrictMode runs effects twice in development. Restoring twice
    // would fire two refreshes, and a second refresh with an already-rotated
    // token is exactly what the API treats as reuse.
    if (restoreStarted.current) {
      return;
    }
    restoreStarted.current = true;

    let cancelled = false;
    void restoreSession().then((restored) => {
      if (cancelled) {
        return;
      }
      if (restored) {
        setUser(restored);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(
    async (input: RegisterInput) => {
      acceptUser(await registerAccount(input));
    },
    [acceptUser],
  );

  const login = useCallback(
    async (input: LoginInput) => {
      acceptUser(await loginAccount(input));
    },
    [acceptUser],
  );

  const logout = useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
      // Even a failed request must leave this browser signed out.
      forgetUser();
    }
  }, [forgetUser]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, register, login, logout }),
    [status, user, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
