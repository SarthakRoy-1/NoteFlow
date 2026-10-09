const MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. You can try again whenever you are ready.',
  session_expired: 'Your session has ended. Please sign in again.',
  invalid_state: 'Your sign-in session expired or could not be verified. Please try again.',
  login_failed: 'We could not complete sign-in with Google. Please try again.',
  email_unverified: 'Your Google account email is not verified, so we cannot sign you in.',
  email_in_use:
    'That email already has a NoteFlow account that uses a password. Sign in with your email and password, then connect Google from Settings.',
  not_configured:
    'Google sign-in is not set up on this server yet. Please contact the administrator.',
};

export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? 'Sign-in failed. Please try again.';
}
