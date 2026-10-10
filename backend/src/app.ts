import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import { linkRouter } from './auth/link.routes.js';
import { passwordAuthRouter, type PasswordAuthLimiters } from './auth/password.routes.js';
import { authRouter } from './auth/routes.js';
import { createAIProvider, type AIProvider } from './ai/provider/index.js';
import { createGoogleAuth, type GoogleAuth } from './auth/google.js';
import type { Env } from './config/env.js';
import { AppError, notFound } from './lib/errors.js';
import { createEmailSender, type EmailSender } from './email/index.js';
import type { Db } from './db/client.js';
import {
  AI_CALLS_PER_MINUTE,
  API_WRITES_PER_MINUTE,
  SHARE_ATTEMPTS_PER_MINUTE,
  createRateLimiter,
} from './lib/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { originCheck } from './middleware/originCheck.js';
import { currentUser, requireAuth } from './middleware/requireAuth.js';
import { askRouter } from './modules/ask/ask.routes.js';
import { notesRouter } from './modules/notes/notes.routes.js';
import { remindersRouter } from './modules/reminders/reminders.routes.js';
import { sharedRemindersRouter } from './modules/shares/shares.routes.js';
import { todosRouter } from './modules/todos/todos.routes.js';
import { meRouter } from './modules/users/me.routes.js';
import { runDispatch } from './notifications/dispatcher.js';
import { dispatchTrigger, notificationsRouter } from './notifications/notifications.routes.js';
import { createPushSender, type PushSender } from './notifications/push.js';
import { healthRouter } from './routes/health.js';

const MINUTE = 60_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Every endpoint that belongs to custom email/password auth (incl. Google linking for those accounts). */
const DISABLED_PASSWORD_PATHS = [
  'register',
  'login',
  'resend-verification',
  'verify-email',
  'forgot-password',
  'reset-password',
  'link',
].map((p) => `/api/auth/${p}`);

/**
 * Per-process limits (see lib/rateLimit.ts). Behind a reverse proxy, set Express's `trust proxy`
 * so `req.ip` is the real client address; otherwise every visitor shares the proxy's IP.
 */
function defaultAuthLimiters(clock: () => Date): PasswordAuthLimiters {
  return {
    register: createRateLimiter({ limit: 5, windowMs: 60 * MINUTE, now: clock }),
    loginIp: createRateLimiter({ limit: 20, windowMs: 15 * MINUTE, now: clock }),
    loginEmail: createRateLimiter({ limit: 8, windowMs: 15 * MINUTE, now: clock }),
    emailSend: createRateLimiter({ limit: 3, windowMs: 60 * MINUTE, now: clock }),
    forgotIp: createRateLimiter({ limit: 5, windowMs: 60 * MINUTE, now: clock }),
    tokenIp: createRateLimiter({ limit: 20, windowMs: 15 * MINUTE, now: clock }),
    tokenAttempts: createRateLimiter({ limit: 5, windowMs: 15 * MINUTE, now: clock }),
    link: createRateLimiter({ limit: 5, windowMs: 15 * MINUTE, now: clock }),
  };
}

export interface AppDeps {
  env: Env;
  db: Db;
  /** Override the Google client (tests). Defaults to the real OIDC implementation. */
  googleFactory?: () => GoogleAuth;
  /** Override the AI provider (tests). Defaults to the one AI_PROVIDER selects, or an "unconfigured" stub. */
  ai?: AIProvider;
  /** Clock used to resolve relative dates (tests). */
  now?: () => Date;
  /** Per-user AI calls per minute (defaults to AI_CALLS_PER_MINUTE; tests override). */
  aiCallsPerMinute?: number;
  /** Per-user state-changing requests per minute (defaults to API_WRITES_PER_MINUTE). */
  writesPerMinute?: number;
  /** Override the email sender (tests). Defaults to the configured provider (Resend or SMTP), else "not configured". */
  email?: EmailSender;
  /** Override the Web Push sender (tests). Defaults to VAPID from the environment, else "not configured". */
  push?: PushSender;
  /** Override the password sign-in/registration limiters (tests). */
  authLimiters?: PasswordAuthLimiters;
}

export function createApp({
  env,
  db,
  googleFactory,
  ai,
  now,
  aiCallsPerMinute,
  writesPerMinute,
  authLimiters,
  email,
  push,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  // Responses carry one user's private data: no browser, CDN or proxy may store or reuse them.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', originCheck(env.APP_BASE_URL));
  const clock = now ?? (() => new Date());
  const limiters = authLimiters ?? defaultAuthLimiters(clock);
  // Reminder notifications need a sender whether or not password sign-up is enabled.
  const emailSender = email ?? createEmailSender(env);
  const pushSender = push ?? createPushSender(env);

  // Created on first use so missing Google config is a controlled per-request error.
  let google: GoogleAuth | undefined;
  const getGoogle = () => (google ??= (googleFactory ?? (() => createGoogleAuth(env)))());

  // Public routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter({ env, db, getGoogle, now: clock }));
  if (env.ENABLE_PASSWORD_AUTH) {
    app.use(
      '/api/auth',
      passwordAuthRouter({
        env,
        db,
        limiters,
        email: emailSender,
        now: clock,
      }),
    );
  } else {
    // Custom email/password auth is disabled: same 404 as any unknown endpoint, and nothing runs
    // (no email sender is built, no token is read, no session is created).
    app.get('/api/auth/config', (_req, res) => {
      res.json({ passwordAuthEnabled: false, emailEnabled: false });
    });
    app.use(DISABLED_PASSWORD_PATHS, (_req, _res, next) =>
      next(notFound('That endpoint does not exist.')),
    );
  }

  // Called by an external scheduler (see NOTIFICATIONS_CRON_SECRET); never by a browser.
  app.post(
    '/api/internal/notifications/dispatch',
    dispatchTrigger({
      secret: env.NOTIFICATIONS_CRON_SECRET,
      run: () =>
        runDispatch({
          db,
          email: emailSender,
          push: pushSender,
          appBaseUrl: env.APP_BASE_URL,
          now: clock,
        }),
    }),
  );

  // Everything below requires a valid session. Add new feature routers here.
  const protectedApi = Router();
  protectedApi.use(requireAuth(db));
  // One user cannot flood the database with changes, whichever endpoint they use.
  const writeLimiter = createRateLimiter({
    limit: writesPerMinute ?? API_WRITES_PER_MINUTE,
    windowMs: 60_000,
    now: clock,
  });
  protectedApi.use((req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || writeLimiter.take(currentUser(req).id)) return next();
    next(
      new AppError(
        'RATE_LIMITED',
        429,
        'You are making changes too quickly. Please wait a minute and try again.',
      ),
    );
  });
  protectedApi.use('/me', meRouter(db));
  protectedApi.use(
    '/notifications',
    notificationsRouter({ db, email: emailSender, push: pushSender, now: clock }),
  );
  if (env.ENABLE_PASSWORD_AUTH) {
    protectedApi.use(
      '/auth/link',
      linkRouter({ env, db, getGoogle, limiter: limiters.link, now: clock }),
    );
  }
  const provider = ai ?? createAIProvider(env);
  // One allowance per user for every real AI call (note analysis and Ask AI).
  const limiter = createRateLimiter({
    limit: aiCallsPerMinute ?? AI_CALLS_PER_MINUTE,
    windowMs: 60_000,
    now: clock,
  });
  protectedApi.use('/notes', notesRouter({ db, ai: provider, now: clock, limiter }));
  protectedApi.use('/todos', todosRouter(db));
  protectedApi.use(
    '/reminders',
    remindersRouter({
      db,
      now: clock,
      shareLimiter: createRateLimiter({
        limit: SHARE_ATTEMPTS_PER_MINUTE,
        windowMs: 60_000,
        now: clock,
      }),
    }),
  );
  protectedApi.use('/shared-reminders', sharedRemindersRouter({ db, now: clock }));
  protectedApi.use('/ask', askRouter({ db, ai: provider, now: clock, limiter }));
  app.use('/api', protectedApi);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
