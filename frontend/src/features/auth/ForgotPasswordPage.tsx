import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthPage } from './AuthPage';
import { forgotPassword } from './authApi';
import { validateAuthFields } from './emailAuth';
import { useAuthConfig } from './useAuth';

export function ForgotPasswordPage() {
  const config = useAuthConfig();
  const request = useMutation({ mutationFn: forgotPassword });
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();

  if (config.isPending) {
    return (
      <AuthPage title="Reset your password">
        <p className="auth-lede" role="status">
          Loading…
        </p>
      </AuthPage>
    );
  }

  // Never show a recovery form that cannot work.
  if (!config.data?.emailEnabled) {
    return (
      <AuthPage title="Reset your password">
        <p className="alert" role="status">
          Password reset is not available on this server because it cannot send email yet. If you
          signed up with Google, use “Sign in with Google”.
        </p>
        <Link to="/login" className="button">
          Back to sign in
        </Link>
      </AuthPage>
    );
  }

  if (request.isSuccess) {
    return (
      <AuthPage title="Check your email">
        <p className="auth-lede" role="status">
          If <strong>{email.trim()}</strong> has a NoteFlow password account, we have sent a link to
          choose a new password. It works once and expires in an hour.
        </p>
        <Link to="/login" className="button">
          Back to sign in
        </Link>
      </AuthPage>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateAuthFields('signin', { name: '', email, password: 'x' });
    setError(found.email);
    if (!found.email) request.mutate(email.trim());
  };

  return (
    <AuthPage title="Reset your password">
      <p className="auth-lede">
        Enter your email and we will send you a link to choose a new password.
      </p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'forgot-email-error' : undefined}
            disabled={request.isPending}
          />
          {error && (
            <p id="forgot-email-error" className="field-error">
              {error}
            </p>
          )}
        </div>
        {request.isError && (
          <p role="alert" className="alert alert-error">
            {request.error.message}
          </p>
        )}
        <button
          type="submit"
          className="button button-primary auth-submit"
          disabled={request.isPending}
        >
          {request.isPending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <Link to="/login" className="link-button">
        Back to sign in
      </Link>
    </AuthPage>
  );
}
