import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { GoogleG, Mark } from '../../components/icons';
import { EmailAuthForm } from './EmailAuthForm';
import type { AuthMode } from './emailAuth';
import { loginErrorMessage } from './loginErrors';
import { useAuthConfig, useMe } from './useAuth';

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
  const config = useAuthConfig();
  const [mode, setMode] = useState<AuthMode>('signin');
  const error = loginErrorMessage(params.get('error'));

  if (me.data) return <Navigate to="/" replace />;

  // Plain link on purpose: sign-in is a full-page redirect to Google, not an XHR call.
  const signInHref = `/api/auth/google?tz=${encodeURIComponent(browserTimezone())}`;

  return (
    <main className="login">
      <div className="login-copy">
        <h1 className="login-brand">
          <Mark size={26} />
          <span>NoteFlow</span>
        </h1>
        <p className="login-lede">
          Write notes the way you think. AI finds the todos and reminders inside them, and answers
          questions from your own notes.
        </p>
        <p className="login-steps">Capture, understand, organize, act.</p>
        {error && (
          <p role="alert" className="alert alert-error">
            {error}
          </p>
        )}
        <div className="auth-panel">
          <div
            className="segmented auth-switch"
            role="radiogroup"
            aria-label="Sign in or create an account"
          >
            {(
              [
                ['signin', 'Sign in'],
                ['register', 'Create account'],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="auth-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <a className="google-button" href={signInHref}>
            <GoogleG />
            {mode === 'register' ? 'Sign up with Google' : 'Sign in with Google'}
          </a>

          <p className="auth-or">
            <span>or with email</span>
          </p>

          <EmailAuthForm key={mode} mode={mode} emailEnabled={config.data?.emailEnabled} />
        </div>
      </div>

      {/* A worked example of the mechanism, not account data. Hidden from assistive tech: the copy beside it says the same. */}
      <figure className="login-specimen" aria-hidden="true">
        <div className="specimen-note">
          <p className="specimen-title">Team sync notes</p>
          <p className="specimen-body">
            Went well. <mark>Remind Priya to share the Q4 roadmap by Friday 5pm.</mark> Also finish
            the <mark>budget draft tomorrow</mark>.
          </p>
        </div>
        <ul className="specimen-found">
          <li>
            <span>Reminder</span> Share the Q4 roadmap <em>Fri, 5:00 pm</em>
          </li>
          <li>
            <span>Todo</span> Finish the budget draft <em>Tomorrow</em>
          </li>
        </ul>
        <figcaption>Example: what NoteFlow finds in a note.</figcaption>
      </figure>
    </main>
  );
}
