import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { GoogleG, Mark } from '../../components/icons';
import { EmailAuthForm } from './EmailAuthForm';
import type { AuthMode } from './emailAuth';
import { LegalLinks } from '../legal/LegalLinks';
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
  const [remember, setRemember] = useState(false);
  const passwordAuth = config.data?.passwordAuthEnabled === true;
  // Wait for the config so the message never flashes the wrong wording.
  const error = config.isPending ? null : loginErrorMessage(params.get('error'), passwordAuth);

  if (me.data) return <Navigate to="/" replace />;

  // Plain link on purpose: sign-in is a full-page redirect to Google, not an XHR call.
  const signInHref = `/api/auth/google?tz=${encodeURIComponent(browserTimezone())}${remember ? '&remember=1' : ''}`;

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
          {passwordAuth && (
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
          )}

          <a className="google-button" href={signInHref}>
            <GoogleG />
            {mode === 'register' ? 'Sign up with Google' : 'Sign in with Google'}
          </a>
          <label className="remember-me">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember me on this device</span>
          </label>
          <p className="muted remember-hint">
            {remember
              ? 'You will stay signed in here for a while, even after closing the browser.'
              : 'Otherwise you are signed out when you close the browser.'}
          </p>

          {passwordAuth && (
            <>
              <p className="auth-or">
                <span>or with email</span>
              </p>

              <EmailAuthForm key={mode} mode={mode} emailEnabled={config.data?.emailEnabled} />
            </>
          )}
        </div>
        <p className="login-legal muted">
          By signing in you agree to the <Link to="/terms">Terms of Service</Link> and acknowledge
          the <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <LegalLinks />
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
