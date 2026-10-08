import { logger } from './lib/logger.js';

/** Load the repo-root .env when present (Node 20.12+). Real environment variables always win. */
export function loadDotenv(): void {
  try {
    process.loadEnvFile(new URL('../../.env', import.meta.url));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    logger.warn('No .env file found; using process environment only.');
  }
}
