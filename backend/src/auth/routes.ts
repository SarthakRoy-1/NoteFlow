import { timingSafeEqual } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { isValidIanaTimezone } from '../lib/timezone.js';
import { logger } from '../lib/logger.js';
import { upsertGoogleUser } from '../modules/users/users.repo.js';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  clearOptions,
  oauthCookieOptions,
  sessionCookieOptions,
} from './cookies.js';
import type { GoogleAuth } from './google.js';
import { authNotConfigured } from './google.js';
import { createSession, deleteSession } from './sessions.js';

export interface AuthRouterDeps {
  env: Env;
  db: Db;
  /** Lazily resolved so a missing Google config is reported per request, not at boot. */
  getGoogle: () => GoogleAuth;
}

const oauthPayload = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
  tz: z.string().optional(),
});

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function authRouter({ env, db, getGoogle }: AuthRouterDeps) {
  const router = Router();

  const loginUrl = (error: string) =>
    `${env.APP_BASE_URL}/login?error=${encodeURIComponent(error)}`;

  const failLogin = (res: Response, code: string) => {
    res.clearCookie(OAUTH_COOKIE, clearOptions(oauthCookieOptions(env)));
    res.redirect(302, loginUrl(code));
  };

  // Step 1: send the browser to Google with state + PKCE challenge + nonce.
  router.get('/google', async (req, res) => {
    try {
      const google = getGoogle();
      const { url, checks } = await google.startAuthorization();
      const requestedTz = typeof req.query.tz === 'string' ? req.query.tz : undefined;
      const tz = requestedTz && isValidIanaTimezone(requestedTz) ? requestedTz : undefined;
      res.cookie(OAUTH_COOKIE, JSON.stringify({ ...checks, tz }), oauthCookieOptions(env));
      res.redirect(302, url.toString());
    } catch (err) {
      if (err instanceof AppError && err.code === 'AUTH_NOT_CONFIGURED') {
        return failLogin(res, 'not_configured');
      }
      logger.error('Could not start Google sign-in', { name: (err as Error).name });
      failLogin(res, 'login_failed');
    }
  });

  // Step 2: Google redirects back here with ?code&state (or ?error).
  router.get('/google/callback', async (req, res) => {
    try {
      if (typeof req.query.error === 'string') return failLogin(res, 'access_denied');

      const raw: unknown = req.signedCookies?.[OAUTH_COOKIE];
      const parsed = typeof raw === 'string' ? safeJson(raw) : undefined;
      const payload = oauthPayload.safeParse(parsed);
      const stateParam = req.query.state;
      if (
        !payload.success ||
        typeof stateParam !== 'string' ||
        !safeEqual(stateParam, payload.data.state)
      ) {
        return failLogin(res, 'invalid_state');
      }

      const google = getGoogle();
      const redirectUri = env.GOOGLE_REDIRECT_URI;
      if (!redirectUri) throw authNotConfigured();
      // Rebuild the callback URL from the configured redirect URI so proxies cannot alter it.
      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = new URL(req.originalUrl, 'http://placeholder.invalid').search;

      const identity = await google.completeAuthorization(callbackUrl, {
        state: payload.data.state,
        codeVerifier: payload.data.codeVerifier,
        nonce: payload.data.nonce,
      });
      if (!identity.emailVerified) return failLogin(res, 'email_unverified');

      const user = await upsertGoogleUser(db, identity, payload.data.tz ?? 'UTC');
      const { token, expiresAt } = await createSession(db, user.id, env.SESSION_TTL_DAYS);

      res.clearCookie(OAUTH_COOKIE, clearOptions(oauthCookieOptions(env)));
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(env, expiresAt));
      res.redirect(302, `${env.APP_BASE_URL}/`);
    } catch (err) {
      if (err instanceof AppError && err.code === 'AUTH_NOT_CONFIGURED') {
        return failLogin(res, 'not_configured');
      }
      // Log only the error type: messages from the OAuth library may echo request details.
      logger.warn('Google sign-in failed', { name: (err as Error).name });
      failLogin(res, 'login_failed');
    }
  });

  // Safe to call when already signed out.
  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token !== '') await deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, clearOptions(sessionCookieOptions(env, new Date())));
    res.status(204).end();
  });

  return router;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
