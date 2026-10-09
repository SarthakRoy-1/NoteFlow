import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { startGoogleLink, type User } from '../auth/authApi';
import { PasswordField } from '../auth/PasswordField';
import { ME_KEY } from '../auth/useAuth';

const LINK_MESSAGES: Record<string, string> = {
  link_expired: 'That connection attempt took too long and expired. Please try again.',
  link_invalid: 'That connection link was already used or is not valid. Please start again.',
  link_cancelled: 'You cancelled at Google, so nothing was connected.',
  link_session_mismatch:
    'That attempt did not come from this signed-in session, so nothing was connected. Please start again from here.',
  link_email_unverified: 'That Google account’s email is not verified, so it cannot be connected.',
  link_already_linked: 'Google is already connected to this account.',
  link_identity_taken: 'That Google account is already connected to a different NoteFlow account.',
  link_failed: 'We could not finish connecting Google. Please try again.',
};

/** Which ways this account can sign in, and the safe way to add Google to a password account. */
export function SignInMethods({ me }: { me: User }) {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const link = params.get('link');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const connect = useMutation({
    mutationFn: startGoogleLink,
    // A full-page redirect to Google; the callback brings the user back here with ?link=…
    onSuccess: ({ url }) => window.location.assign(url),
  });

  useEffect(() => {
    if (link === 'ok') void queryClient.invalidateQueries({ queryKey: ME_KEY });
  }, [link, queryClient]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password === '') {
      setFieldError('Enter your password to continue.');
      return;
    }
    setFieldError(undefined);
    connect.mutate(password, { onError: () => setPassword('') });
  };

  const error = connect.error instanceof ApiError ? connect.error : null;
  const reauth = error?.code === 'REAUTH_FAILED' ? error.message : undefined;
  const other = connect.isError && !reauth ? connect.error.message : null;
  const canConnect = me.signIn.password && !me.signIn.google;

  return (
    <div className="settings-row">
      <div className="settings-label">
        <h2>Sign-in methods</h2>
        <p className="muted">
          Google and password accounts are never merged automatically because their emails match.
          Connecting Google is something you do here, on purpose.
        </p>
      </div>
      <div className="settings-control">
        <dl className="settings-account">
          <dt>Password</dt>
          <dd>{me.signIn.password ? 'Set' : 'Not set'}</dd>
          <dt>Google</dt>
          <dd>{me.signIn.google ? 'Connected' : 'Not connected'}</dd>
        </dl>

        {link === 'ok' && (
          <p role="status" className="alert">
            Google is now connected. You can sign in with either method.
          </p>
        )}
        {link && link !== 'ok' && (
          <p role="alert" className="alert alert-error">
            {LINK_MESSAGES[link] ?? 'We could not connect Google. Please try again.'}
          </p>
        )}

        {canConnect && (
          <form className="auth-form settings-link-form" onSubmit={submit} noValidate>
            <PasswordField
              id="link-password"
              label="Confirm your password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              error={fieldError ?? reauth}
              hint="We ask again before connecting Google, in case someone else is using this device."
              disabled={connect.isPending}
            />
            {other && (
              <p role="alert" className="alert alert-error">
                {other}
              </p>
            )}
            <div className="actions">
              <button type="submit" className="button" disabled={connect.isPending}>
                {connect.isPending ? 'Opening Google…' : 'Connect Google'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
