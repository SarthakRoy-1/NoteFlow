import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { logger } from './lib/logger.js';
import { loadDotenv } from './loadDotenv.js';
import { createEmailSender } from './email/index.js';
import { startNotificationScheduler } from './notifications/scheduler.js';
import { createPushSender } from './notifications/push.js';

loadDotenv();

const env = parseEnv(process.env);
const { db, pool } = createDb(env.DATABASE_URL);
const email = createEmailSender(env);
const push = createPushSender(env);
const app = createApp({ env, db, email, push });

const server = app.listen(env.PORT, () => {
  logger.info('NoteFlow API listening', { port: env.PORT, env: env.NODE_ENV });
});

// The poller keeps no state in memory, so it is a backstop: the delivery ledger in PostgreSQL is
// what prevents duplicates, whichever trigger (this, or the external one) runs a tick.
const stopScheduler =
  env.NOTIFICATIONS_SCHEDULER && (email.configured || push.configured)
    ? startNotificationScheduler(
        { db, email, push, appBaseUrl: env.APP_BASE_URL, now: () => new Date() },
        env.NOTIFICATIONS_POLL_SECONDS * 1000,
      )
    : undefined;

function shutdown(signal: string) {
  logger.info('Shutting down', { signal });
  stopScheduler?.();
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
