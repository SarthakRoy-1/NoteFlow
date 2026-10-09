import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { registerWithPassword } from './authApi';
import { PASSWORD_MIN, validateAuthFields, type AuthFieldErrors, type AuthMode } from './emailAuth';
import { PasswordField } from './PasswordField';
import { ResendVerification, VerificationSent } from './ResendVerification';
import { useLogin } from './useAuth';

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

interface EmailAuthFormProps {
  mode: AuthMode;
  /** From /api/auth/config: can this server send email? Unknown while loading. */
  emailEnabled: boolean | undefined;
}

export function EmailAuthForm({ mode, emailEnabled }: EmailAuthFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const login = useLogin();
  const register = useMutation({ mutationFn: registerWithPassword });
  const pending = login.isPending || register.isPending;
  const isRegister = mode === 'register';

  if (isRegister && emailEnabled === false) {
    // Sign-up needs a confirmation email; do not offer a form that cannot work.
    return (
      <p className="alert" role="status">
        Creating an account with an email and password is not available on this server yet, because
        it cannot send the confirmation email. Use “Sign up with Google” instead.
      </p>
    );
  }

  if (sentTo) return <VerificationSent email={sentTo} onBack={() => setSentTo(null)} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setUnverified(null);
    const found = validateAuthFields(mode, { name, email, password });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const onError = (err: Error) => {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setUnverified(email.trim());
      setFormError(err.message);
    };
    if (isRegister) {
      register.mutate(
        { name: name.trim(), email: email.trim(), password, timezone: browserTimezone() },
        { onSuccess: () => setSentTo(email.trim()), onError },
      );
    } else {
      login.mutate({ email: email.trim(), password }, { onError });
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {isRegister && (
        <div className="field">
          <label htmlFor="auth-name">Name</label>
          <input
            id="auth-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'auth-name-error' : undefined}
            disabled={pending}
          />
          {errors.name && (
            <p id="auth-name-error" className="field-error">
              {errors.name}
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'auth-email-error' : undefined}
          disabled={pending}
        />
        {errors.email && (
          <p id="auth-email-error" className="field-error">
            {errors.email}
          </p>
        )}
      </div>

      <PasswordField
        id="auth-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete={isRegister ? 'new-password' : 'current-password'}
        error={errors.password}
        hint={
          isRegister
            ? `At least ${PASSWORD_MIN} characters. A few random words works well.`
            : undefined
        }
        disabled={pending}
      />

      {!isRegister && emailEnabled && (
        <Link to="/forgot-password" className="link-button forgot-link">
          Forgot password?
        </Link>
      )}

      {formError && (
        <div role="alert" className="alert alert-error">
          <p>{formError}</p>
          {unverified && emailEnabled && <ResendVerification email={unverified} />}
        </div>
      )}

      <button type="submit" className="button button-primary auth-submit" disabled={pending}>
        {pending
          ? isRegister
            ? 'Creating account…'
            : 'Signing in…'
          : isRegister
            ? 'Create account'
            : 'Sign in'}
      </button>
    </form>
  );
}
