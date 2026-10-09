import { ApiError, api } from '../../lib/api';

export interface User {
  id: string;
  email: string;
  name: string;
  timezone: string;
  /** Which ways the account can sign in (never the hash or the Google id). */
  signIn: { password: boolean; google: boolean };
}

/** Returns the signed-in user, or null when there is no valid session. */
export async function fetchMe(): Promise<User | null> {
  try {
    const { user } = await api<{ user: User }>('/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const updateTimezone = async (timezone: string) =>
  (await api<{ user: User }>('/me', { method: 'PATCH', body: JSON.stringify({ timezone }) })).user;

export const logout = () => api<void>('/auth/logout', { method: 'POST' });

export interface PasswordCredentials {
  email: string;
  password: string;
}

export interface Registration extends PasswordCredentials {
  name: string;
  timezone: string;
}

export const loginWithPassword = async (credentials: PasswordCredentials) =>
  (await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }))
    .user;

/** Always a generic "check your email": the server does not say whether the address was new. */
export const registerWithPassword = (registration: Registration) =>
  api<{ status: 'verification_sent' }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(registration),
  });

export const fetchAuthConfig = () => api<{ emailEnabled: boolean }>('/auth/config');

export const resendVerification = (email: string) =>
  api<{ status: string }>('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

/** Needs the emailed token AND the password chosen at sign-up. Signs the user in on success. */
export const verifyEmail = async (input: { token: string; password: string }) =>
  (await api<{ user: User }>('/auth/verify-email', { method: 'POST', body: JSON.stringify(input) }))
    .user;

export const forgotPassword = (email: string) =>
  api<{ status: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const resetPassword = (input: { token: string; password: string }) =>
  api<{ status: string }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** Returns the Google URL to send the browser to. Re-checks the account password server-side. */
export const startGoogleLink = (password: string) =>
  api<{ url: string }>('/auth/link/google/start', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
