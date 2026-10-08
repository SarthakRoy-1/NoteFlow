import { useNavigate } from 'react-router-dom';
import { useLogout, useMe } from './useAuth';

export function HomePage() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  const signOut = () =>
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) });

  return (
    <main className="page">
      <h1>NoteFlow</h1>
      <p className="muted">
        Signed in as {user?.name} ({user?.email}) · timezone {user?.timezone}
      </p>
      {logout.isError && (
        <p role="alert" className="alert alert-error">
          Could not sign out. Please try again.
        </p>
      )}
      <button type="button" className="button" onClick={signOut} disabled={logout.isPending}>
        Sign out
      </button>
    </main>
  );
}
