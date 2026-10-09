export type AuthMode = 'signin' | 'register';

export interface AuthFields {
  name: string;
  email: string;
  password: string;
}

export type AuthFieldErrors = Partial<Record<keyof AuthFields, string>>;

// Keep in sync with backend/src/auth/password.ts (the server is authoritative).
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same rules the server enforces, so most mistakes are caught before a request is sent. */
export function validateAuthFields(mode: AuthMode, v: AuthFields): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (mode === 'register' && v.name.trim() === '') errors.name = 'Enter your name.';
  const email = v.email.trim();
  if (email === '') errors.email = 'Enter your email address.';
  else if (!EMAIL.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
  if (v.password === '') errors.password = 'Enter your password.';
  else if (mode === 'register' && v.password.length < PASSWORD_MIN)
    errors.password = `Use at least ${PASSWORD_MIN} characters.`;
  else if (v.password.length > PASSWORD_MAX)
    errors.password = `Use at most ${PASSWORD_MAX} characters.`;
  return errors;
}
