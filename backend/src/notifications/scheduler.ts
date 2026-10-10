import { logger } from '../lib/logger.js';
import { runDispatch, type DispatchDeps } from './dispatcher.js';

/**
 * In-process poller. It holds no state of its own: what is due and what was already sent is read
 * from PostgreSQL every tick, so a restart loses nothing and a second instance cannot double-send.
 * A hosting plan that sleeps cannot run this, which is why POST /api/internal/notifications/dispatch
 * exists for an external scheduler.
 */
export function startNotificationScheduler(deps: DispatchDeps, intervalMs: number) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    try {
      const result = await runDispatch(deps);
      if (result.enqueued + result.sent + result.retried + result.failed > 0) {
        logger.info('Notification tick', { ...result });
      }
    } catch (err) {
      logger.error('Notification tick failed', { name: (err as Error).name });
    } finally {
      // Chained rather than setInterval, so a slow tick can never overlap the next one.
      if (!stopped) {
        timer = setTimeout(() => void tick(), intervalMs);
        timer.unref();
      }
    }
  };

  timer = setTimeout(() => void tick(), 5_000);
  timer.unref();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
