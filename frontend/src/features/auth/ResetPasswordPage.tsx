import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { AuthPage } from './AuthPage';
import { resetPassword } from './authApi';
import { PASSWORD_MIN, validateAuthFields } from './emailAuth';
import { PasswordField } from './PasswordField';
import { useUrlToken } from './useUrlToken';

export function ResetPasswordPage() {
  const token = useUrlToken();
  const reset = useMutation({ mutationFn: resetPassword });
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const error = reset.error instanceof ApiError ? reset.error : null;

  if (reset.isSuccess) {
    return (
      <AuthPage title="Password updated">
        <p className="auth-lede" role="status">
          Your password has been changed and you have been signed out everywhere. Sign in with the
          new one.
        </p>
        <Link to="/login" className="button button-primary">
          Go to sign in
        </Link>
      </AuthPage>
    );
  }

  if (!token || error?.code === 'TOKEN_INVALID' || error?.code === 'TOKEN_EXPIRED') {
    const expired = error?.code === 'TOKEN_EXPIRED';
    return (
      <AuthPage title={expired ? 'This link has expired' : 'This link can’t be used'}>
        <p role="alert" className="alert alert-error">
          {expired
            ? 'Reset links work for one hour.'
            : 'This reset link is not valid, or it has already been used.'}
        </p>
        <Link to="/forgot-password" className="button button-primary">
          Get a new link
        </Link>
      </AuthPage>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateAuthFields('register', { name: 'x', email: 'a@b.co', password });
    setFieldError(found.password);
    if (!found.password) reset.mutate({ token, password });
  };

  const otherError = reset.isError ? reset.error.message : null;

  return (
    <AuthPage title="Choose a new password">
      <form className="auth-form" onSubmit={submit} noValidate>
        <PasswordField
          id="reset-password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={fieldError}
          hint={`At least ${PASSWORD_MIN} characters.`}
          disabled={reset.isPending}
        />
        {otherError && (
          <p role="alert" className="alert alert-error">
            {otherError}
          </p>
        )}
        <button
          type="submit"
          className="button button-primary auth-submit"
          disabled={reset.isPending}
        >
          {reset.isPending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthPage>
  );
}
