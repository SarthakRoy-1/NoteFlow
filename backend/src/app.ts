import express from 'express';
import type { Env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';

export function createApp(_env: Env) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
