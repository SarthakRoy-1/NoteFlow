import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RateLimiter } from '../lib/rateLimit.js';
import { currentUser } from '../middleware/requireAuth.js';
import {
  findUserByGoogleSub,
  isUniqueViolation,
  linkGoogleIdentity,
} from '../modules/users/users.repo.js';
import {
  LINK_TTL_MS,
  createLinkAttempt,
  type LinkAttempt,
  type TokenLookup,
} from './accountTokens.js';
import { SESSION_COOKIE } from './cookies.js';
import type { GoogleAuth } from './google.js';
import { verifyPassword } from './password.js';
import { findUserByToken, hashToken } from './sessions.js';

export interface LinkRouterDeps {
  env: Env;
  db: Db;
  getGoogle: () => GoogleAuth;
  limiter: RateLimiter;
  now: () => Date;
}

const startBody = z.object({
  password: z
    .string({ required_error: 'Enter your password.', invalid_type_error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(1024),
});

const sessionToken = (req: Request): string | null => {
  const t: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof t === 'string' && t !== '' ? t : null;
};

/**
 * POST /api/auth/link/google/start (behind requireAuth). Connecting Google to a password account
 * needs (1) the live session and (2) the account's password typed again right now. The one-time
 * OAuth state is stored hashed and bound to this account and this exact session.
 */
export function linkRouter({ db, getGoogle, limiter, now }: LinkRouterDeps) {
  const router = Router();

  router.post('/google/start', async (req, res, next) => {
    try {
      const user = currentUser(req);
      if (!limiter.take(`link:${user.id}`)) {
        throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Please wait a few minutes.');
      }
      const body = startBody.parse(req.body);
      if (user.googleSub) {
        throw new AppError('ALREADY_LINKED', 409, 'Google is already connected to this account.');
      }
      // Recent re-authentication with the account's current method (its password).
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
        throw new AppError('REAUTH_FAILED', 401, 'That password is not correct.');
      }
      const token = sessionToken(req);
      if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in to continue.');

      const { url, checks } = await getGoogle().startAuthorization();
      await createLinkAttempt(db, {
        stateHash: hashToken(checks.state),
        userId: user.id,
        sessionId: hashToken(token),
        codeVerifier: checks.codeVerifier,
        nonce: checks.nonce,
        expiresAt: new Date(now().getTime() + LINK_TTL_MS),
      });
      res.json({ url: url.toString() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export interface FinishLinkDeps {
  env: Env;
  db: Db;
  getGoogle: () => GoogleAuth;
  now: () => Date;
}

/** Where the user lands after a link attempt; `code` is `ok` or an error code the UI explains. */
const settingsUrl = (env: Env, code: string) =>
  `${env.APP_BASE_URL}/settings?link=${encodeURIComponent(code)}`;

/**
 * Handles Google's redirect for a link attempt. Called from the shared callback only when `state`
 * names a stored attempt (consumed here: replays find it spent). Fails closed on any mismatch.
 */
export async function finishGoogleLink(
  { env, db, getGoogle, now }: FinishLinkDeps,
  req: Request,
  res: Response,
  attempt: TokenLookup<LinkAttempt>,
  callbackUrl: () => URL,
): Promise<void> {
  const done = (code: string) => res.redirect(302, settingsUrl(env, code));
  try {
    if (attempt.state === 'expired') return done('link_expired');
    if (attempt.state === 'invalid') return done('link_invalid');
    if (typeof req.query.error === 'string') return done('link_cancelled');

    // Same account AND same session that started it (no session confusion, no cross-account link).
    const token = sessionToken(req);
    const user = token ? await findUserByToken(db, token, now()) : null;
    if (
      !token ||
      !user ||
      user.id !== attempt.value.userId ||
      hashToken(token) !== attempt.value.sessionId
    ) {
      return done('link_session_mismatch');
    }

    const identity = await getGoogle().completeAuthorization(callbackUrl(), {
      state: String(req.query.state),
      codeVerifier: attempt.value.codeVerifier,
      nonce: attempt.value.nonce,
    });
    if (!identity.emailVerified) return done('link_email_unverified');

    const owner = await findUserByGoogleSub(db, identity.sub);
    if (owner) return done(owner.id === user.id ? 'link_already_linked' : 'link_identity_taken');

    try {
      if (!(await linkGoogleIdentity(db, user.id, identity.sub, now()))) {
        return done('link_already_linked');
      }
    } catch (err) {
      if (isUniqueViolation(err)) return done('link_identity_taken');
      throw err;
    }
    done('ok');
  } catch (err) {
    // Log the error type only: OAuth library messages can echo request details.
    logger.warn('Google link failed', { name: (err as Error).name });
    done('link_failed');
  }
}
