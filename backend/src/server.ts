import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { logger } from './lib/logger.js';

// Load the repo-root .env when present (Node 20.12+). Real environment variables always win.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  logger.warn('No .env file found; using process environment only.');
}

const env = parseEnv(process.env);
const app = createApp(env);

app.listen(env.PORT, () => {
  logger.info('NoteFlow API listening', { port: env.PORT, env: env.NODE_ENV });
});
