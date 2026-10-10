import type { CookieOptions } from 'express';
import type { Env } from '../config/env.js';

export const SESSION_COOKIE = 'noteflow_session';
export const OAUTH_COOKIE = 'noteflow_oauth';
/** Same shape and lifetime as OAUTH_COOKIE, for the separate "connect Google Calendar" consent. */
export const CALENDAR_COOKIE = 'noteflow_calendar';

/** No `expiresAt` = a browser-session cookie (dropped when the browser closes). */
export function sessionCookieOptions(env: Env, expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

/** Short-lived, signed cookie that carries state/PKCE verifier/nonce across the Google redirect. */
export function oauthCookieOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax', // must be Lax (not Strict) so it is sent on Google's redirect back to us
    secure: env.NODE_ENV === 'production',
    path: '/api/auth',
    signed: true,
    maxAge: 10 * 60 * 1000,
  };
}

/** Options required to clear a cookie (same attributes as when it was set, minus expiry). */
export function clearOptions(options: CookieOptions): CookieOptions {
  const rest = { ...options };
  delete rest.expires;
  delete rest.maxAge;
  return rest;
}
