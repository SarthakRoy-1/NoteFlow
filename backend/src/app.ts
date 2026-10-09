import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import { linkRouter } from './auth/link.routes.js';
import { passwordAuthRouter, type PasswordAuthLimiters } from './auth/password.routes.js';
import { authRouter } from './auth/routes.js';
import { createAIProvider, type AIProvider } from './ai/provider/index.js';
import { createGoogleAuth, type GoogleAuth } from './auth/google.js';
import type { Env } from './config/env.js';
import { createEmailSender, type EmailSender } from './email/index.js';
import type { Db } from './db/client.js';
import { AI_CALLS_PER_MINUTE, createRateLimiter } from './lib/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { originCheck } from './middleware/originCheck.js';
import { requireAuth } from './middleware/requireAuth.js';
import { askRouter } from './modules/ask/ask.routes.js';
import { notesRouter } from './modules/notes/notes.routes.js';
import { remindersRouter } from './modules/reminders/reminders.routes.js';
import { todosRouter } from './modules/todos/todos.routes.js';
import { meRouter } from './modules/users/me.routes.js';
import { healthRouter } from './routes/health.js';

const MINUTE = 60_000;

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
  /** Override the AI provider (tests). Defaults to Gemini, or an "unconfigured" stub without a key. */
  ai?: AIProvider;
  /** Clock used to resolve relative dates (tests). */
  now?: () => Date;
  /** Per-user AI calls per minute (defaults to 10; tests override). */
  aiCallsPerMinute?: number;
  /** Override the email sender (tests). Defaults to the configured provider (Resend or SMTP), else "not configured". */
  email?: EmailSender;
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
  authLimiters,
  email,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', originCheck(env.APP_BASE_URL));
  const clock = now ?? (() => new Date());
  const limiters = authLimiters ?? defaultAuthLimiters(clock);

  // Created on first use so missing Google config is a controlled per-request error.
  let google: GoogleAuth | undefined;
  const getGoogle = () => (google ??= (googleFactory ?? (() => createGoogleAuth(env)))());

  // Public routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter({ env, db, getGoogle, now: clock }));
  app.use(
    '/api/auth',
    passwordAuthRouter({
      env,
      db,
      limiters,
      email: email ?? createEmailSender(env),
      now: clock,
    }),
  );

  // Everything below requires a valid session. Add new feature routers here.
  const protectedApi = Router();
  protectedApi.use(requireAuth(db));
  protectedApi.use('/me', meRouter(db));
  protectedApi.use(
    '/auth/link',
    linkRouter({ env, db, getGoogle, limiter: limiters.link, now: clock }),
  );
  const provider = ai ?? createAIProvider(env);
  // One allowance per user for every real AI call (note analysis and Ask AI).
  const limiter = createRateLimiter({
    limit: aiCallsPerMinute ?? AI_CALLS_PER_MINUTE,
    windowMs: 60_000,
    now: clock,
  });
  protectedApi.use('/notes', notesRouter({ db, ai: provider, now: clock, limiter }));
  protectedApi.use('/todos', todosRouter(db));
  protectedApi.use('/reminders', remindersRouter(db, clock));
  protectedApi.use('/ask', askRouter({ db, ai: provider, now: clock, limiter }));
  app.use('/api', protectedApi);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
