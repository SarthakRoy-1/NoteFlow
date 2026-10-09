import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { AuthPage } from './AuthPage';
import { PasswordField } from './PasswordField';
import { useVerifyEmail } from './useAuth';
import { useUrlToken } from './useUrlToken';

/** Opened from the emailed link. Needs the password chosen at sign-up, then signs the user in. */
export function VerifyEmailPage() {
  const token = useUrlToken();
  const verify = useVerifyEmail();
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const error = verify.error instanceof ApiError ? verify.error : null;

  if (verify.isSuccess) {
    return (
      <AuthPage title="Email confirmed">
        <p className="auth-lede" role="status">
          Your account is ready and you are signed in.
        </p>
        <Link to="/notes" className="button button-primary">
          Open NoteFlow
        </Link>
      </AuthPage>
    );
  }

  if (!token || error?.code === 'TOKEN_INVALID') {
    return (
      <AuthPage title="This link can’t be used">
        <p role="alert" className="alert alert-error">
          This confirmation link is not valid, or it has already been used.
        </p>
        <p className="auth-lede">
          If you already confirmed your email, sign in. Otherwise create the account again to get a
          new link.
        </p>
        <Link to="/login" className="button">
          Back to sign in
        </Link>
      </AuthPage>
    );
  }

  if (error?.code === 'TOKEN_EXPIRED') {
    return (
      <AuthPage title="This link has expired">
        <p role="alert" className="alert alert-error">
          Confirmation links work for 24 hours. Create your account again to get a new one.
        </p>
        <Link to="/login" className="button button-primary">
          Back to sign in
        </Link>
      </AuthPage>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password === '') {
      setFieldError('Enter the password you chose when signing up.');
      return;
    }
    setFieldError(undefined);
    verify.mutate({ token, password });
  };

  const mismatch = error?.code === 'PASSWORD_MISMATCH' ? error.message : undefined;
  const otherError =
    error && !mismatch ? error.message : verify.isError && !error ? verify.error.message : null;

  return (
    <AuthPage title="Finish creating your account">
      <p className="auth-lede">
        Enter the password you chose when you signed up. This proves the sign-up was yours.
      </p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <PasswordField
          id="verify-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={fieldError ?? mismatch}
          disabled={verify.isPending}
        />
        {otherError && (
          <p role="alert" className="alert alert-error">
            {otherError}
          </p>
        )}
        <button
          type="submit"
          className="button button-primary auth-submit"
          disabled={verify.isPending}
        >
          {verify.isPending ? 'Confirming…' : 'Confirm email'}
        </button>
      </form>
    </AuthPage>
  );
}
