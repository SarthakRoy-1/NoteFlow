import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import {
  alreadyRegisteredEmail,
  passwordResetEmail,
  verificationEmail,
} from '../email/templates.js';
import type { EmailMessage, EmailSender } from '../email/types.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RateLimiter } from '../lib/rateLimit.js';
import { isValidIanaTimezone } from '../lib/timezone.js';
import {
  findUserByEmail,
  findUserById,
  isUniqueViolation,
  markEmailVerified,
  setPasswordHash,
  toPublicUser,
  type User,
} from '../modules/users/users.repo.js';
import {
  RESET_TTL_MS,
  VERIFY_TTL_MS,
  completePending,
  consumeUserToken,
  createUserToken,
  deleteAllSessions,
  findPending,
  findUserToken,
  newToken,
  purgeExpired,
  rotatePendingToken,
  savePending,
} from './accountTokens.js';
import { SESSION_COOKIE, sessionCookieOptions } from './cookies.js';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from './password.js';
import { createSession, deleteSession, hashToken } from './sessions.js';

export interface PasswordAuthLimiters {
  /** Sign-up and resend requests per client IP. */
  register: RateLimiter;
  /** Login attempts per client IP. */
  loginIp: RateLimiter;
  /** Login attempts per target email, so one account cannot be ground down from many IPs. */
  loginEmail: RateLimiter;
  /** Emails sent per address (sign-up, resend, reset): stops mail-bombing someone else's inbox. */
  emailSend: RateLimiter;
  /** Forgot-password requests per client IP. */
  forgotIp: RateLimiter;
  /** Token submissions (verify/reset) per client IP. */
  tokenIp: RateLimiter;
  /** Start-of-link attempts per signed-in user (each one asks for the password again). */
  link: RateLimiter;
  /** Submissions per individual token, so a link cannot be brute-forced or password-guessed. */
  tokenAttempts: RateLimiter;
}

export interface PasswordAuthDeps {
  env: Env;
  db: Db;
  limiters: PasswordAuthLimiters;
  email: EmailSender;
  now: () => Date;
}

const email = z
  .string({
    required_error: 'Enter your email address.',
    invalid_type_error: 'Enter your email address.',
  })
  .trim()
  .toLowerCase()
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.');

const newPassword = z
  .string({ required_error: 'Enter a password.', invalid_type_error: 'Enter a password.' })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

const token = z
  .string({
    required_error: 'This link is incomplete.',
    invalid_type_error: 'This link is incomplete.',
  })
  .min(20, 'This link is incomplete.')
  .max(200, 'This link is incomplete.');

const registerBody = z.object({
  name: z
    .string({ required_error: 'Enter your name.', invalid_type_error: 'Enter your name.' })
    .trim()
    .min(1, 'Enter your name.')
    .max(100, 'Your name is too long.'),
  email,
  password: newPassword,
  timezone: z.string().optional(),
});
const loginBody = z.object({
  email,
  password: z
    .string({ required_error: 'Enter your password.', invalid_type_error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(1024),
});
const emailBody = z.object({ email });
const verifyBody = z.object({
  token,
  password: z
    .string({ required_error: 'Enter your password.', invalid_type_error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(1024),
});
const resetBody = z.object({ token, password: newPassword });

const tooMany = () =>
  new AppError('RATE_LIMITED', 429, 'Too many attempts. Please wait a few minutes and try again.');
const emailOff = () =>
  new AppError(
    'EMAIL_NOT_CONFIGURED',
    503,
    'Email is not set up on this server, so this is not available. Sign in with Google instead.',
  );
// One message for "no such account", "Google-only account" and "wrong password".
const badCredentials = () =>
  new AppError(
    'INVALID_CREDENTIALS',
    401,
    'Email or password is incorrect. If you registered with Google, use "Sign in with Google".',
  );
const notVerified = () =>
  new AppError(
    'EMAIL_NOT_VERIFIED',
    403,
    'Please confirm your email address first. We can send you a new link.',
  );
const invalidLink = () =>
  new AppError('TOKEN_INVALID', 400, 'This link is not valid, or it has already been used.');
const expiredLink = () =>
  new AppError('TOKEN_EXPIRED', 410, 'This link has expired. Please request a new one.');
const emailInUse = () =>
  new AppError(
    'EMAIL_IN_USE',
    409,
    'An account with this email already exists. Sign in instead, with Google or your password.',
  );

export function passwordAuthRouter({ env, db, limiters, email: mailer, now }: PasswordAuthDeps) {
  const router = Router();

  const limit = (limiter: RateLimiter, key: string) => {
    if (!limiter.take(key)) throw tooMany();
  };

  /**
   * Fire and forget on purpose: the response time must not reveal whether a mail was sent.
   * Failures are logged by kind only (never the recipient, link or token).
   */
  const send = (message: EmailMessage) => {
    void mailer.send(message).catch((err: { kind?: string }) => {
      logger.warn('Email was not delivered', { kind: err.kind ?? 'unknown' });
    });
  };

  /** New random token per sign-in; any session the browser already held is revoked (no fixation). */
  async function startSession(req: Request, res: Response, user: User) {
    const old: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof old === 'string' && old !== '') await deleteSession(db, old);
    const { token: sessionToken, expiresAt } = await createSession(
      db,
      user.id,
      env.SESSION_TTL_DAYS,
      now(),
    );
    res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(env, expiresAt));
  }

  /** Lets the UI hide sign-up and recovery instead of showing something that cannot work. */
  router.get('/config', (_req, res) => {
    res.json({ emailEnabled: mailer.configured });
  });

  router.post('/register', async (req, res, next) => {
    try {
      limit(limiters.register, `register:${req.ip}`);
      const body = registerBody.parse(req.body);
      if (!mailer.configured) throw emailOff();
      limit(limiters.emailSend, `email:${body.email}`);

      // Hash before looking the address up, so "new" and "taken" take the same time.
      const passwordHash = await hashPassword(body.password);
      await purgeExpired(db, now());

      if (await findUserByEmail(db, body.email)) {
        send(alreadyRegisteredEmail(body.email, env.APP_BASE_URL));
      } else {
        const { token: raw, hash } = newToken();
        const saved = await savePending(db, {
          email: body.email,
          name: body.name,
          passwordHash,
          timezone: body.timezone && isValidIanaTimezone(body.timezone) ? body.timezone : 'UTC',
          tokenHash: hash,
          expiresAt: new Date(now().getTime() + VERIFY_TTL_MS),
        });
        if (saved) send(verificationEmail(body.email, env.APP_BASE_URL, raw));
      }
      // Same answer whether or not the address already has an account.
      res.status(202).json({ status: 'verification_sent' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/resend-verification', async (req, res, next) => {
    try {
      limit(limiters.register, `resend:${req.ip}`);
      const body = emailBody.parse(req.body);
      if (!mailer.configured) throw emailOff();
      limit(limiters.emailSend, `email:${body.email}`);

      const { token: raw, hash } = newToken();
      const expiresAt = new Date(now().getTime() + VERIFY_TTL_MS);
      if (await rotatePendingToken(db, body.email, hash, now(), expiresAt)) {
        send(verificationEmail(body.email, env.APP_BASE_URL, raw));
      } else {
        // Accounts created before verification existed: same link, same checks.
        const user = await findUserByEmail(db, body.email);
        if (user?.passwordHash && !user.emailVerifiedAt) {
          await createUserToken(db, user.id, 'verify_email', hash, now(), expiresAt);
          send(verificationEmail(body.email, env.APP_BASE_URL, raw));
        }
      }
      res.status(202).json({ status: 'verification_sent' });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Needs BOTH the emailed token and the password chosen at sign-up. Someone who overwrote a
   * victim's pending sign-up with their own password cannot get the victim to complete it, because
   * the victim does not know that password.
   */
  router.post('/verify-email', async (req, res, next) => {
    try {
      limit(limiters.tokenIp, `token:${req.ip}`);
      const body = verifyBody.parse(req.body);
      const hash = hashToken(body.token);
      limit(limiters.tokenAttempts, `verify:${hash}`);

      const pending = await findPending(db, hash, now());
      if (pending.state === 'ok') {
        if (!(await verifyPassword(pending.value.passwordHash, body.password))) {
          throw new AppError(
            'PASSWORD_MISMATCH',
            401,
            'That is not the password you chose when signing up.',
          );
        }
        let user: User | null;
        try {
          user = await completePending(db, pending.value, now());
        } catch (err) {
          if (isUniqueViolation(err)) throw emailInUse(); // a real account took the address meanwhile
          throw err;
        }
        if (!user) throw invalidLink();
        await startSession(req, res, user);
        res.json({ user: toPublicUser(user) });
        return;
      }
      if (pending.state === 'expired') throw expiredLink();

      const legacy = await findUserToken(db, 'verify_email', hash, now());
      if (legacy.state === 'expired') throw expiredLink();
      if (legacy.state !== 'ok') throw invalidLink();
      const user = await findUserById(db, legacy.value.userId);
      if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
        throw new AppError('PASSWORD_MISMATCH', 401, 'That password is not correct.');
      }
      if (!(await consumeUserToken(db, legacy.value.id, now()))) throw invalidLink();
      await markEmailVerified(db, user.id, now());
      await startSession(req, res, { ...user, emailVerifiedAt: now() });
      res.json({ user: toPublicUser({ ...user, emailVerifiedAt: now() }) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      limit(limiters.loginIp, `login-ip:${req.ip}`);
      const body = loginBody.parse(req.body);
      limit(limiters.loginEmail, `login-email:${body.email}`);

      const user = await findUserByEmail(db, body.email);
      if (!user?.passwordHash) {
        await verifyAgainstDummy(body.password);
        throw badCredentials();
      }
      if (!(await verifyPassword(user.passwordHash, body.password))) throw badCredentials();
      if (!user.emailVerifiedAt) throw notVerified();

      await startSession(req, res, user);
      res.json({ user: toPublicUser(user) });
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
        logger.info('Password sign-in rejected'); // never log the email or password
      }
      next(err);
    }
  });

  router.post('/forgot-password', async (req, res, next) => {
    try {
      limit(limiters.forgotIp, `forgot:${req.ip}`);
      const body = emailBody.parse(req.body);
      if (!mailer.configured) throw emailOff();
      limit(limiters.emailSend, `email:${body.email}`);

      const user = await findUserByEmail(db, body.email);
      if (user?.passwordHash) {
        const { token: raw, hash } = newToken();
        await createUserToken(
          db,
          user.id,
          'reset_password',
          hash,
          now(),
          new Date(now().getTime() + RESET_TTL_MS),
        );
        send(passwordResetEmail(body.email, env.APP_BASE_URL, raw));
      }
      // Same answer for unknown addresses and Google-only accounts.
      res.status(202).json({ status: 'reset_requested' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset-password', async (req, res, next) => {
    try {
      limit(limiters.tokenIp, `token:${req.ip}`);
      const body = resetBody.parse(req.body);
      const hash = hashToken(body.token);
      limit(limiters.tokenAttempts, `reset:${hash}`);

      const found = await findUserToken(db, 'reset_password', hash, now());
      if (found.state === 'expired') throw expiredLink();
      if (found.state !== 'ok') throw invalidLink();
      if (!(await consumeUserToken(db, found.value.id, now()))) throw invalidLink();

      await setPasswordHash(db, found.value.userId, await hashPassword(body.password), now());
      // Receiving the link proves the owner controls the address.
      await markEmailVerified(db, found.value.userId, now());
      // A reset must end every session, including one an attacker may be holding.
      await deleteAllSessions(db, found.value.userId);
      res.json({ status: 'password_reset' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
