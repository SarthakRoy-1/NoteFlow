const MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. You can try again whenever you are ready.',
  session_expired: 'Your session has ended. Please sign in again.',
  invalid_state: 'Your sign-in session expired or could not be verified. Please try again.',
  login_failed: 'We could not complete sign-in with Google. Please try again.',
  email_unverified: 'Your Google account email is not verified, so we cannot sign you in.',
  not_configured:
    'Google sign-in is not set up on this server yet. Please contact the administrator.',
};

const EMAIL_IN_USE_PASSWORD =
  'That email already has a NoteFlow account that uses a password. Sign in with your email and password, then connect Google from Settings.';
const EMAIL_IN_USE_GOOGLE_ONLY =
  'That email already belongs to a NoteFlow account that cannot sign in with Google. Please contact the administrator.';

export function loginErrorMessage(code: string | null, passwordAuthEnabled = false): string | null {
  if (!code) return null;
  if (code === 'email_in_use')
    return passwordAuthEnabled ? EMAIL_IN_USE_PASSWORD : EMAIL_IN_USE_GOOGLE_ONLY;
  return MESSAGES[code] ?? 'Sign-in failed. Please try again.';
}
