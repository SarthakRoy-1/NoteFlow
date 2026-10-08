import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import { authRouter } from './auth/routes.js';
import { createGoogleAuth, type GoogleAuth } from './auth/google.js';
import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { originCheck } from './middleware/originCheck.js';
import { requireAuth } from './middleware/requireAuth.js';
import { meRouter } from './modules/users/me.routes.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  env: Env;
  db: Db;
  /** Override the Google client (tests). Defaults to the real OIDC implementation. */
  googleFactory?: () => GoogleAuth;
}

export function createApp({ env, db, googleFactory }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', originCheck(env.APP_BASE_URL));

  // Created on first use so missing Google config is a controlled per-request error.
  let google: GoogleAuth | undefined;
  const getGoogle = () => (google ??= (googleFactory ?? (() => createGoogleAuth(env)))());

  // Public routes.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter({ env, db, getGoogle }));

  // Everything below requires a valid session. Add new feature routers here.
  const protectedApi = Router();
  protectedApi.use(requireAuth(db));
  protectedApi.use('/me', meRouter(db));
  app.use('/api', protectedApi);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
