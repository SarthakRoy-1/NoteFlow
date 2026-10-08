import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { logger } from './lib/logger.js';
import { loadDotenv } from './loadDotenv.js';

loadDotenv();

const env = parseEnv(process.env);
const { db, pool } = createDb(env.DATABASE_URL);
const app = createApp({ env, db });

const server = app.listen(env.PORT, () => {
  logger.info('NoteFlow API listening', { port: env.PORT, env: env.NODE_ENV });
});

function shutdown(signal: string) {
  logger.info('Shutting down', { signal });
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
