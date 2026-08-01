import { createContext, useContext } from 'react';
import type { AuthUser } from '../../../shared/api/authClient';

export interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthGate.');
  return value;
}
