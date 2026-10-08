import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../features/auth/useAuth';

export function AppShell() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  const signOut = () =>
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) });

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/notes" className="brand">
          NoteFlow
        </Link>
        <div className="shell-user">
          <span className="muted" title={user?.email}>
            {user?.name}
          </span>
          <button type="button" className="button" onClick={signOut} disabled={logout.isPending}>
            Sign out
          </button>
        </div>
      </header>
      {logout.isError && (
        <p role="alert" className="alert alert-error shell-alert">
          Could not sign out. Please try again.
        </p>
      )}
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
