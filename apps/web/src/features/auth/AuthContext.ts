import { createContext, useContext } from 'react';
import type { LoginInput, PublicUser, RegisterInput } from '@baby-tracker/shared';
import type { AuthStatus } from './routeAccess.js';

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  register: (input: RegisterInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
