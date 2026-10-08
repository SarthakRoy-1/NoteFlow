import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from './useAuth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <p className="page muted">Loading…</p>;
  if (me.isError) {
    return (
      <main className="page">
        <p role="alert" className="alert alert-error">
          We could not load your account. Please refresh the page and try again.
        </p>
      </main>
    );
  }
  if (!me.data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
