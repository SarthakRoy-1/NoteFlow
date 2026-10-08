import { Navigate, useSearchParams } from 'react-router-dom';
import { loginErrorMessage } from './loginErrors';
import { useMe } from './useAuth';

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function LoginPage() {
  const [params] = useSearchParams();
  const me = useMe();
  const error = loginErrorMessage(params.get('error'));

  if (me.data) return <Navigate to="/" replace />;

  // Plain link on purpose: sign-in is a full-page redirect to Google, not an XHR call.
  const signInHref = `/api/auth/google?tz=${encodeURIComponent(browserTimezone())}`;

  return (
    <main className="page">
      <h1>NoteFlow</h1>
      <p className="muted">
        Sign in to capture notes and let AI turn them into todos and reminders.
      </p>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      <a className="button button-primary" href={signInHref}>
        Sign in with Google
      </a>
    </main>
  );
}
