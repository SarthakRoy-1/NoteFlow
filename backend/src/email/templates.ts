import type { EmailMessage } from './types.js';

// Links carry the token in the URL fragment: browsers never send it to servers or in Referer headers.
const link = (baseUrl: string, path: string, token: string) =>
  `${baseUrl.replace(/\/$/, '')}${path}#token=${encodeURIComponent(token)}`;

export function verificationEmail(to: string, baseUrl: string, token: string): EmailMessage {
  return {
    to,
    subject: 'Confirm your email for NoteFlow',
    text: [
      'Finish creating your NoteFlow account by opening this link:',
      '',
      link(baseUrl, '/verify-email', token),
      '',
      'You will be asked for the password you chose when signing up. The link works once and expires in 24 hours.',
      'If you did not sign up, ignore this email: nothing was created and no one can use your address.',
    ].join('\n'),
  };
}

export function alreadyRegisteredEmail(to: string, baseUrl: string): EmailMessage {
  return {
    to,
    subject: 'You already have a NoteFlow account',
    text: [
      'Someone (hopefully you) tried to create a NoteFlow account with this address, but one already exists.',
      '',
      `Sign in at ${baseUrl.replace(/\/$/, '')}/login. If you forgot your password, use "Forgot password?" there.`,
      'If this was not you, you can ignore this email.',
    ].join('\n'),
  };
}

export function passwordResetEmail(to: string, baseUrl: string, token: string): EmailMessage {
  return {
    to,
    subject: 'Reset your NoteFlow password',
    text: [
      'Reset your NoteFlow password by opening this link:',
      '',
      link(baseUrl, '/reset-password', token),
      '',
      'The link works once and expires in 1 hour. Resetting signs you out everywhere.',
      'If you did not ask for this, ignore this email: your password has not changed.',
    ].join('\n'),
  };
}
