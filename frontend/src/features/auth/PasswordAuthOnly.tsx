import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthConfig } from './useAuth';

/** Pages for custom email/password auth: when the server has it disabled, send the visitor to sign-in. */
export function PasswordAuthOnly({ children }: { children: ReactNode }) {
  const config = useAuthConfig();
  if (config.isPending) return null;
  return config.data?.passwordAuthEnabled ? children : <Navigate to="/login" replace />;
}
