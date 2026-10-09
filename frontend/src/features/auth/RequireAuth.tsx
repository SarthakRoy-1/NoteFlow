import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { ME_KEY, useMe } from './useAuth';

// Only the "no valid session" answer ends the session. Other 401s (e.g. a wrong password typed into
// a re-authentication form) are ordinary errors the page shows itself.
const isExpired = (err: unknown) =>
  err instanceof ApiError && err.status === 401 && err.code === 'UNAUTHENTICATED';

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);

  // A 401 from any request while signed in means the session ended (expired or signed out
  // elsewhere): drop the cached private data and send the user back to sign-in with a reason.
  useEffect(() => {
    const onExpired = () => {
      setExpired(true);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      queryClient.setQueryData(ME_KEY, null);
    };
    const stopQueries = queryClient.getQueryCache().subscribe((e) => {
      if (
        e.type === 'updated' &&
        e.action.type === 'error' &&
        isExpired(e.action.error) &&
        e.query.queryKey[0] !== ME_KEY[0]
      ) {
        onExpired();
      }
    });
    const stopMutations = queryClient.getMutationCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error' && isExpired(e.action.error)) {
        onExpired();
      }
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient]);

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
  if (!me.data)
    return <Navigate to={expired ? '/login?error=session_expired' : '/login'} replace />;
  return <>{children}</>;
}
