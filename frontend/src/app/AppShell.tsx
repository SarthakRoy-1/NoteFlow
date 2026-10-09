import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../features/auth/useAuth';
import { DueAlerts, useDueCount } from '../features/reminders/DueAlerts';

export function AppShell() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const dueCount = useDueCount();

  const signOut = () =>
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) });

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/notes" className="brand">
          NoteFlow
        </Link>
        <nav className="shell-nav" aria-label="Main">
          <NavLink to="/notes">Notes</NavLink>
          <NavLink to="/todos">Todos</NavLink>
          <NavLink to="/reminders">
            Reminders
            {dueCount > 0 && (
              <span className="nav-badge" aria-label={`${dueCount} due`}>
                {dueCount}
              </span>
            )}
          </NavLink>
          <NavLink to="/ask">Ask AI</NavLink>
        </nav>
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
      <DueAlerts />
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
