import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AskIcon,
  Mark,
  NotesIcon,
  RemindersIcon,
  SettingsIcon,
  TodosIcon,
} from '../components/icons';
import { useLogout, useMe } from '../features/auth/useAuth';
import { DueAlerts, useDueCount } from '../features/reminders/DueAlerts';

export function AppShell() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const dueCount = useDueCount();
  const { pathname } = useLocation();
  // Page changes re-key <main> so each screen arrives with one short, quiet entrance.
  const section = pathname.split('/')[1] ?? '';

  const signOut = () =>
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) });

  return (
    <div className="shell">
      <header className="shell-side">
        <Link to="/notes" className="brand">
          <Mark />
          <span>NoteFlow</span>
        </Link>
        <nav className="shell-nav" aria-label="Main">
          <NavLink to="/notes">
            <NotesIcon />
            <span>Notes</span>
          </NavLink>
          <NavLink to="/todos">
            <TodosIcon />
            <span>Todos</span>
          </NavLink>
          <NavLink to="/reminders">
            <RemindersIcon />
            <span>Reminders</span>
            {dueCount > 0 && (
              <span className="nav-badge" aria-label={`${dueCount} due`}>
                {dueCount}
              </span>
            )}
          </NavLink>
          <NavLink to="/ask">
            <AskIcon />
            <span>Ask AI</span>
          </NavLink>
        </nav>
        <div className="shell-user">
          <div className="shell-account-row">
            <NavLink to="/settings" className="shell-account" title={user?.email}>
              {user?.name}
            </NavLink>
            <NavLink to="/settings" className="shell-gear" aria-label="Settings" title="Settings">
              <SettingsIcon />
            </NavLink>
          </div>
          <button
            type="button"
            className="link-button"
            onClick={signOut}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="shell-content">
        {logout.isError && (
          <p role="alert" className="alert alert-error shell-alert">
            Could not sign out. Please try again.
          </p>
        )}
        <DueAlerts />
        <main className="shell-main" key={section}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
