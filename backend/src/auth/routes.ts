import { timingSafeEqual } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { isValidIanaTimezone } from '../lib/timezone.js';
import { logger } from '../lib/logger.js';
import { isUniqueViolation, upsertGoogleUser } from '../modules/users/users.repo.js';
import {
  CALENDAR_COOKIE,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  clearOptions,
  oauthCookieOptions,
  sessionCookieOptions,
} from './cookies.js';
import type { GoogleAuth } from './google.js';
import { authNotConfigured } from './google.js';
import { consumeLinkAttempt, deletePendingForEmail } from './accountTokens.js';
import { finishGoogleLink } from './link.routes.js';
import { createSession, deleteSession, findUserByToken, hashToken } from './sessions.js';
import { storeCalendarConnection } from '../calendar/calendarSync.js';

export interface AuthRouterDeps {
  env: Env;
  db: Db;
  /** Lazily resolved so a missing Google config is reported per request, not at boot. */
  getGoogle: () => GoogleAuth;
  now?: () => Date;
}

const oauthPayload = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
  tz: z.string().optional(),
  /** "Remember me", fixed at sign-in start. Lives only inside the signed cookie, never in the callback URL. */
  remember: z.boolean().optional(),
});

const calendarPayload = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
  userId: z.string().uuid(),
});

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function authRouter({ env, db, getGoogle, now = () => new Date() }: AuthRouterDeps) {
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
      const remember = req.query.remember === '1';
      res.cookie(
        OAUTH_COOKIE,
        JSON.stringify({ ...checks, tz, remember }),
        oauthCookieOptions(env),
      );
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
      // Rebuild the callback URL from the configured redirect URI so proxies cannot alter it.
      const buildCallbackUrl = () => {
        const redirectUri = env.GOOGLE_REDIRECT_URI;
        if (!redirectUri) throw authNotConfigured();
        const url = new URL(redirectUri);
        url.search = new URL(req.originalUrl, 'http://placeholder.invalid').search;
        return url;
      };

      // "Connect Google Calendar" consent shares this redirect URI; it is told apart by its own signed
      // cookie. It is handled first so a declined consent (?error=...) is not read as a failed login.
      const calendarRaw: unknown = req.signedCookies?.[CALENDAR_COOKIE];
      if (typeof calendarRaw === 'string' && typeof req.query.state === 'string') {
        const calendar = calendarPayload.safeParse(safeJson(calendarRaw));
        if (calendar.success && safeEqual(req.query.state, calendar.data.state)) {
          return await finishCalendar(req, res, calendar.data, buildCallbackUrl);
        }
      }

      // "Connect Google" attempts share this redirect URI; their one-time state is stored server-side.
      if (env.ENABLE_PASSWORD_AUTH && typeof req.query.state === 'string') {
        const attempt = await consumeLinkAttempt(db, hashToken(req.query.state), now());
        if (attempt) {
          return await finishGoogleLink(
            { env, db, getGoogle, now },
            req,
            res,
            attempt,
            buildCallbackUrl,
          );
        }
      }

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
      const identity = await google.completeAuthorization(buildCallbackUrl(), {
        state: payload.data.state,
        codeVerifier: payload.data.codeVerifier,
        nonce: payload.data.nonce,
      });
      if (!identity.emailVerified) return failLogin(res, 'email_unverified');

      let user;
      try {
        user = await upsertGoogleUser(db, identity, payload.data.tz ?? 'UTC');
      } catch (err) {
        // The email already belongs to another (e.g. password) account. We never merge on email alone.
        if (isUniqueViolation(err)) return failLogin(res, 'email_in_use');
        throw err;
      }
      await deletePendingForEmail(db, user.email); // an unverified sign-up for it is now moot
      const previous: unknown = req.cookies?.[SESSION_COOKIE];
      if (typeof previous === 'string' && previous !== '') await deleteSession(db, previous);
      const remember = payload.data.remember === true;
      const ttlDays = remember ? env.REMEMBER_ME_TTL_DAYS : env.SESSION_ONLY_TTL_HOURS / 24;
      const { token, expiresAt } = await createSession(db, user.id, ttlDays);

      res.clearCookie(OAUTH_COOKIE, clearOptions(oauthCookieOptions(env)));
      // Remembered: a dated cookie. Otherwise a session cookie, which the server also expires.
      res.cookie(
        SESSION_COOKIE,
        token,
        sessionCookieOptions(env, remember ? expiresAt : undefined),
      );
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

  const settingsUrl = (result: string) => `${env.APP_BASE_URL}/settings?calendar=${result}`;

  /**
   * Second half of "Connect Google Calendar". Only the signed-in user who started it can finish it,
   * the grant must belong to that user's own Google account, and it must really include Calendar
   * access (the consent screen lets people untick it).
   */
  async function finishCalendar(
    req: import('express').Request,
    res: Response,
    checks: z.infer<typeof calendarPayload>,
    buildCallbackUrl: () => URL,
  ) {
    res.clearCookie(CALENDAR_COOKIE, clearOptions(oauthCookieOptions(env)));
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user =
      typeof token === 'string' && token !== '' ? await findUserByToken(db, token) : null;
    if (!user || user.id !== checks.userId) return res.redirect(302, settingsUrl('error'));
    if (typeof req.query.error === 'string') return res.redirect(302, settingsUrl('declined'));
    try {
      const grant = await getGoogle().completeCalendarAuthorization(buildCallbackUrl(), {
        state: checks.state,
        codeVerifier: checks.codeVerifier,
        nonce: checks.nonce,
      });
      if (!grant.emailVerified || grant.email.toLowerCase() !== user.email.toLowerCase()) {
        return res.redirect(302, settingsUrl('mismatch'));
      }
      if (!grant.scope.split(' ').includes(env.GOOGLE_CALENDAR_SCOPE)) {
        return res.redirect(302, settingsUrl('declined'));
      }
      if (!grant.refreshToken) return res.redirect(302, settingsUrl('error'));
      await storeCalendarConnection(db, env.SESSION_SECRET, {
        userId: user.id,
        refreshToken: grant.refreshToken,
        scope: grant.scope,
        googleEmail: grant.email,
      });
      return res.redirect(302, settingsUrl('connected'));
    } catch (err) {
      logger.warn('Google Calendar connection failed', { name: (err as Error).name });
      return res.redirect(302, settingsUrl('error'));
    }
  }

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
